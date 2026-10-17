"""Same-origin Immich companion; all reads use the requesting user's session."""
import asyncio
import io
import os
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
RAW_EXTENSIONS = frozenset('3fr arw bay cap cr2 cr3 crw dcr dcs dng drf eip erf fff gpr iiq k25 kdc mdc mef mos mrw nef nrw obm orf pef ptx pxn r3d raf raw rw2 rwl rwz sr2 srf srw x3f'.split())
MAX_BYTES = int(os.environ.get('MAX_RAW_BYTES', 256 * 1024 * 1024))
MAX_PIXELS = int(os.environ.get('MAX_RAW_PIXELS', 150_000_000))
transport = None  # Replaced with a deterministic transport in integration tests.
slots = asyncio.Semaphore(1)


def is_raw(asset):
    return asset.get('type') == 'IMAGE' and Path(asset.get('originalFileName', '')).suffix.lower()[1:] in RAW_EXTENSIONS


def jpeg_filename(name):
    basename = name.replace('\\', '/').rsplit('/', 1)[-1]
    return re.sub(r'[\x00-\x1f\x7f]', '', Path(basename).stem)[:180] + '.jpg'


def extract_jpeg(path):
    """Return the camera's embedded JPEG verbatim; never develop or re-encode."""
    for tag in ('JpgFromRaw2', 'JpgFromRaw'):
        try:
            result = subprocess.run(
                ['exiftool', '-b', f'-{tag}', str(path)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45, check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise ValueError('Embedded JPEG extraction timed out') from error
        if result.returncode != 0 or not result.stdout:
            continue
        jpeg = result.stdout
        if len(jpeg) > MAX_BYTES:
            raise ValueError('Embedded JPEG exceeds the configured size limit')
        try:
            with Image.open(io.BytesIO(jpeg)) as image:
                if image.format != 'JPEG':
                    continue
                if image.width * image.height > MAX_PIXELS:
                    raise ValueError('Embedded JPEG exceeds the configured pixel limit')
        except (UnidentifiedImageError, OSError):
            continue
        return jpeg
    raise ValueError('No supported embedded JPEG found in this RAW (JpgFromRaw2 or JpgFromRaw)')


def check_upstream(response):
    if response.status_code in (401, 403, 404):
        raise HTTPException(response.status_code, 'Immich denied access to this original')
    if not response.is_success:
        raise HTTPException(502, 'Immich could not provide the original')


@app.get('/raw-jpeg/health')
def health():
    return {'status': 'ok'}


@app.post('/raw-jpeg/assets/{asset_id}')
async def download_jpeg(asset_id: UUID, request: Request):
    public_origin = os.environ.get('PUBLIC_ORIGIN', '').rstrip('/')
    if not public_origin or request.headers.get('origin') != public_origin:
        raise HTTPException(403, 'Request must come from the configured Immich origin')
    auth = {name: request.headers[name] for name in ('cookie', 'authorization', 'x-api-key')
            if request.headers.get(name)}
    if not auth:
        raise HTTPException(401, 'Sign in to Immich first')
    if slots.locked():
        raise HTTPException(429, 'A RAW is already being read. Try again shortly.')
    async with slots:
        base = os.environ.get('IMMICH_URL', 'http://immich-server:2283').rstrip('/')
        try:
            # Fixed upstream only. No arbitrary URLs, redirects, admin keys, or shared cookies.
            async with httpx.AsyncClient(transport=transport, timeout=120, follow_redirects=False,
                                         headers=auth) as client:
                info = await client.get(f'{base}/api/assets/{asset_id}')
                check_upstream(info)
                asset = info.json()
                if not is_raw(asset):
                    raise HTTPException(415, 'JPEG download is available only for RAW photos')
                with tempfile.TemporaryDirectory(prefix='raw-jpeg-') as directory:
                    path = Path(directory) / 'original.raw'
                    async with client.stream('GET', f'{base}/api/assets/{asset_id}/original',
                                             params={'edited': 'false'}) as original:
                        check_upstream(original)
                        size = 0
                        with path.open('wb') as output:
                            async for chunk in original.aiter_bytes():
                                size += len(chunk)
                                if size > MAX_BYTES:
                                    raise HTTPException(413, 'RAW exceeds the configured file size limit')
                                output.write(chunk)
                    jpeg = await run_in_threadpool(extract_jpeg, path)
                name = quote(jpeg_filename(asset['originalFileName']), safe='')
                return Response(jpeg, media_type='image/jpeg', headers={
                    'Content-Disposition': f"attachment; filename*=UTF-8''{name}",
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff',
                })
        except httpx.HTTPError as error:
            raise HTTPException(502, 'Unable to reach Immich') from error
        except ValueError as error:
            raise HTTPException(422, str(error)) from error


@app.get('/raw-jpeg/integration.js')
def integration_script():
    script = Path(__file__).resolve().parent.parent / 'userscript' / 'immich-raw-jpeg.user.js'
    return Response(script.read_bytes(), media_type='application/javascript', headers={
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    })


@app.get('/{path:path}')
async def integrated_page(path: str, request: Request):
    """Optional HTML-only proxy; APIs and WebSockets stay on the existing gateway."""
    upstream = os.environ.get('WEB_UPSTREAM_URL', '').rstrip('/')
    if path.startswith('raw-jpeg/') or not upstream or 'text/html' not in request.headers.get('accept', ''):
        raise HTTPException(404)
    excluded = {'host', 'connection', 'keep-alive', 'transfer-encoding', 'content-length',
                'accept-encoding', 'if-none-match', 'if-modified-since'}
    headers = {k: v for k, v in request.headers.items() if k.lower() not in excluded}
    headers['accept-encoding'] = 'identity'
    origin = httpx.URL(os.environ['PUBLIC_ORIGIN'])
    headers['host'] = origin.netloc.decode()
    headers['x-forwarded-host'] = origin.netloc.decode()
    headers['x-forwarded-proto'] = origin.scheme
    try:
        async with httpx.AsyncClient(transport=transport, timeout=30, follow_redirects=False) as client:
            async with client.stream('GET', f'{upstream}/{path}', params=request.query_params,
                                     headers=headers) as response:
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 4 * 1024 * 1024:
                        raise HTTPException(502, 'Immich page exceeds integration limit')
                data = bytes(body)
                if response.status_code == 200 and 'text/html' in response.headers.get('content-type', ''):
                    data = re.sub(b'</head\\s*>', b'<script defer src="/raw-jpeg/integration.js"></script></head>',
                                  data, count=1, flags=re.IGNORECASE)
                excluded_response = {'content-length', 'content-encoding', 'transfer-encoding',
                                     'connection', 'etag', 'last-modified', 'cache-control'}
                result = Response(data, status_code=response.status_code,
                                  headers={'Cache-Control': 'no-store'})
                result.raw_headers.extend((k, v) for k, v in response.headers.raw
                                          if k.decode().lower() not in excluded_response)
                return result
    except httpx.HTTPError as error:
        raise HTTPException(502, 'Unable to load Immich page') from error

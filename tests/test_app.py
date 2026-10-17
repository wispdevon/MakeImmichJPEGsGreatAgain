import io
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from server.app import app, is_raw, jpeg_filename, extract_jpeg


def test_raw_only():
    for name in ['photo.RW2', 'photo.NEF', 'photo.CR3', 'photo.dng', 'photo.ARW']:
        assert is_raw({'type': 'IMAGE', 'originalFileName': name})
    for name in ['photo.jpg', 'photo.JPEG', 'photo.png', 'photo.heic', 'photo.tif', 'photo.raw.exe']:
        assert not is_raw({'type': 'IMAGE', 'originalFileName': name})
    assert not is_raw({'type': 'VIDEO', 'originalFileName': 'fake.RW2'})


def test_filename():
    assert jpeg_filename('../../hello.RW2') == 'hello.jpg'
    assert '\r' not in jpeg_filename('hello\r\n.RW2')


def test_invalid_raw(tmp_path):
    path = tmp_path / 'fake.rw2'
    path.write_bytes(b'not a raw photo')
    with pytest.raises(ValueError, match='RAW'):
        extract_jpeg(path)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('PUBLIC_ORIGIN', 'https://photos.example.com')
    with TestClient(app) as client:
        yield client


def test_origin_and_session_required(client):
    url = f'/raw-jpeg/assets/{uuid4()}'
    assert client.post(url).status_code == 403
    assert client.post(url, headers={'origin': 'https://evil.example'}).status_code == 403
    assert client.post(url, headers={'origin': 'https://photos.example.com'}).status_code == 401


def test_download_authorization_and_jpeg(client, monkeypatch):
    import server.app as module
    asset_id = uuid4()
    seen = []
    def upstream(request):
        seen.append(request)
        if request.url.path.endswith('/original'):
            return httpx.Response(200, content=b'raw-original')
        return httpx.Response(200, json={'type': 'IMAGE', 'originalFileName': 'camera.RW2'})
    monkeypatch.setattr(module, 'transport', httpx.MockTransport(upstream))
    def extract(path):
        assert path.read_bytes() == b'raw-original'
        assert path.suffix == '.rw2'
        output = io.BytesIO()
        Image.new('RGB', (120, 80)).save(output, 'JPEG')
        return output.getvalue()
    monkeypatch.setattr(module, 'extract_jpeg', extract)
    response = client.post(f'/raw-jpeg/assets/{asset_id}', headers={
        'origin': 'https://photos.example.com', 'cookie': 'immich_access_token=user-session',
    })
    assert response.status_code == 200
    assert response.headers['content-type'] == 'image/jpeg'
    assert Image.open(io.BytesIO(response.content)).size == (120, 80)
    assert len(seen) == 2
    assert all(r.headers['cookie'] == 'immich_access_token=user-session' for r in seen)
    assert seen[-1].url.params['edited'] == 'false'


@pytest.mark.parametrize('status', [401, 403, 404])
def test_upstream_denied(client, monkeypatch, status):
    import server.app as module
    monkeypatch.setattr(module, 'transport', httpx.MockTransport(lambda r: httpx.Response(status)))
    response = client.post(f'/raw-jpeg/assets/{uuid4()}', headers={
        'origin': 'https://photos.example.com', 'cookie': 'immich_access_token=bad',
    })
    assert response.status_code == status


def test_reject_jpeg(client, monkeypatch):
    import server.app as module
    monkeypatch.setattr(module, 'transport', httpx.MockTransport(lambda r: httpx.Response(200, json={
        'type': 'IMAGE', 'originalFileName': 'already.jpg',
    })))
    response = client.post(f'/raw-jpeg/assets/{uuid4()}', headers={
        'origin': 'https://photos.example.com', 'cookie': 'immich_access_token=session',
    })
    assert response.status_code == 415


def test_original_download_permission_is_checked(client, monkeypatch):
    import server.app as module
    def upstream(request):
        if request.url.path.endswith('/original'):
            return httpx.Response(403)
        return httpx.Response(200, json={'type': 'IMAGE', 'originalFileName': 'photo.RW2'})
    monkeypatch.setattr(module, 'transport', httpx.MockTransport(upstream))
    response = client.post(f'/raw-jpeg/assets/{uuid4()}', headers={
        'origin': 'https://photos.example.com', 'cookie': 'immich_access_token=session',
    })
    assert response.status_code == 403


def test_size_limit(client, monkeypatch):
    import server.app as module
    monkeypatch.setattr(module, 'MAX_BYTES', 4)
    def upstream(request):
        if request.url.path.endswith('/original'):
            return httpx.Response(200, content=b'too large')
        return httpx.Response(200, json={'type': 'IMAGE', 'originalFileName': 'photo.RW2'})
    monkeypatch.setattr(module, 'transport', httpx.MockTransport(upstream))
    response = client.post(f'/raw-jpeg/assets/{uuid4()}', headers={
        'origin': 'https://photos.example.com', 'cookie': 'immich_access_token=session',
    })
    assert response.status_code == 413


def test_no_redirects_to_arbitrary_servers(client, monkeypatch):
    import server.app as module
    monkeypatch.setattr(module, 'transport', httpx.MockTransport(lambda r: httpx.Response(
        302, headers={'location': 'https://other-server.example/steal-cookie'})))
    response = client.post(f'/raw-jpeg/assets/{uuid4()}', headers={
        'origin': 'https://photos.example.com', 'cookie': 'immich_access_token=session',
    })
    assert response.status_code == 502


def test_embedded_bytes_returned_without_reencoding(tmp_path, monkeypatch):
    import server.app as module
    import subprocess
    output = io.BytesIO()
    Image.new('RGB', (160, 100), 'blue').save(output, 'JPEG', comment=b'preserve camera bytes')
    embedded = output.getvalue()
    calls = []
    def exiftool(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, stdout=embedded, stderr=b'')
    monkeypatch.setattr(module.subprocess, 'run', exiftool)
    path = tmp_path / 'camera.RW2'
    path.write_bytes(b'raw')
    assert module.extract_jpeg(path) == embedded
    assert calls[0][1:3] == ['-b', '-JpgFromRaw2']


def test_no_embedded_jpeg_never_converts(tmp_path, monkeypatch):
    import server.app as module
    import subprocess
    monkeypatch.setattr(module.subprocess, 'run', lambda command, **kwargs: subprocess.CompletedProcess(
        command, 0, stdout=b'', stderr=b''))
    path = tmp_path / 'camera.RW2'
    path.write_bytes(b'raw')
    with pytest.raises(ValueError, match='embedded JPEG'):
        module.extract_jpeg(path)


def test_html_integration_preserves_existing_addons(client, monkeypatch):
    import server.app as module
    monkeypatch.setenv('WEB_UPSTREAM_URL', 'http://existing-immich-gateway:8080')
    html = '<html><head><script src="/immichinko/integration/sidebar.js"></script></head><body>Immich</body></html>'
    monkeypatch.setattr(module, 'transport', httpx.MockTransport(lambda r: httpx.Response(
        200, text=html, headers={'content-type': 'text/html', 'etag': 'old'})))
    response = client.get('/photos', headers={'accept': 'text/html'})
    assert response.status_code == 200
    assert '/immichinko/integration/sidebar.js' in response.text
    assert '<script defer src="/raw-jpeg/integration.js"></script>' in response.text
    assert 'etag' not in response.headers


def test_api_key_is_forwarded_without_privileged_fallback(client, monkeypatch):
    import server.app as module
    seen = []
    def upstream(request):
        seen.append(request)
        return httpx.Response(403)
    monkeypatch.setattr(module, 'transport', httpx.MockTransport(upstream))
    response = client.post(f'/raw-jpeg/assets/{uuid4()}', headers={
        'origin': 'https://photos.example.com', 'x-api-key': 'requesting-user-key',
    })
    assert response.status_code == 403
    assert seen[0].headers['x-api-key'] == 'requesting-user-key'
    assert 'cookie' not in seen[0].headers


def test_unknown_integration_path_does_not_loop_through_gateway(client, monkeypatch):
    monkeypatch.setenv('WEB_UPSTREAM_URL', 'http://existing-gateway:8080')
    assert client.get('/raw-jpeg/missing', headers={'accept': 'text/html'}).status_code == 404


@pytest.mark.parametrize('extension', ['NEF', 'CR3', 'ARW', 'RAF', 'DNG', 'raw'])
def test_other_raw_formats_use_jpgfromraw(tmp_path, monkeypatch, extension):
    import server.app as module
    import subprocess
    output = io.BytesIO()
    Image.new('RGB', (160, 100)).save(output, 'JPEG')
    embedded = output.getvalue()
    selected = []
    def exiftool(command, **kwargs):
        selected.append(command[2])
        return subprocess.CompletedProcess(command, 0, stdout=embedded, stderr=b'')
    monkeypatch.setattr(module.subprocess, 'run', exiftool)
    path = tmp_path / f'camera.{extension}'
    path.write_bytes(b'raw')
    assert module.extract_jpeg(path) == embedded
    assert selected == ['-JpgFromRaw']

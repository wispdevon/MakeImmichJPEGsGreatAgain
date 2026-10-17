# Installation and reference

Download the **full-size JPEG already embedded in a RAW photo**, from a JPG icon beside Immich's Download button, and **Download JPEG** in the three-dot menu. Designed for Panasonic `.RW2` files.

**No RAW development, conversion, resizing or JPEG re-encoding.** The response is the camera's original embedded JPEG bytes, including any metadata it contains.

## How it works

The companion reads the original RAW through the requesting user's Immich session and runs:

```sh
exiftool -b -JpgFromRaw2 original.RW2
```

RW2 files use `JpgFromRaw2`, with `JpgFromRaw` as a fallback. Other RAW formats use `exiftool -b -JpgFromRaw` directly. If the supported tag contains no JPEG, the download reports an error. It never falls back to a thumbnail, `PreviewImage`, or RAW conversion. The embedded image's dimensions are determined by the camera; this add-on does not upscale it or promise that every RAW contains a full-resolution JPEG.

Both JPEG download actions appear only for RAW images, never JPEG, PNG, HEIC, TIFF or video. Other common RAW extensions are recognized, but extraction succeeds only when one of the supported tags exists. Original files and the Immich library are never modified.

## Docker setup

```sh
git clone https://github.com/wispdevon/MakeImmichJPEGsGreatAgain.git
cd MakeImmichJPEGsGreatAgain
cp .env.example .env
```

Edit `.env` to match the browser origin and the existing Immich Docker network (`docker network ls`):

```dotenv
PUBLIC_ORIGIN=https://photos.example.com
IMMICH_NETWORK=immich_default
IMMICH_URL=http://immich-server:2283
RAW_JPEG_PORT=8100
```

`IMMICH_URL` is the fixed internal server URL, without `/api`. No API key or library mount is needed. Start the service:

```sh
docker compose up -d --build
curl http://127.0.0.1:8100/raw-jpeg/health
```

The response should be `{"status":"ok"}`. The port is bound to host loopback.

## Add the button automatically for all browsers

Set `WEB_UPSTREAM_URL` in `.env` to your existing internal Immich web or gateway URL. For example:

```dotenv
WEB_UPSTREAM_URL=http://immich-server:2283
```

If you already have an integration gateway, use that internal URL instead. This preserves its HTML and scripts.

Use [deploy/Caddyfile.example](../deploy/Caddyfile.example) as the routing pattern for your existing Immich domain:

- `/raw-jpeg/*` goes to this companion at `127.0.0.1:8100`.
- GET requests accepting HTML go to this companion, which reads the existing Immich page and inserts `<script defer src="/raw-jpeg/integration.js"></script>`.
- Everything else, including APIs, media and WebSockets, stays on the existing Immich upstream.

Preserve your existing TLS configuration. Validate the proposed proxy configuration before reloading. If the proxy runs in Docker, connect it to the Immich network and use `http://raw-jpeg:8099` instead of host loopback. Restart the companion after changing its environment.

Reload Immich and open a RAW photo. Use the JPG icon beside Download or **More (⋮) → Download JPEG**. No browser extension is required with this setup. Mobile browsers use this same interface; the native Immich iOS and Android apps do not load the integration. This is an independent web add-on.

## Existing Immichinko gateway

If the public reverse proxy already points directly at Immichinko's gateway, you can keep that route unchanged. Put the companion on the same Docker network, then run:

```sh
python3 deploy/install-immichinko.py /path/to/immichinko
```

The installer adds optional routing and script injection, with backups and checks against the expected gateway layout. Set `RAW_JPEG_UPSTREAM_URL=http://raw-jpeg-raw-jpeg-1:8099` in Immichinko's `.env.integration` (adjust the container DNS name if different), then rebuild only its gateway:

```sh
cd /path/to/immichinko
docker compose --env-file .env.integration -f compose.integrated.yaml up -d --build --no-deps gateway
```

The existing sidebar, API routes, media and WebSocket handling stay in place. This setup doesn't require the optional HTML proxy or a change to the public reverse proxy. To disable the button, remove `RAW_JPEG_UPSTREAM_URL` and recreate the gateway.

## Alternative: userscript installation

If you prefer not to proxy HTML, route only `/raw-jpeg/` to the companion. [deploy/nginx.conf](../deploy/nginx.conf) shows the nginx route. Preserve the path, Cookie and Origin headers, and a 300-second response timeout.

Install Tampermonkey or Violentmonkey, create a userscript from [userscript/immich-raw-jpeg.user.js](../userscript/immich-raw-jpeg.user.js), and change `@match` to your Immich origin. Save and reload. Each browser needs the script when using this alternative. Don't install it when automatic injection is enabled.

## Permissions and limits

The companion forwards only the requesting user's Cookie, Authorization or API-key credentials to the fixed `IMMICH_URL`. Immich checks metadata and original-download permissions; there is no stored admin key or privileged fallback. Browser requests use the existing session, and extraction requires the configured same-origin `Origin` header. Shared-link viewers are deliberately unsupported.

The companion keeps temporary RAW files only for the duration of extraction and removes them on success or failure. Defaults are one extraction at a time, a 256 MiB input/embedded-JPEG limit, 150 million embedded pixels, a 45-second ExifTool timeout, 512 MiB container memory and 512 MiB temporary storage. Configure `MAX_RAW_BYTES` and `MAX_RAW_PIXELS` alongside container limits for unusually large images. The JPEG header is inspected for validity and dimensions without decoding or re-encoding its pixels.

The script targets Immich's `asset-viewer-navbar-actions` toolbar and download icon, with an English-label fallback. It handles `/photos/:id` and nested `/…/photos/:id` routes. Future Immich layout changes may require an update.

## Development and verification

Requires Python 3.12, uv, Node.js 20+, and ExifTool (`libimage-exiftool-perl` on Debian/Ubuntu).

```sh
uv sync --locked
uv run pytest -q
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

Backend tests cover origin/session checks, original-download permissions, input limits, byte-preserving extraction and automatic page injection. Browser tests exercise a toolbar fixture, downloading, route changes and extraction errors. GitHub CI also builds the Docker image.

An actual Panasonic RW2 from the deployment was checked: `JpgFromRaw2` yielded a **6000 × 4000 JPEG**, and the companion's extracted output matched ExifTool byte for byte. No credentials are included in this repository.

References: [ExifTool Panasonic RAW tags](https://exiftool.org/TagNames/PanasonicRaw.html), [Immich API](https://docs.immich.app/api/), [Immich viewer toolbar](https://github.com/immich-app/immich/blob/main/web/src/lib/components/asset-viewer/AssetViewerNavBar.svelte).

## Troubleshooting

- **No button:** hard-refresh Immich, check that `/raw-jpeg/integration.js` loads and that a RAW is open in the single-photo viewer beside an existing Download button.
- **HTML instead of JPEG:** fix the `/raw-jpeg/` proxy route.
- **403:** match `PUBLIC_ORIGIN` to your exact browser origin and preserve the Origin header.
- **401/denied access:** sign in again and confirm Immich permits downloading the original.
- **422:** no supported embedded JPEG exists, or ExifTool could not read it. No conversion is attempted.
- **429:** wait for the current extraction and retry.
- **502:** check Docker networking, `IMMICH_URL`, `WEB_UPSTREAM_URL` and service logs.

MIT licensed. ExifTool and other dependencies retain their own licenses.

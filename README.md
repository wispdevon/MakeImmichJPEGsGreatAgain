# Make Panasonic Great Again

A **Download full-resolution JPEG** button beside Immich's existing download button, shown **only for RAW photos**. Built for Panasonic `.RW2` files; also recognizes common camera RAW extensions such as CR2/CR3, NEF, ARW, RAF, ORF and DNG. Actual decoding support depends on the bundled LibRaw version and camera.

The button downloads the original through your existing Immich session, develops it with LibRaw, and saves a `.jpg`. It never downloads Immich's reduced preview or modifies your library.

## What you get

- A userscript for the Immich **web interface**, with an adjacent `JPEG ↓` button.
- A Docker companion that renders the RAW at its full developed dimensions, with camera white balance, automatic orientation, sRGB color and JPEG quality 95 with no chroma subsampling.
- RAW-only visibility: no button for JPEG, PNG, HEIC, TIFF, or video.
- Progress and errors, plus a normal browser download named after the source file.
- No admin API key, library mount, database access, or Immich fork.

This is an independent add-on, not an official Immich plugin. It requires a userscript manager and a small reverse-proxy change. The native mobile apps are outside its scope.

## Install

### 1. Start the converter

Clone this repository on the Docker host running Immich:

```sh
git clone https://github.com/wispdevon/MakePanasonicGreatAgain.git
cd MakePanasonicGreatAgain
cp .env.example .env
```

Edit `.env`:

```dotenv
PUBLIC_ORIGIN=https://photos.example.com
IMMICH_NETWORK=immich_default
IMMICH_URL=http://immich-server:2283
```

Set `PUBLIC_ORIGIN` to the exact origin you use in your browser, including the port if applicable. Use `docker network ls` to find your Immich Docker network and set `IMMICH_URL` to the server's address on that network. Do not include `/api`.

```sh
docker compose up -d --build
curl http://127.0.0.1:8099/raw-jpeg/health
```

### 2. Route `/raw-jpeg/` on your Immich origin

Add [deploy/nginx.conf](deploy/nginx.conf) to the same nginx `server` block that serves Immich, then validate and reload nginx. Keep your existing Immich routes. The path must reach the converter **without stripping `/raw-jpeg/`**. Preserve the `Cookie` and `Origin` request headers and allow a 300-second response timeout.

The example assumes nginx runs on the Docker host. For a containerized proxy, join it to the same Docker network and target `http://raw-jpeg:8099` instead of `127.0.0.1:8099`.

Check `https://YOUR-IMMICH-ADDRESS/raw-jpeg/health`; it should return `{"status":"ok"}`. The converter is bound to loopback by default; don't expose port 8099 publicly.

### 3. Install the button

1. Install a userscript manager such as Tampermonkey or Violentmonkey.
2. Create a new userscript and paste [userscript/immich-raw-jpeg.user.js](userscript/immich-raw-jpeg.user.js).
3. Change its `@match` from `https://photos.example.com/*` to your actual Immich address. Save and enable it.
4. Reload Immich, sign in, and open a RAW photo. Click **JPEG ↓** beside Download.

Shared links are deliberately unsupported. Each browser needs the userscript installed. The script supports `/photos/:id` and nested `/…/photos/:id` viewer routes. It targets the current `asset-viewer-navbar-actions` toolbar and recognizes the download icon across translated labels, with an English-label fallback for older layouts. Immich UI changes may require updating the script.

## Rendering and limits

“Full resolution” means LibRaw's developed image dimensions after sensor margins and orientation, with `half_size=False` and no resizing. It does not mean the sensor's entire raw buffer, which may include unused border pixels. The JPEG is an independent LibRaw render; camera JPEG styles, Immich edits, ratings and EXIF/GPS metadata are not copied. An sRGB ICC profile is embedded.

Defaults: one conversion at a time, 256 MiB input, 150 million developed pixels, 2 GiB container memory, and 512 MiB temporary storage. Concurrent requests receive a retryable error. Increase Docker limits and `MAX_RAW_BYTES` / `MAX_RAW_PIXELS` together for very large files. Files are temporary and removed after conversion or failure; there is no persistent cache. Very large or unusually compressed RAWs may hit the container memory limit.

The converter forwards the requesting browser's cookies only to the fixed `IMMICH_URL`. Immich checks both metadata and original-download access using that user's session. There is no privileged fallback. Requests must carry the configured same-origin `Origin` header. Keep the converter on a trusted network and run it behind the same HTTPS origin as Immich.

## Development and verification

Requires Python 3.12, [uv](https://docs.astral.sh/uv/), and Node.js 20+.

```sh
uv sync --locked
uv run pytest -q
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

Backend integration tests cover session/origin checks, permission errors, RAW eligibility and download responses. Browser tests use an Immich toolbar fixture to verify placement, downloading, navigation and errors; they do not claim compatibility with every live Immich release. A real Nikon NEF from [rawpy's test corpus](https://github.com/letmaik/rawpy/tree/main/test) was also manually converted: 4284 × 2844 developed pixels produced a 4284 × 2844 JPEG with an embedded ICC profile. No live Immich instance was available during development.

API and toolbar references: [Immich API](https://docs.immich.app/api/), [original-download controller](https://github.com/immich-app/immich/blob/main/server/src/controllers/asset-media.controller.ts), [viewer toolbar](https://github.com/immich-app/immich/blob/main/web/src/lib/components/asset-viewer/AssetViewerNavBar.svelte).

## Troubleshooting

- **No button:** check the userscript's `@match`, RAW extension, and whether you're in the single-photo viewer with an existing Download button.
- **Converter not configured / HTML response:** fix the `/raw-jpeg/` proxy route.
- **403:** make `PUBLIC_ORIGIN` match the browser origin exactly and preserve the `Origin` header at the proxy.
- **401 or denied access:** sign in again and check you can download the original in Immich.
- **422:** the file may be corrupt or its camera unsupported by LibRaw.
- **429:** wait for the current conversion and retry.
- **502:** check `IMMICH_URL`, Docker networking and converter logs.

MIT licensed. LibRaw/rawpy and other dependencies retain their own licenses.

# Make Immich JPEGs Great Again

Download the **full-size JPEG embedded in your RAW** directly from Immich. Uses ExifTool (`-JpgFromRaw2` for RW2, `-JpgFromRaw` for other RAWs): no conversion, resizing or re-encoding.

For the 24 MP Panasonic RW2 files shown here:

| File | Resolution |
| --- | --- |
| RAW | **24 MP** |
| Embedded JPG | **24 MP** |
| Old preview | **~3 MP** |

Embedded JPEG resolution varies by camera.

## Use

Open a RAW photo and click the **JPG icon beside Download**:

![The new JPEG download button highlighted in the toolbar](docs/images/jpeg-toolbar.png)

Or choose **⋮ → Download JPEG**:

![Download JPEG highlighted in the three-dot menu](docs/images/jpeg-menu.png)

Both actions appear only on RAW photos. Works in desktop and mobile browsers; native Immich apps are unsupported.

## Install

```sh
git clone https://github.com/wispdevon/MakeImmichJPEGsGreatAgain.git
cd MakeImmichJPEGsGreatAgain
cp .env.example .env
```

1. Edit `.env`: set your `PUBLIC_ORIGIN`, `IMMICH_URL` and `IMMICH_NETWORK`. For automatic button injection, set `WEB_UPSTREAM_URL` to your existing internal Immich web/gateway URL.
2. Run `docker compose up -d --build`.
3. Add the routes from [the Caddy example](deploy/Caddyfile.example) to your existing Immich domain, keeping your TLS settings. Reload the proxy, then refresh Immich.

[Full installation guide, Immichinko integration and userscript alternative →](docs/INSTALL.md)

MIT · Independent Immich add-on.

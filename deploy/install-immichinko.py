"""Add the optional RAW JPEG integration to an existing Immichinko deployment.

Run: python3 install-immichinko.py /path/to/immichinko
Then set RAW_JPEG_UPSTREAM_URL in its .env.integration and rebuild gateway only.
Backups are created before editing; credentials are never read by this script.
"""
import sys
from pathlib import Path

root = Path(sys.argv[1])
gateway = root / 'integrations/server/gateway.mjs'
compose = root / 'compose.integrated.yaml'
source = gateway.read_text()
if 'rawJpegUrl' not in source:
    edits = [
        ('ownerId:string}} config', 'ownerId:string,rawJpegUrl?:string}} config'),
        ('createGateway({ immichUrl, appUrl, publicOrigin, ownerId })',
         "createGateway({ immichUrl, appUrl, publicOrigin, ownerId, rawJpegUrl = '' })"),
        ('  const origin = new URL(publicOrigin);',
         "  const origin = new URL(publicOrigin);\n  const rawJpeg = rawJpegUrl ? new URL(rawJpegUrl) : null;\n  if (rawJpeg && !['http:', 'https:'].includes(rawJpeg.protocol)) throw new Error('Invalid RAW JPEG upstream');"),
        ('prefix + \'/\')}\"></script>`;',
         'prefix + \'/\')}\"></script>` + (rawJpeg ? \'<script defer src="/raw-jpeg/integration.js"></script>\' : \'\');'),
        ("      if (path === prefix || path.startsWith(prefix + '/')) {",
         "      if (rawJpeg && path.startsWith('/raw-jpeg/')) {\n        proxy(req, res, rawJpeg);\n        return;\n      }\n      if (path === prefix || path.startsWith(prefix + '/')) {"),
        ("    ownerId: process.env.IMMICH_OWNER_ID || '',",
         "    ownerId: process.env.IMMICH_OWNER_ID || '',\n    rawJpegUrl: process.env.RAW_JPEG_UPSTREAM_URL || '',"),
    ]
    updated = source
    for old, new in edits:
        if updated.count(old) != 1:
            raise SystemExit(f'Gateway layout differs; refusing unsafe patch: {old}')
        updated = updated.replace(old, new)
    backup = gateway.with_name(gateway.name + '.before-raw-jpeg')
    if not backup.exists(): backup.write_text(source)
    gateway.write_text(updated)
config = compose.read_text()
if 'RAW_JPEG_UPSTREAM_URL:' not in config:
    old = '      IMMICHINKO_UPSTREAM_URL: http://immichinko:3000'
    if config.count(old) != 1: raise SystemExit('Compose layout differs; inspect manually')
    backup = compose.with_name(compose.name + '.before-raw-jpeg')
    if not backup.exists(): backup.write_text(config)
    compose.write_text(config.replace(old, old + '\n      RAW_JPEG_UPSTREAM_URL: ${RAW_JPEG_UPSTREAM_URL:-}'))
print('Optional gateway integration installed; backups preserved.')

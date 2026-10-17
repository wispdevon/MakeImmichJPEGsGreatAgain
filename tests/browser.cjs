// Deterministic Immich toolbar fixture; no live Immich credentials required.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const script = fs.readFileSync('userscript/immich-raw-jpeg.user.js', 'utf8');
const raw = '11111111-1111-4111-8111-111111111111';
const jpg = '22222222-2222-4222-8222-222222222222';
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/assets/')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({type:'IMAGE',originalFileName:req.url.endsWith(raw) ? 'Panasonic.RW2' : 'Photo.JPG'}));
  } else if (req.url.startsWith('/raw-jpeg/assets/')) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.end(Buffer.from([255,216,255,217]));
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Immich toolbar test fixture</title></head>
      <body style="background:#161616;color:white;font-family:sans-serif"><h1>RAW viewer test fixture</h1>
      <div data-testid="asset-viewer-navbar-actions" style="display:flex;gap:8px"><button aria-label="Download" style="color:white;background:#333;border:0;padding:12px;border-radius:24px">↓</button><button aria-label="More" aria-haspopup="true" aria-controls="viewer-menu" aria-expanded="false">⋮</button></div>
      <ul id="viewer-menu" role="menu" hidden><li id="native-download" role="menuitem" style="display:flex;gap:8px;padding:12px">Download</li></ul>
      <script>
        document.querySelector('[aria-label="More"]').onclick = function () {
          const open = this.getAttribute('aria-expanded') !== 'true';
          this.setAttribute('aria-expanded', String(open));
          document.getElementById('viewer-menu').hidden = !open;
        };
      </script>
      <script>${script}</script></body></html>`);
  }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/photos/${raw}`);
    const button = page.getByRole('button', {name:'Download embedded full-resolution JPEG',exact:true});
    await button.waitFor();
    assert.equal(await button.evaluate(el => el.previousElementSibling.getAttribute('aria-label')), 'Download');
    const downloadPromise = page.waitForEvent('download');
    await button.click();
    assert.equal((await downloadPromise).suggestedFilename(), 'Panasonic.jpg');
    const more = page.getByRole('button', {name:'More',exact:true});
    await more.click();
    const menuAction = page.getByRole('menuitem', {name:'Download JPEG',exact:true});
    await menuAction.waitFor();
    assert.equal(await menuAction.evaluate(el => el.previousElementSibling.id), 'native-download');
    const menuDownload = page.waitForEvent('download');
    await menuAction.click();
    assert.equal((await menuDownload).suggestedFilename(), 'Panasonic.jpg');
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    await page.setViewportSize({width:320,height:740});
    await more.click();
    await menuAction.waitFor();
    await more.click();
    await page.evaluate(id => history.pushState({}, '', `/photos/${id}`), jpg);
    await button.waitFor({state:'detached'});
    assert.equal(await page.locator('#immich-raw-jpeg-menu').count(), 0);
    await page.evaluate(id => history.pushState({}, '', `/albums/test/photos/${id}`), raw);
    await button.waitFor();
    await page.route('**/raw-jpeg/assets/*', route => route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({detail:'No supported embedded JPEG found'})}));
    await button.click();
    await page.getByRole('alert').filter({hasText:'No supported embedded JPEG found'}).waitFor();
    assert.equal(await button.isEnabled(), true);
    await page.evaluate(() => history.pushState({}, '', '/photos'));
    await button.waitFor({state:'detached'});
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: icon, adjacency, toolbar/menu downloads, 320px mobile layout, RAW/JPEG navigation, album routes, extraction errors, no console errors.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {console.error(error); server.close(); process.exitCode = 1;});

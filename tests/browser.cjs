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
      <div data-testid="asset-viewer-navbar-actions" style="display:flex;gap:8px"><button aria-label="Download" style="color:white;background:#333;border:0;padding:12px;border-radius:24px">↓</button></div>
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
    const button = page.getByRole('button', {name:'Download full-resolution JPEG',exact:true});
    await button.waitFor();
    assert.equal(await button.evaluate(el => el.previousElementSibling.getAttribute('aria-label')), 'Download');
    const downloadPromise = page.waitForEvent('download');
    await button.click();
    assert.equal((await downloadPromise).suggestedFilename(), 'Panasonic.jpg');
    await page.evaluate(id => history.pushState({}, '', `/photos/${id}`), jpg);
    await button.waitFor({state:'detached'});
    await page.evaluate(id => history.pushState({}, '', `/albums/test/photos/${id}`), raw);
    await button.waitFor();
    await page.route('**/raw-jpeg/assets/*', route => route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({detail:'Unsupported or damaged RAW file'})}));
    await button.click();
    await page.getByRole('alert').filter({hasText:'Unsupported or damaged RAW file'}).waitFor();
    assert.equal(await button.isEnabled(), true);
    await page.evaluate(() => history.pushState({}, '', '/photos'));
    await button.waitFor({state:'detached'});
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: adjacency, download filename, RAW/JPEG navigation, album routes, conversion errors, no console errors.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {console.error(error); server.close(); process.exitCode = 1;});

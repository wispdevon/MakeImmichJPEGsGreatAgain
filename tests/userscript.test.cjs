const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('userscript/immich-raw-jpeg.user.js', 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
async function setup(name, type = 'IMAGE') {
  const dom = new JSDOM('<div data-testid="asset-viewer-navbar-actions"><button aria-label="Download">↓</button></div>', {
    url: `https://photos.example.com/photos/${id}`, runScripts: 'dangerously',
  });
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ type, originalFileName: name }) });
  dom.window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 40));
  return dom;
}
test('RAW JPEG button is adjacent to original download and not duplicated', async () => {
  const dom = await setup('panasonic.RW2');
  const button = dom.window.document.querySelector('#immich-raw-jpeg');
  assert.ok(button);
  assert.equal(button.previousElementSibling.getAttribute('aria-label'), 'Download');
  dom.window.document.body.append(dom.window.document.createElement('div'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(dom.window.document.querySelectorAll('#immich-raw-jpeg').length, 1);
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  await new Promise(resolve => setTimeout(resolve, 0));
  dom.window.close();
});
test('JPEG, PNG, HEIC and videos never show the button', async () => {
  for (const [name, type] of [['photo.JPEG','IMAGE'],['photo.png','IMAGE'],['photo.heic','IMAGE'],['fake.RW2','VIDEO']]) {
    const dom = await setup(name, type);
    assert.equal(dom.window.document.querySelector('#immich-raw-jpeg'), null);
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  await new Promise(resolve => setTimeout(resolve, 0));
  dom.window.close();
  }
});
test('closing viewer removes button', async () => {
  const dom = await setup('photo.NEF');
  dom.window.history.pushState({}, '', '/photos');
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(dom.window.document.querySelector('#immich-raw-jpeg'), null);
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  await new Promise(resolve => setTimeout(resolve, 0));
  dom.window.close();
});

test('toolbar uses an accessible SVG icon instead of a text button', async () => {
  const dom = await setup('photo.RW2');
  try {
    const button = dom.window.document.querySelector('#immich-raw-jpeg');
    assert.ok(button.querySelector('svg[aria-hidden="true"] path'));
    assert.equal(button.textContent.trim(), '');
    assert.equal(button.getAttribute('aria-label'), 'Download embedded full-resolution JPEG');
  } finally {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    await new Promise(resolve => setTimeout(resolve, 0));
    dom.window.close();
  }
});

test('adds RAW action inside the viewer More menu and removes it on JPEG navigation', async () => {
  const dom = await setup('photo.RW2');
  try {
    const toolbar = dom.window.document.querySelector('[data-testid="asset-viewer-navbar-actions"]');
    toolbar.insertAdjacentHTML('beforeend', '<button aria-label="More" aria-haspopup="true" aria-controls="viewer-menu" aria-expanded="true">⋮</button>');
    dom.window.document.body.insertAdjacentHTML('beforeend', '<ul id="viewer-menu" role="menu"><li id="native-download" role="menuitem">Download</li></ul>');
    await new Promise(resolve => setTimeout(resolve, 30));
    const item = dom.window.document.querySelector('#immich-raw-jpeg-menu');
    assert.ok(item);
    assert.equal(item.getAttribute('role'), 'menuitem');
    assert.equal(item.textContent.trim(), 'Download JPEG');
    assert.equal(item.previousElementSibling.id, 'native-download');
    dom.window.fetch = async () => ({ok: true, json: async () => ({type:'IMAGE',originalFileName:'normal.jpg'})});
    dom.window.history.pushState({}, '', '/photos/22222222-2222-4222-8222-222222222222');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(dom.window.document.querySelector('#immich-raw-jpeg-menu'), null);
  } finally {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    await new Promise(resolve => setTimeout(resolve, 0));
    dom.window.close();
  }
});

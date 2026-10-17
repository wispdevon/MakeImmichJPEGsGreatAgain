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

// ==UserScript==
// @name         Make Panasonic Great Again — Immich RAW JPEG
// @namespace    https://github.com/wispdevon/MakePanasonicGreatAgain
// @version      0.2.0
// @description  Download an embedded full-resolution JPEG beside Immich's download button, for RAW photos only.
// @match        https://im.devonlabs.space/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';
  if (window.__immichRawJpegInstalled) return;
  window.__immichRawJpegInstalled = true;
  // Change @match above to your Immich address before installing.
  const rawExtensions = new Set('3fr arw bay cap cr2 cr3 crw dcr dcs dng drf eip erf fff gpr iiq k25 kdc mdc mef mos mrw nef nrw obm orf pef ptx pxn r3d raf raw rw2 rwl rwz sr2 srf srw x3f'.split(' '));
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const assetPattern = new RegExp(`/photos/(${uuid})/?$`, 'i');
  // Download arrow SVG path used by Immich. This also works with translated labels.
  const downloadPath = 'M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z';
  let currentId;
  let currentAsset;
  let generation = 0;
  let pending = false;
  let busy = false;
  let failedAt = 0;

  function assetId() {
    // Shared-link downloads are deliberately excluded; only signed-in sessions are supported.
    if (/^\/(share|s)\//.test(location.pathname)) return null;
    return location.pathname.match(assetPattern)?.[1] ?? null;
  }

  function removeButton() {
    document.getElementById('immich-raw-jpeg')?.remove();
  }

  function findDownload() {
    const toolbar = document.querySelector('[data-testid="asset-viewer-navbar-actions"]');
    const buttons = toolbar ? toolbar.querySelectorAll('button') : document.querySelectorAll('button[aria-label="Download"],button[title="Download"]');
    return Array.from(buttons).find(button => button.id !== 'immich-raw-jpeg' && (
      button.querySelector(`path[d="${downloadPath}"]`) ||
      /^(download|download original)$/i.test(button.getAttribute('aria-label') || button.title || '')
    ));
  }

  function showError(message) {
    let status = document.getElementById('immich-raw-jpeg-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'immich-raw-jpeg-status';
      status.setAttribute('role', 'alert');
      Object.assign(status.style, { position: 'fixed', bottom: '24px', right: '24px',
        zIndex: '2147483647', background: '#282828', color: 'white', padding: '16px',
        borderRadius: '8px', maxWidth: '360px' });
      document.body.append(status);
    }
    status.textContent = message;
    setTimeout(() => status.remove(), 12000);
  }

  async function download(asset, id, button) {
    if (busy || id !== assetId()) return;
    busy = true;
    button.disabled = true;
    button.textContent = 'Extracting…';
    button.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`/raw-jpeg/assets/${id}`, {
        method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(300000),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `JPEG extraction failed (${response.status}). Check the extractor setup.`);
      }
      if (!response.headers.get('content-type')?.startsWith('image/jpeg')) {
        throw new Error('The JPEG extractor is not configured at /raw-jpeg/.');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = asset.originalFileName.replace(/\.[^.]+$/, '.jpg');
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      showError(error.message || 'JPEG extraction failed. Please try again.');
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = 'JPEG ↓';
      button.removeAttribute('aria-busy');
      schedule();
    }
  }

  async function sync() {
    const id = assetId();
    if (id !== currentId) {
      currentId = id;
      currentAsset = undefined;
      failedAt = 0;
      generation++;
      removeButton();
    }
    if (!id) return;
    if (currentAsset === undefined && !pending && Date.now() - failedAt > 5000) {
      pending = true;
      const requestGeneration = generation;
      try {
        const response = await fetch(`/api/assets/${id}`, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('Asset metadata unavailable');
        const asset = await response.json();
        if (requestGeneration !== generation || id !== assetId()) return;
        currentAsset = asset;
      } catch {
        failedAt = Date.now();
      } finally {
        pending = false;
      }
    }
    const extension = currentAsset?.originalFileName?.split('.').pop().toLowerCase();
    if (currentAsset?.type !== 'IMAGE' || !rawExtensions.has(extension)) {
      removeButton();
      return;
    }
    const original = findDownload();
    if (!original || document.getElementById('immich-raw-jpeg')) return;
    const button = document.createElement('button');
    button.id = 'immich-raw-jpeg';
    button.type = 'button';
    button.className = original.className;
    button.textContent = 'JPEG ↓';
    button.title = 'Download embedded full-resolution JPEG';
    button.setAttribute('aria-label', 'Download embedded full-resolution JPEG');
    button.style.paddingInline = '10px';
    button.style.width = 'auto';
    button.style.minWidth = '64px';
    button.style.whiteSpace = 'nowrap';
    button.disabled = busy;
    const asset = currentAsset;
    button.addEventListener('click', () => void download(asset, id, button));
    original.after(button);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; void sync(); });
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  // Also detects pushState navigation with an unchanged DOM; no framework internals needed.
  let interval = setInterval(schedule, 500);
  window.addEventListener('pagehide', () => { observer.disconnect(); clearInterval(interval); });
  window.addEventListener('pageshow', () => {
    clearInterval(interval);
    interval = setInterval(schedule, 500);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  });
  schedule();
})();

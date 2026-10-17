// ==UserScript==
// @name         Make Immich JPEGs Great Again — Immich RAW JPEG
// @namespace    https://github.com/wispdevon/MakeImmichJPEGsGreatAgain
// @version      0.3.0
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
  // Material Design Icons mdiFileJpgBox (Apache-2.0); see THIRD_PARTY_NOTICES.md.
  const jpegPath = 'M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M9 13.5C9 14.6 8.1 15 7 15S5 14.6 5 13.5V12H6.5V13.5H7.5V9H9V13.5M14 11.5C14 12.3 13.3 13 12.5 13H11.5V15H10V9H12.5C13.3 9 14 9.7 14 10.5V11.5M19 10.5H16.5V13.5H17.5V12H19V13.7C19 14.4 18.5 15 17.7 15H16.4C15.6 15 15.1 14.3 15.1 13.7V10.4C15 9.7 15.5 9 16.3 9H17.6C18.4 9 18.9 9.7 18.9 10.3V10.5M11.5 10.5H12.5V11.5H11.5V10.5Z';
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
    document.getElementById('immich-raw-jpeg-menu')?.remove();
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

  function jpegIcon(size) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.flexShrink = '0';
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', jpegPath);
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  }

  function refreshBusy() {
    for (const action of document.querySelectorAll('[data-raw-jpeg-action]')) {
      if (action.tagName === 'BUTTON') action.disabled = busy;
      action.setAttribute('aria-disabled', String(busy));
      action.setAttribute('aria-busy', String(busy));
      action.title = busy ? 'Extracting embedded JPEG…' : 'Download embedded full-resolution JPEG';
      action.style.opacity = busy ? '0.5' : '';
    }
  }

  function addActions(asset, id) {
    const original = findDownload();
    if (original && !document.getElementById('immich-raw-jpeg')) {
      const button = document.createElement('button');
      button.id = 'immich-raw-jpeg';
      button.type = 'button';
      button.className = original.className;
      button.setAttribute('data-raw-jpeg-action', 'toolbar');
      button.setAttribute('aria-label', 'Download embedded full-resolution JPEG');
      button.append(jpegIcon('24'));
      button.addEventListener('click', () => void download(asset, id));
      original.after(button);
    }

    const toolbar = document.querySelector('[data-testid="asset-viewer-navbar-actions"]');
    const more = toolbar?.querySelector('button[aria-haspopup][aria-controls]');
    const menu = more && document.getElementById(more.getAttribute('aria-controls'));
    if (menu?.getAttribute('role') === 'menu' && !menu.querySelector('#immich-raw-jpeg-menu')) {
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      const nativeDownload = items.find(item => item.querySelector(`path[d="${downloadPath}"]`) || /^download$/i.test(item.textContent.trim()));
      const template = nativeDownload || items[0];
      if (!template) return;
      const item = document.createElement('li');
      item.id = 'immich-raw-jpeg-menu';
      item.className = template.className;
      item.setAttribute('role', 'menuitem');
      item.setAttribute('data-raw-jpeg-action', 'menu');
      item.tabIndex = -1;
      const label = document.createElement('span');
      label.textContent = 'Download JPEG';
      item.append(jpegIcon('18'), label);
      item.addEventListener('click', () => {
        if (busy || id !== assetId()) return;
        if (more.getAttribute('aria-expanded') === 'true') more.click();
        void download(asset, id);
      });
      // Immich navigates direct menu children by id and activates them with click().
      // A native menuitem preserves its Arrow/Enter/Space/Escape handling.
      if (nativeDownload) nativeDownload.after(item);
      else template.before(item);
    }
    refreshBusy();
  }

  async function download(asset, id) {
    if (busy || id !== assetId()) return;
    busy = true;
    refreshBusy();
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
      refreshBusy();
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
    addActions(currentAsset, id);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; void sync(); });
  }
  const style = document.createElement('style');
  style.textContent = '#immich-raw-jpeg-menu:hover, [aria-activedescendant="immich-raw-jpeg-menu"] > #immich-raw-jpeg-menu { background-color: rgb(203 213 225); }';
  document.head.append(style);
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

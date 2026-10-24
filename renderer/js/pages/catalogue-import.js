import { icon } from '../icons.js';
import {
  escapeHtml,
  money,
  pageHead,
  parseNumber,
  qty,
  setButtonLoading,
  toast
} from '../ui.js';

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const PROVIDER_LABELS = {
  gemini: 'Google Gemini',
  openai: 'OpenAI'
};

const state = {
  file: null,
  fileName: '',
  fileSize: 0,
  busy: false,
  importing: false,
  startedAt: 0,
  error: '',
  keySet: false,
  provider: 'gemini',
  model: '',
  supplier: '',
  items: [],
  warnings: [],
  selected: new Set(),
  updateDetails: true,
  addStock: true,
  result: null
};

let pageRoot = null;
let pageAbort = null;
let elapsedTimer = null;
let ctxRef = null;

function providerLabel(provider = state.provider) {
  return PROVIDER_LABELS[provider] ?? 'AI';
}

function fileSizeText(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function importable(row) {
  return row.status === 'new' || row.status === 'update';
}

function selectedIndexes() {
  return state.items
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => importable(row) && state.selected.has(index))
    .map(({ index }) => index);
}

function statusChip(row) {
  if (row.status === 'new') return '<span class="chip chip-green">New item</span>';
  if (row.status === 'update') return '<span class="chip chip-accent">Update</span>';
  if (row.status === 'archived') return '<span class="chip chip-neutral">Archived</span>';
  return '<span class="chip chip-low">Needs attention</span>';
}

function counts() {
  const result = { new: 0, update: 0, archived: 0, invalid: 0 };
  for (const row of state.items) {
    if (Object.hasOwn(result, row.status)) result[row.status] += 1;
  }
  return result;
}

function startOver() {
  state.file = null;
  state.fileName = '';
  state.fileSize = 0;
  state.busy = false;
  state.importing = false;
  state.startedAt = 0;
  state.error = '';
  state.supplier = '';
  state.items = [];
  state.warnings = [];
  state.selected = new Set();
  state.updateDetails = true;
  state.addStock = true;
  state.result = null;
  stopElapsed();
  paint();
}

function dropzoneMarkup() {
  return `
    <div class="import-dropzone" data-dropzone role="button" tabindex="0" aria-label="Choose a PDF catalogue">
      <span class="import-dropzone-icon">${icon('upload')}</span>
      <div class="import-dropzone-title">Drop your PDF here</div>
      <div class="import-dropzone-text">or click to choose a catalogue or price list from this Mac</div>
      <span class="btn btn-primary">${icon('folder')} Choose PDF</span>
    </div>
    <input type="file" accept="application/pdf,.pdf" class="sr-only" data-file-input tabindex="-1" />
  `;
}

function fileMarkup() {
  const actionLabel = state.error ? 'Try again' : 'Extract products';
  return `
    <div class="import-file">
      <span class="import-file-icon">${icon('fileText')}</span>
      <div class="import-file-copy">
        <div class="import-file-name">${escapeHtml(state.fileName)}</div>
        <div class="import-file-meta">${escapeHtml(fileSizeText(state.fileSize))} · Ready to read</div>
      </div>
      <div class="import-file-actions">
        <button type="button" class="btn btn-sm" data-choose-another>Change PDF</button>
        <button type="button" class="btn btn-sm btn-primary" data-extract>${icon('sparkle')} ${actionLabel}</button>
      </div>
    </div>
    <input type="file" accept="application/pdf,.pdf" class="sr-only" data-file-input tabindex="-1" />
  `;
}

function busyMarkup() {
  return `
    <div class="import-busy">
      <span class="import-spinner" aria-hidden="true"></span>
      <div class="import-busy-copy">
        <div class="import-busy-title">Reading ${escapeHtml(state.fileName)} with ${escapeHtml(providerLabel())}…</div>
        <div class="import-busy-text">Large catalogues can take up to a minute. Keep this window open. <span data-elapsed></span></div>
      </div>
    </div>
  `;
}

function setupNoticeMarkup() {
  if (state.keySet) return '';
  return `
    <div class="import-notice import-notice-warn">
      <span class="import-notice-icon">${icon('sparkle')}</span>
      <div class="import-notice-copy">
        <strong>Add an AI API key first</strong>
        <span>Reading PDFs uses ${escapeHtml(providerLabel())}. Save your key under Settings → AI catalogue, then come back here.</span>
      </div>
      <button type="button" class="btn btn-sm" data-nav="/settings?section=ai">Open AI settings</button>
    </div>
  `;
}

function errorNoticeMarkup() {
  if (!state.error) return '';
  return `
    <div class="import-notice import-notice-error">
      <span class="import-notice-icon">${icon('alert')}</span>
      <div class="import-notice-copy">
        <strong>The catalogue could not be read</strong>
        <span>${escapeHtml(state.error)}</span>
      </div>
    </div>
  `;
}

function uploadCardMarkup() {
  return `
    <section class="card import-card">
      <div class="setting-section-head">
        <div>
          <h2 class="setting-section-title">1 · Upload the catalogue</h2>
          <div class="setting-section-sub">Pick a PDF catalogue or price list. ${escapeHtml(providerLabel())} reads it and prepares the changes for you to review.</div>
        </div>
        <span class="chip chip-neutral">PDF · up to 25 MB</span>
      </div>
      <div class="setting-section-body">
        ${setupNoticeMarkup()}
        ${errorNoticeMarkup()}
        ${state.busy ? busyMarkup() : state.file ? fileMarkup() : dropzoneMarkup()}
        <p class="import-privacy">${icon('shield')} The chosen PDF is sent to ${escapeHtml(providerLabel())} only when you extract. Bills, customers and your saved catalogue stay on this Mac.</p>
      </div>
    </section>
  `;
}

function warningsMarkup() {
  if (!state.warnings.length) return '';
  const warnings = [...new Set(state.warnings)].slice(0, 6);
  const remaining = state.warnings.length - warnings.length;
  return `
    <div class="import-notice import-notice-warn">
      <span class="import-notice-icon">${icon('alert')}</span>
      <div class="import-notice-copy">
        <strong>Check these while reviewing</strong>
        <ul class="import-warning-list">
          ${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}
          ${remaining > 0 ? `<li>…and ${remaining} more note${remaining === 1 ? '' : 's'} from the AI.</li>` : ''}
        </ul>
      </div>
    </div>
  `;
}

function priceMarkup(row) {
  if (row.price == null) return '<span class="cell-secondary">Not listed in the PDF</span>';
  const unit = row.sellUnit === 'box' ? 'box' : 'sq ft';
  let alternative = '';
  if (row.sqftPerBox > 0) {
    alternative = row.sellUnit === 'box'
      ? `≈ ₹${money(row.price / row.sqftPerBox)} / sq ft`
      : `≈ ₹${money(row.price * row.sqftPerBox)} / box`;
  }
  const changed = row.matchId && row.matchPrice != null && Number(row.matchPrice) !== Number(row.price);
  return `
    <div class="price-stack">
      <span class="price-main">₹${money(row.price)} <span class="muted" style="font-size:9px;font-weight:500;">/ ${unit}</span></span>
      ${alternative ? `<span class="price-sub">${alternative}</span>` : ''}
      ${changed ? `<span class="import-was">was ₹${money(row.matchPrice)} / ${row.matchSellUnit === 'box' ? 'box' : 'sq ft'}</span>` : ''}
    </div>
  `;
}

function stockMarkup(row, index) {
  const enabled = importable(row) && state.addStock && state.selected.has(index);
  const onHand = row.matchId ? `${qty(Number(row.matchStock) || 0)} boxes on hand` : 'New catalogue item';
  return `
    <div class="import-stock">
      <span class="cell-secondary">${escapeHtml(onHand)}</span>
      <div class="input-affix import-stock-field">
        <span class="affix">+</span>
        <input class="input input-sm has-suffix" data-stock-row="${index}" value="${escapeHtml(String(row.stockBoxes ?? 0))}" inputmode="decimal" aria-label="Boxes to add for ${escapeHtml(row.name || 'item')}"${enabled ? '' : ' disabled'} />
        <span class="affix affix-right">box</span>
      </div>
    </div>
  `;
}

function rowMarkup(row, index) {
  const canImport = importable(row);
  const checked = state.selected.has(index);
  const name = row.name || 'Unnamed item';
  const meta = [row.brand, row.sku, row.category].filter(Boolean).map(escapeHtml).join(' · ');
  const errors = Array.isArray(row.errors) ? row.errors : [];
  const classes = ['import-row'];
  if (!canImport) classes.push('is-skipped');
  if (!checked) classes.push('is-unselected');

  return `
    <tr class="${classes.join(' ')}">
      <td class="import-check-cell">
        <input type="checkbox" class="import-check" data-select-row="${index}" ${checked && canImport ? 'checked' : ''} ${canImport ? '' : 'disabled'} aria-label="Include ${escapeHtml(name)}" />
      </td>
      <td>
        <div class="cell-stack">
          <span class="cell-primary">${escapeHtml(name)}</span>
          <span class="cell-secondary">#${row.rowNumber}${meta ? ` · ${meta}` : ''}</span>
          ${row.matchId ? `<span class="import-match">Matches “${escapeHtml(row.matchName)}”</span>` : ''}
          ${errors.length
            ? `<span class="import-row-error">${escapeHtml(errors.join(' '))}</span>`
            : row.status === 'archived'
              ? '<span class="import-row-error">Archived — restore it from Products before importing.</span>'
              : ''}
        </div>
      </td>
      <td>${priceMarkup(row)}</td>
      <td>${stockMarkup(row, index)}</td>
      <td>${statusChip(row)}</td>
    </tr>
  `;
}

function previewMarkup() {
  const tally = counts();
  const attention = tally.archived + tally.invalid;
  const selectedCount = selectedIndexes().length;
  return `
    <section class="card import-preview">
      <div class="setting-section-head">
        <div>
          <h2 class="setting-section-title">2 · Review what will change</h2>
          <div class="setting-section-sub">
            ${state.items.length} product${state.items.length === 1 ? '' : 's'} found in ${escapeHtml(state.fileName)}${state.supplier ? ` · ${escapeHtml(state.supplier)}` : ''} · ${escapeHtml(providerLabel())}${state.model ? ` · ${escapeHtml(state.model)}` : ''}
          </div>
        </div>
        <button type="button" class="btn btn-sm btn-ghost" data-reset-import>Start over</button>
      </div>
      <div class="setting-section-body">
        ${warningsMarkup()}
        <div class="import-summary">
          <div class="import-stat">
            <span class="import-stat-value">${tally.new}</span>
            <span class="import-stat-label">New items</span>
          </div>
          <div class="import-stat is-accent">
            <span class="import-stat-value">${tally.update}</span>
            <span class="import-stat-label">Matches to update</span>
          </div>
          <div class="import-stat${attention ? ' is-danger' : ''}">
            <span class="import-stat-value">${attention}</span>
            <span class="import-stat-label">Need attention</span>
          </div>
          <div class="import-stat is-muted">
            <span class="import-stat-value" data-import-stat-stock>${state.addStock ? qty(selectedIndexes().reduce((sum, index) => sum + (Number(state.items[index].stockBoxes) || 0), 0)) : '—'}</span>
            <span class="import-stat-label">Boxes to add</span>
          </div>
        </div>
        <p class="import-help">Matching items are updated with the PDF price and details. Stock quantities below are <strong>added</strong> to what you already have. Rows that need attention are skipped; fix them in Products and run the import again.</p>
      </div>
      <div class="page-toolbar import-toolbar">
        <label class="import-select-all">
          <input type="checkbox" data-select-all ${selectedCount > 0 ? 'checked' : ''} />
          <span>Select all importable rows</span>
        </label>
        <div class="import-toggles">
          <label class="switch import-switch">
            <input type="checkbox" data-update-details${state.updateDetails ? ' checked' : ''} />
            <span class="switch-track"></span>
            <span>Update item details</span>
          </label>
          <label class="switch import-switch">
            <input type="checkbox" data-add-stock${state.addStock ? ' checked' : ''} />
            <span class="switch-track"></span>
            <span>Add to stock</span>
          </label>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table import-table">
          <thead>
            <tr>
              <th class="import-check-cell"></th>
              <th>Item</th>
              <th>Price</th>
              <th>Add stock</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${state.items.map(rowMarkup).join('')}</tbody>
        </table>
      </div>
      <div class="import-foot">
        <div class="import-foot-copy">
          <span data-import-selection>${selectedCount} of ${state.items.length} selected</span>
          <span class="cell-secondary" data-import-stock-total>${state.addStock ? `${qty(selectedIndexes().reduce((sum, index) => sum + (Number(state.items[index].stockBoxes) || 0), 0))} boxes will be added` : 'Stock will not change'}</span>
        </div>
        <button type="button" class="btn btn-primary" data-import ${selectedCount ? '' : 'disabled'}>
          ${icon('check')} <span data-import-label>Import ${selectedCount} item${selectedCount === 1 ? '' : 's'}</span>
        </button>
      </div>
    </section>
  `;
}

function skippedMarkup(rows) {
  if (!rows?.length) return '';
  const shown = rows.slice(0, 12);
  return `
    <div class="import-skipped">
      <div class="import-skipped-title">${icon('alert')} Skipped ${rows.length} row${rows.length === 1 ? '' : 's'}</div>
      <ul>
        ${shown.map((row) => `
          <li>
            <span>#${row.rowNumber}${row.name ? ` · ${escapeHtml(row.name)}` : ''}</span>
            <span>${escapeHtml(row.error)}</span>
          </li>
        `).join('')}
      </ul>
      ${rows.length > shown.length ? `<p class="hint">…and ${rows.length - shown.length} more. Fix these in Products and import the PDF again.</p>` : ''}
    </div>
  `;
}

function resultMarkup() {
  const result = state.result;
  const changed = (result.created ?? 0) + (result.updated ?? 0);
  return `
    <section class="card import-result">
      <div class="setting-section-head">
        <div>
          <h2 class="setting-section-title">3 · Import complete</h2>
          <div class="setting-section-sub">${escapeHtml(state.fileName)} has been applied to the catalogue.</div>
        </div>
        <span class="chip chip-green">${icon('check')} Done</span>
      </div>
      <div class="setting-section-body">
        <div class="import-done-head">
          <span class="import-done-icon">${icon('checkCircle')}</span>
          <div>
            <div class="import-done-title">${changed ? `${changed} catalogue item${changed === 1 ? '' : 's'} updated` : 'Nothing needed updating'}</div>
            <div class="import-done-text">${result.stockAddedBoxes > 0 ? `${qty(result.stockAddedBoxes)} boxes were added to stock and recorded in the stock ledger.` : 'No stock quantities were added.'}</div>
          </div>
        </div>
        <div class="metric-strip import-metrics">
          <div class="metric-cell">
            <div class="metric-copy">
              <div class="metric-label">New items</div>
              <div class="metric-value">${result.created ?? 0}</div>
              <div class="metric-sub">Added to the catalogue</div>
            </div>
          </div>
          <div class="metric-cell">
            <div class="metric-copy">
              <div class="metric-label">Items updated</div>
              <div class="metric-value">${result.updated ?? 0}</div>
              <div class="metric-sub">${result.detailsUpdated ?? 0} with new details</div>
            </div>
          </div>
          <div class="metric-cell">
            <div class="metric-copy">
              <div class="metric-label">Stock added</div>
              <div class="metric-value">${qty(result.stockAddedBoxes ?? 0)}</div>
              <div class="metric-sub">boxes across ${result.results?.filter((entry) => entry.stockAdded > 0).length ?? 0} items</div>
            </div>
          </div>
          <div class="metric-cell">
            <div class="metric-copy">
              <div class="metric-label">Skipped</div>
              <div class="metric-value" style="${result.skipped ? 'color:var(--red);' : ''}">${result.skipped ?? 0}</div>
              <div class="metric-sub">${result.skipped ? 'See reasons below' : 'Every selected row imported'}</div>
            </div>
          </div>
        </div>
        ${skippedMarkup(result.skippedRows)}
        <div class="import-result-actions">
          <button type="button" class="btn" data-nav="/products">${icon('products')} Open products</button>
          <button type="button" class="btn" data-nav="/stock">${icon('stock')} View stock ledger</button>
          <button type="button" class="btn btn-primary" data-reset-import>${icon('upload')} Import another catalogue</button>
        </div>
      </div>
    </section>
  `;
}

function paint() {
  if (!pageRoot) return;
  const upload = pageRoot.querySelector('[data-import-upload]');
  if (upload) upload.innerHTML = state.result ? '' : uploadCardMarkup();
  const preview = pageRoot.querySelector('[data-import-preview]');
  if (preview) preview.innerHTML = state.result ? resultMarkup() : state.items.length ? previewMarkup() : '';
  if (state.busy) startElapsed();
  else stopElapsed();
  refreshElapsed();
}

function startElapsed() {
  if (elapsedTimer) return;
  elapsedTimer = window.setInterval(refreshElapsed, 1000);
}

function stopElapsed() {
  if (!elapsedTimer) return;
  window.clearInterval(elapsedTimer);
  elapsedTimer = null;
}

function refreshElapsed() {
  const target = pageRoot?.querySelector('[data-elapsed]');
  if (!target || !state.busy || !state.startedAt) return;
  const seconds = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
  target.textContent = seconds >= 3 ? `${seconds}s elapsed` : '';
}

function syncSelectionUi() {
  if (!pageRoot) return;
  let selectable = 0;
  for (const checkbox of pageRoot.querySelectorAll('[data-select-row]')) {
    const index = Number(checkbox.dataset.selectRow);
    const row = state.items[index];
    if (!row) continue;
    if (importable(row)) selectable += 1;
    checkbox.checked = importable(row) && state.selected.has(index);
    checkbox.closest('tr')?.classList.toggle('is-unselected', !checkbox.checked);
  }
  for (const input of pageRoot.querySelectorAll('[data-stock-row]')) {
    const index = Number(input.dataset.stockRow);
    const row = state.items[index];
    input.disabled = !row || !importable(row) || !state.addStock || !state.selected.has(index);
  }
  const selectAll = pageRoot.querySelector('[data-select-all]');
  if (selectAll) {
    selectAll.checked = selectable > 0 && state.selected.size >= selectable;
    selectAll.indeterminate = state.selected.size > 0 && state.selected.size < selectable;
    selectAll.disabled = selectable === 0;
  }
  refreshImportFoot();
}

function refreshImportFoot() {
  if (!pageRoot) return;
  const indexes = selectedIndexes();
  const count = indexes.length;
  const selection = pageRoot.querySelector('[data-import-selection]');
  if (selection) selection.textContent = `${count} of ${state.items.length} selected`;
  const stockTotal = indexes.reduce((sum, index) => sum + (Number(state.items[index].stockBoxes) || 0), 0);
  const stockLabel = pageRoot.querySelector('[data-import-stock-total]');
  if (stockLabel) stockLabel.textContent = state.addStock ? `${qty(stockTotal)} boxes will be added` : 'Stock will not change';
  const stockStat = pageRoot.querySelector('[data-import-stat-stock]');
  if (stockStat) stockStat.textContent = state.addStock ? qty(stockTotal) : '—';
  const button = pageRoot.querySelector('[data-import]');
  if (button) {
    button.disabled = state.importing || count === 0;
    const label = button.querySelector('[data-import-label]');
    if (label) label.textContent = `Import ${count} item${count === 1 ? '' : 's'}`;
  }
}

function acceptFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    toast('Choose a PDF catalogue or price list.', 'error');
    return;
  }
  if (!file.size) {
    toast('That PDF is empty.', 'error');
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    toast('That PDF is larger than 25 MB. Try a smaller catalogue.', 'error');
    return;
  }
  state.file = file;
  state.fileName = file.name;
  state.fileSize = file.size;
  state.error = '';
  state.items = [];
  state.warnings = [];
  state.selected = new Set();
  state.result = null;
  paint();
}

function chooseFile() {
  pageRoot?.querySelector('[data-file-input]')?.click();
}

async function extractCatalogue() {
  if (!state.file || state.busy) return;
  if (!state.keySet) {
    toast('Add an AI API key in Settings → AI catalogue first.', 'info');
    return;
  }
  state.busy = true;
  state.error = '';
  state.startedAt = Date.now();
  paint();
  try {
    const data = await state.file.arrayBuffer();
    const result = await window.tiledesk.catalogue.extract({ data, fileName: state.fileName });
    const items = Array.isArray(result?.items) ? result.items : [];
    state.items = items;
    state.warnings = Array.isArray(result?.warnings) ? result.warnings : [];
    state.supplier = result?.supplier ?? '';
    state.provider = result?.provider ?? state.provider;
    state.model = result?.model ?? state.model;
    state.selected = new Set(
      items.map((row, index) => (importable(row) ? index : -1)).filter((index) => index >= 0)
    );
  } catch (error) {
    state.error = error?.message || 'The catalogue could not be read.';
  } finally {
    state.busy = false;
    state.startedAt = 0;
    stopElapsed();
    paint();
  }
  if (state.items.length && !state.error) {
    toast(`${state.items.length} products read from the catalogue`, 'success');
    window.requestAnimationFrame(() => {
      pageRoot?.querySelector('.import-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function importPayload() {
  return selectedIndexes().map((index) => {
    const row = state.items[index];
    return {
      matchId: row.matchId ?? null,
      name: row.name,
      sku: row.sku || '',
      brand: row.brand || '',
      category: row.category || '',
      size: row.size || '',
      finish: row.finish || '',
      hsn: row.hsn || '',
      gstRate: row.gstRate ?? 0,
      sellUnit: row.sellUnit || 'sqft',
      price: row.price ?? 0,
      costPerBox: row.costPerBox ?? 0,
      sqftPerBox: row.sqftPerBox ?? 0,
      pcsPerBox: row.pcsPerBox ?? 0,
      stockBoxes: Math.max(0, Math.min(Number(row.stockBoxes) || 0, 1000000)),
      reorderLevel: row.reorderLevel ?? 0,
      batchNo: row.batchNo || '',
      notes: row.notes || ''
    };
  });
}

async function runImport(button) {
  if (state.importing) return;
  const items = importPayload();
  if (!items.length) {
    toast('Select at least one item to import.', 'info');
    return;
  }
  if (!state.updateDetails && !state.addStock) {
    toast('Turn on “Update item details” or “Add to stock” so the import has something to do.', 'info');
    return;
  }
  state.importing = true;
  for (const control of pageRoot?.querySelectorAll('[data-select-row], [data-select-all], [data-update-details], [data-add-stock], [data-reset-import], [data-stock-row]') ?? []) {
    control.disabled = true;
  }
  setButtonLoading(button, true, 'Importing…');
  try {
    const result = await window.tiledesk.catalogue.import({
      items,
      updateDetails: state.updateDetails,
      addStock: state.addStock,
      source: state.fileName
    });
    state.result = result;
    state.items = [];
    state.warnings = [];
    state.selected = new Set();
    state.importing = false;
    await ctxRef?.refreshShell?.();
    paint();
    document.getElementById('main')?.scrollTo({ top: 0, behavior: 'smooth' });
    toast(
      `Imported ${(result.created ?? 0) + (result.updated ?? 0)} item${(result.created ?? 0) + (result.updated ?? 0) === 1 ? '' : 's'}`,
      'success'
    );
  } catch (error) {
    state.importing = false;
    setButtonLoading(button, false);
    syncSelectionUi();
    toast(error.message, 'error');
  }
}

function bindEvents() {
  const options = { signal: pageAbort.signal };

  pageRoot.addEventListener(
    'click',
    (event) => {
      const zone = event.target.closest('[data-dropzone]');
      if (zone) {
        event.preventDefault();
        chooseFile();
        return;
      }
      if (event.target.closest('[data-choose-another]')) {
        chooseFile();
        return;
      }
      const extract = event.target.closest('[data-extract]');
      if (extract) {
        void extractCatalogue();
        return;
      }
      const reset = event.target.closest('[data-reset-import]');
      if (reset) {
        startOver();
        return;
      }
      const importButton = event.target.closest('[data-import]');
      if (importButton) {
        void runImport(importButton);
      }
    },
    options
  );

  pageRoot.addEventListener(
    'keydown',
    (event) => {
      if (!event.target.closest('[data-dropzone]')) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        chooseFile();
      }
    },
    options
  );

  pageRoot.addEventListener(
    'change',
    (event) => {
      if (event.target.matches('[data-file-input]')) {
        const file = event.target.files?.[0];
        event.target.value = '';
        acceptFile(file);
        return;
      }
      if (event.target.matches('[data-select-row]')) {
        const index = Number(event.target.dataset.selectRow);
        if (event.target.checked) state.selected.add(index);
        else state.selected.delete(index);
        syncSelectionUi();
        return;
      }
      if (event.target.matches('[data-select-all]')) {
        const selectable = state.items
          .map((row, index) => ({ row, index }))
          .filter(({ row }) => importable(row));
        if (event.target.checked) selectable.forEach(({ index }) => state.selected.add(index));
        else state.selected.clear();
        syncSelectionUi();
        return;
      }
      if (event.target.matches('[data-update-details]')) {
        state.updateDetails = event.target.checked;
        return;
      }
      if (event.target.matches('[data-add-stock]')) {
        state.addStock = event.target.checked;
        syncSelectionUi();
        return;
      }
      if (event.target.matches('[data-stock-row]')) {
        const index = Number(event.target.dataset.stockRow);
        const row = state.items[index];
        if (!row) return;
        const value = parseNumber(event.target.value, 0);
        row.stockBoxes = Math.max(0, Math.min(value, 1000000));
        event.target.value = String(row.stockBoxes);
        refreshImportFoot();
      }
    },
    options
  );

  pageRoot.addEventListener(
    'input',
    (event) => {
      if (!event.target.matches('[data-stock-row]')) return;
      const index = Number(event.target.dataset.stockRow);
      const row = state.items[index];
      if (!row) return;
      const value = Number(event.target.value);
      row.stockBoxes = Number.isFinite(value) && value >= 0 ? Math.min(value, 1000000) : 0;
      refreshImportFoot();
    },
    options
  );

  document.addEventListener(
    'dragover',
    (event) => {
      if (!pageRoot) return;
      const zone = event.target.closest?.('[data-dropzone]');
      if (!zone) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      zone.classList.add('is-dragging');
    },
    options
  );

  document.addEventListener(
    'dragleave',
    (event) => {
      const zone = event.target.closest?.('[data-dropzone]');
      if (!zone) return;
      if (!event.relatedTarget || !zone.contains(event.relatedTarget)) zone.classList.remove('is-dragging');
    },
    options
  );

  document.addEventListener(
    'drop',
    (event) => {
      if (!pageRoot) return;
      const zone = event.target.closest?.('[data-dropzone]');
      if (!zone) return;
      event.preventDefault();
      zone.classList.remove('is-dragging');
      acceptFile(event.dataTransfer?.files?.[0]);
    },
    options
  );
}

export async function render(root, ctx) {
  if (pageAbort) pageAbort.abort();
  pageAbort = new AbortController();
  pageRoot = root;
  ctxRef = ctx;
  stopElapsed();

  state.file = null;
  state.fileName = '';
  state.fileSize = 0;
  state.busy = false;
  state.importing = false;
  state.startedAt = 0;
  state.error = '';
  state.supplier = '';
  state.items = [];
  state.warnings = [];
  state.selected = new Set();
  state.updateDetails = true;
  state.addStock = true;
  state.result = null;

  const settings = await window.tiledesk.settings.get();
  state.keySet = Boolean(settings?.aiKeySet);
  state.provider = settings?.aiProvider || 'gemini';
  state.model = settings?.aiModel || '';

  root.innerHTML = `
    <div class="page import-page" data-testid="catalogue-import">
      ${pageHead({
        eyebrow: 'Catalogue',
        title: 'Import a catalogue',
        subtitle: 'Upload a PDF catalogue or price list. AI reads it, then you review every change before anything is saved.',
        back: { href: '/products', label: 'Back to products' },
        actions: `<button type="button" class="btn" data-nav="/settings?section=ai">${icon('sparkle')} AI settings</button>`
      })}
      <div class="import-stack">
        <div data-import-upload></div>
        <div data-import-preview></div>
      </div>
    </div>
  `;

  paint();
  bindEvents();
}

export function cleanup() {
  if (pageAbort) {
    pageAbort.abort();
    pageAbort = null;
  }
  stopElapsed();
  pageRoot = null;
  ctxRef = null;
}

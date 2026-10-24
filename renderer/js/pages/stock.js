import { todayISO } from '../../../shared/format.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import {
  dateText,
  debounce,
  downloadCsv,
  emptyState,
  escapeHtml,
  money,
  pageHead,
  parseNumber,
  qty,
  setButtonLoading,
  showFormError,
  clearFormError,
  toast
} from '../ui.js';

const MOVEMENT_TYPES = [
  { value: '', label: 'All movements' },
  { value: 'purchase', label: 'Stock in' },
  { value: 'sale', label: 'Sales' },
  { value: 'adjustment', label: 'Adjustments' },
  { value: 'void', label: 'Invoice voids' },
  { value: 'delete', label: 'Bill deletions' },
  { value: 'opening', label: 'Opening stock' }
];

const TYPE_LABELS = {
  purchase: 'Stock in',
  sale: 'Sale',
  adjustment: 'Adjustment',
  void: 'Invoice void',
  delete: 'Bill deletion',
  opening: 'Opening stock'
};

const view = {
  search: '',
  type: ''
};

let pageAbort = null;
let searchTimer = null;
let pageRoot = null;
let productsCache = [];
let movementsCache = [];
let lineSequence = 0;
let lines = [];
let formContext = null;

function newLine(preset = {}) {
  lineSequence += 1;
  return {
    key: `line-${lineSequence}`,
    productId: preset.productId ?? null,
    qty: preset.qty ?? '',
    cost: preset.cost ?? ''
  };
}

function activeProducts() {
  return productsCache.filter((product) => product.active);
}

function productOptions(selected) {
  return `<option value="">Choose an item…</option>${activeProducts()
    .map(
      (product) =>
        `<option value="${product.id}"${Number(selected) === product.id ? ' selected' : ''}>${escapeHtml(product.name)}${product.sku ? ` · ${escapeHtml(product.sku)}` : ''} · ${qty(product.stockBoxes)} boxes</option>`
    )
    .join('')}`;
}

function metricsMarkup() {
  const active = activeProducts();
  const lowCount = active.filter((product) => product.isLowStock).length;
  const boxes = active.reduce((sum, product) => sum + product.stockBoxes, 0);
  const area = active.reduce((sum, product) => sum + product.stockSqft, 0);
  const cost = active.reduce((sum, product) => sum + product.stockValueCost, 0);

  return `
    <div class="metric-cell">
      <span class="metric-icon">${icon('products')}</span>
      <div class="metric-copy">
        <div class="metric-label">Active items</div>
        <div class="metric-value">${active.length}</div>
        <div class="metric-sub">Across all categories</div>
      </div>
    </div>
    <div class="metric-cell">
      <span class="metric-icon warn">${icon('alert')}</span>
      <div class="metric-copy">
        <div class="metric-label">Low stock</div>
        <div class="metric-value" style="${lowCount ? 'color:var(--red);' : ''}">${lowCount}</div>
        <div class="metric-sub">${lowCount ? 'Reorder soon' : 'All above reorder level'}</div>
      </div>
    </div>
    <div class="metric-cell">
      <span class="metric-icon">${icon('stock')}</span>
      <div class="metric-copy">
        <div class="metric-label">Stock on hand</div>
        <div class="metric-value">${qty(boxes)} <span class="muted" style="font-size:10px;font-weight:500;">boxes</span></div>
        <div class="metric-sub">${qty(area)} sq ft</div>
      </div>
    </div>
    <div class="metric-cell">
      <span class="metric-icon">${icon('coins')}</span>
      <div class="metric-copy">
        <div class="metric-label">Stock at cost</div>
        <div class="metric-value">₹${money(cost, { decimals: 0 })}</div>
        <div class="metric-sub">Weighted average cost</div>
      </div>
    </div>
  `;
}

function lineMarkup(line) {
  const product = activeProducts().find((entry) => entry.id === Number(line.productId));
  const amount = parseNumber(line.qty) * parseNumber(line.cost);
  const totalText = line.qty === '' || !product
    ? '—'
    : `${qty(parseNumber(line.qty))} boxes · ₹${money(amount)}`;
  return `
    <div class="stock-line" data-line-key="${line.key}">
      <div class="stock-line-field">
        <div class="stock-line-label"><span>Item</span><span>${product ? `${qty(product.stockBoxes)} in stock` : ''}</span></div>
        <select class="select" data-line-product aria-label="Item">${productOptions(line.productId)}</select>
      </div>
      <div class="stock-line-field">
        <div class="stock-line-label"><span>Boxes</span></div>
        <input class="input" data-line-qty value="${escapeHtml(line.qty)}" placeholder="0" inputmode="decimal" aria-label="Boxes received" />
      </div>
      <div class="stock-line-field">
        <div class="stock-line-label"><span>Cost / box</span></div>
        <input class="input" data-line-cost value="${escapeHtml(line.cost)}" placeholder="0.00" inputmode="decimal" aria-label="Cost per box" />
      </div>
      <button type="button" class="btn btn-icon stock-line-remove" data-remove-line title="Remove line" aria-label="Remove line">${icon('trash')}</button>
      <div class="stock-line-total" data-line-total>${totalText}</div>
    </div>
  `;
}

function renderLines() {
  const container = pageRoot?.querySelector('[data-stock-lines]');
  if (!container) return;
  container.innerHTML = lines.map(lineMarkup).join('');
  updateSummary();
}

function updateSummary() {
  if (!pageRoot) return;
  const totalBoxes = lines.reduce((sum, line) => sum + (line.productId ? parseNumber(line.qty) : 0), 0);
  const totalValue = lines.reduce(
    (sum, line) => sum + (line.productId ? parseNumber(line.qty) * parseNumber(line.cost) : 0),
    0
  );
  const summary = pageRoot.querySelector('[data-stock-summary]');
  if (summary) {
    summary.textContent = `${qty(totalBoxes)} boxes · ₹${money(totalValue)}`;
  }
  for (const element of pageRoot.querySelectorAll('.stock-line')) {
    const line = lines.find((entry) => entry.key === element.dataset.lineKey);
    if (!line) continue;
    const total = element.querySelector('[data-line-total]');
    if (!total) continue;
    const product = activeProducts().find((entry) => entry.id === Number(line.productId));
    total.textContent =
      line.qty === '' || !product
        ? '—'
        : `${qty(parseNumber(line.qty))} boxes · ₹${money(parseNumber(line.qty) * parseNumber(line.cost))}`;
  }
}

function movementRows() {
  const term = view.search.trim().toLowerCase();
  return movementsCache.filter((movement) => {
    if (view.type && movement.type !== view.type) return false;
    if (!term) return true;
    return [movement.productName, movement.productSku, movement.reference, movement.notes, movement.invoiceNo]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });
}

function movementTableMarkup() {
  const movements = movementRows();
  if (!movements.length) {
    return `
      <div class="table-empty">
        ${movementsCache.length
          ? emptyState({
              iconName: 'search',
              title: 'No movements match these filters',
              text: 'Try a different search or movement type.',
              action: '<button type="button" class="btn btn-sm" data-action="clear-stock-filters">Clear filters</button>'
            })
          : emptyState({
              iconName: 'stock',
              title: 'No stock movements yet',
              text: 'Record stock in, or add an opening quantity while creating an item.',
              action: '<button type="button" class="btn btn-primary btn-sm" data-nav="/products">Open catalogue</button>'
            })}
      </div>
    `;
  }

  const rows = movements
    .map((movement) => {
      const positive = movement.qtyBoxes > 0;
      const reference = movement.invoiceId
        ? `<button type="button" class="text-link" data-movement-invoice="${movement.invoiceId}">${escapeHtml(movement.invoiceNo || movement.reference || 'Invoice')}</button>`
        : escapeHtml(movement.reference || '—');
      return `
        <tr>
          <td><span class="cell-secondary" style="white-space:nowrap;">${dateText(movement.date)}</span></td>
          <td>
            <div class="cell-stack">
              <span class="cell-primary">${escapeHtml(movement.productName)}</span>
              <span class="cell-secondary">${escapeHtml(movement.productSku || 'No item code')}</span>
            </div>
          </td>
          <td><span class="movement-type ${escapeHtml(movement.type)}">${escapeHtml(TYPE_LABELS[movement.type] || movement.type)}</span></td>
          <td><span class="qty-change ${positive ? 'positive' : 'negative'}">${positive ? '+' : ''}${qty(movement.qtyBoxes)} boxes</span></td>
          <td>
            <div class="cell-stack">
              <span class="cell-primary" style="font-weight:500;">${reference}</span>
              ${movement.notes ? `<span class="cell-secondary">${escapeHtml(movement.notes)}</span>` : ''}
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Item</th>
            <th>Movement</th>
            <th>Change</th>
            <th>Reference</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="table-foot">
      <span>Showing <strong>${movements.length}</strong> of the latest <strong>${movementsCache.length}</strong> stock movements</span>
      <span class="muted">Sales and voids update automatically</span>
    </div>
  `;
}

function paintMovements() {
  const container = pageRoot?.querySelector('[data-movement-table]');
  if (container) container.innerHTML = movementTableMarkup();
}

function resetForm() {
  if (!formContext) return;
  formContext.supplier.value = '';
  formContext.date.value = todayISO();
  formContext.notes.value = '';
  clearFormError(formContext.form);
  lines = [newLine()];
  renderLines();
}

async function loadData() {
  const [products, movements] = await Promise.all([
    window.tiledesk.products.list({ includeArchived: true }),
    window.tiledesk.stock.list({ limit: 300 })
  ]);
  productsCache = products;
  movementsCache = movements;
  const metrics = pageRoot?.querySelector('[data-stock-metrics]');
  if (metrics) metrics.innerHTML = metricsMarkup();
  paintMovements();
}

async function exportMovements() {
  const movements = movementRows();
  if (!movements.length) {
    toast('There are no stock movements to export for these filters.', 'info');
    return;
  }
  const rows = [
    ['Date', 'Item', 'SKU', 'Movement', 'Boxes change', 'Reference', 'Notes'],
    ...movements.map((movement) => [
      movement.date,
      movement.productName,
      movement.productSku,
      TYPE_LABELS[movement.type] || movement.type,
      movement.qtyBoxes,
      movement.invoiceNo || movement.reference,
      movement.notes
    ])
  ];
  try {
    await downloadCsv(`SAI-TILES-stock-movements-${todayISO()}.csv`, rows);
  } catch (error) {
    toast(error.message, 'error');
  }
}

export async function render(root, ctx) {
  if (pageAbort) pageAbort.abort();
  pageAbort = new AbortController();
  pageRoot = root;
  searchTimer?.cancel?.();
  lines = [newLine()];

  try {
    [productsCache, movementsCache] = await Promise.all([
      window.tiledesk.products.list({ includeArchived: true }),
      window.tiledesk.stock.list({ limit: 300 })
    ]);
  } catch (error) {
    root.innerHTML = `
      <div class="page">
        ${pageHead({ eyebrow: 'Inventory', title: 'Stock', subtitle: 'Stock data could not be loaded.' })}
        <div class="card">
          ${emptyState({
            iconName: 'alert',
            title: 'Stock could not load',
            text: error.message,
            action: '<button type="button" class="btn btn-primary" data-action="retry-stock">Try again</button>'
          })}
        </div>
      </div>
    `;
    root.addEventListener(
      'click',
      (event) => {
        if (event.target.closest('[data-action="retry-stock"]')) void render(root, ctx);
      },
      { signal: pageAbort.signal }
    );
    return;
  }

  const hasProducts = activeProducts().length > 0;

  root.innerHTML = `
    <div class="page">
      ${pageHead({
        eyebrow: 'Inventory',
        title: 'Stock',
        subtitle: 'Receive boxes, reconcile counts and see every movement in and out of the godown.',
        actions: `<button type="button" class="btn" data-action="export-movements">${icon('download')} Export CSV</button>`
      })}

      <div class="metric-strip" data-stock-metrics>${metricsMarkup()}</div>

      <div class="stock-layout">
        <section class="card stock-form-card">
          <div class="card-head">
            <div>
              <h2 class="card-title">Record stock in</h2>
              <div class="card-sub">Add received boxes and update the average cost.</div>
            </div>
            ${icon('boxDown')}
          </div>
          ${hasProducts
            ? `<form data-stock-form novalidate>
                <div class="card-pad" style="padding-top:0;">
                  <div class="form-error hidden" data-form-error></div>
                  <div class="field-grid">
                    <div class="field">
                      <label for="stock-date">Received on</label>
                      <input class="input" id="stock-date" name="date" type="date" value="${todayISO()}" required />
                    </div>
                    <div class="field">
                      <label for="stock-supplier">Supplier <span class="optional">optional</span></label>
                      <input class="input" id="stock-supplier" name="supplier" placeholder="Supplier or godown" maxlength="120" />
                    </div>
                  </div>
                  <div class="field mt-12">
                    <label for="stock-notes">Notes <span class="optional">optional</span></label>
                    <textarea class="textarea" id="stock-notes" name="notes" placeholder="Invoice no, vehicle, remarks…" maxlength="500" rows="2"></textarea>
                  </div>

                  <div class="form-section-head" style="margin-top:17px;">
                    <h3>Items received</h3>
                    <span class="muted small">Quantity in boxes</span>
                  </div>
                  <div class="stock-in-lines" data-stock-lines>${lines.map(lineMarkup).join('')}</div>
                  <button type="button" class="stock-add-btn mt-12" data-add-stock-line>${icon('plus')} Add another item</button>

                  <div class="stock-summary">
                    <div class="row-between">
                      <div>
                        <div class="muted small">Entry total</div>
                        <div class="strong num" data-stock-summary>0 boxes · ₹0.00</div>
                      </div>
                      <button type="submit" class="btn btn-primary" data-save-stock>${icon('check')} Record stock in</button>
                    </div>
                  </div>
                </div>
              </form>`
            : `<div class="card-pad">
                ${emptyState({
                  iconName: 'products',
                  title: 'Add catalogue items first',
                  text: 'Stock is tracked per item. Create tiles or materials in the catalogue, then record quantities here.',
                  action: '<button type="button" class="btn btn-primary" data-nav="/products">Open catalogue</button>'
                })}
              </div>`}
        </section>

        <section class="card" style="overflow:hidden;">
          <div class="page-toolbar">
            <div class="filter-bar" style="flex:1;">
              <div class="search-field">
                ${icon('search')}
                <input class="input" data-stock-query placeholder="Search item, invoice or reference…" value="${escapeHtml(view.search)}" autocomplete="off" spellcheck="false" />
              </div>
              <select class="select filter-select" data-movement-type aria-label="Filter by movement type">
                ${MOVEMENT_TYPES.map((type) => `<option value="${type.value}"${type.value === view.type ? ' selected' : ''}>${type.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div data-movement-table>${movementTableMarkup()}</div>
        </section>
      </div>
    </div>
  `;

  const form = root.querySelector('[data-stock-form]');
  const linesContainer = root.querySelector('[data-stock-lines]');
  formContext = form
    ? {
        form,
        supplier: form.querySelector('[name="supplier"]'),
        date: form.querySelector('[name="date"]'),
        notes: form.querySelector('[name="notes"]'),
        save: form.querySelector('[data-save-stock]')
      }
    : null;

  const findLine = (element) => lines.find((line) => line.key === element.closest('[data-line-key]')?.dataset.lineKey);

  linesContainer?.addEventListener('input', (event) => {
    const line = findLine(event.target);
    if (!line) return;
    if (event.target.matches('[data-line-qty]')) line.qty = event.target.value;
    if (event.target.matches('[data-line-cost]')) line.cost = event.target.value;
    updateSummary();
  });

  linesContainer?.addEventListener('change', (event) => {
    if (!event.target.matches('[data-line-product]')) return;
    const line = findLine(event.target);
    if (!line) return;
    line.productId = event.target.value ? Number(event.target.value) : null;
    const product = activeProducts().find((entry) => entry.id === line.productId);
    if (product && line.cost === '') {
      line.cost = product.costPerBox ? String(product.costPerBox) : '';
    }
    renderLines();
  });

  linesContainer?.addEventListener('click', (event) => {
    if (!event.target.closest('[data-remove-line]')) return;
    const element = event.target.closest('[data-line-key]');
    const line = lines.find((entry) => entry.key === element?.dataset.lineKey);
    lines = lines.filter((entry) => entry !== line);
    if (!lines.length) lines = [newLine()];
    renderLines();
  });

  root.querySelector('[data-add-stock-line]')?.addEventListener('click', () => {
    lines.push(newLine());
    renderLines();
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError(form);
    const items = [];
    const seen = new Set();
    for (const line of lines) {
      const touched = line.productId || line.qty !== '' || line.cost !== '';
      if (!touched) continue;
      if (!line.productId) {
        showFormError(form, 'Choose an item on every line, or remove the empty line.');
        return;
      }
      const quantity = parseNumber(line.qty);
      if (quantity <= 0) {
        showFormError(form, 'Enter a box quantity greater than zero for each item.');
        return;
      }
      if (seen.has(line.productId)) {
        showFormError(form, 'The same item appears twice. Combine it into one line.');
        return;
      }
      seen.add(line.productId);
      items.push({
        productId: line.productId,
        qtyBoxes: quantity,
        costPerBox: parseNumber(line.cost)
      });
    }
    if (!items.length) {
      showFormError(form, 'Add at least one item and its box quantity.');
      return;
    }
    setButtonLoading(formContext.save, true, 'Recording…');
    try {
      const result = await window.tiledesk.stock.create({
        date: form.querySelector('[name="date"]').value,
        supplier: form.querySelector('[name="supplier"]').value,
        notes: form.querySelector('[name="notes"]').value,
        items
      });
      await loadData();
      resetForm();
      toast(`${result.updated} ${result.updated === 1 ? 'item' : 'items'} added to stock`, 'success');
    } catch (error) {
      setButtonLoading(formContext.save, false);
      showFormError(form, error.message);
      return;
    }
    setButtonLoading(formContext.save, false);
  });

  searchTimer = debounce(() => paintMovements(), 180);

  root.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('[data-action="export-movements"]')) {
        void exportMovements();
        return;
      }
      if (event.target.closest('[data-action="clear-stock-filters"]')) {
        view.search = '';
        view.type = '';
        const input = root.querySelector('[data-stock-query]');
        if (input) input.value = '';
        const select = root.querySelector('[data-movement-type]');
        if (select) select.value = '';
        paintMovements();
        return;
      }
      const invoiceLink = event.target.closest('[data-movement-invoice]');
      if (invoiceLink) {
        navigate(`/invoices/${invoiceLink.dataset.movementInvoice}`);
      }
    },
    { signal: pageAbort.signal }
  );

  root.addEventListener(
    'input',
    (event) => {
      if (!event.target.matches('[data-stock-query]')) return;
      view.search = event.target.value;
      searchTimer?.();
    },
    { signal: pageAbort.signal }
  );

  root.addEventListener(
    'change',
    (event) => {
      if (!event.target.matches('[data-movement-type]')) return;
      view.type = event.target.value;
      paintMovements();
    },
    { signal: pageAbort.signal }
  );

  updateSummary();
}

export function cleanup() {
  if (pageAbort) {
    pageAbort.abort();
    pageAbort = null;
  }
  searchTimer?.cancel?.();
  searchTimer = null;
  pageRoot = null;
  formContext = null;
}

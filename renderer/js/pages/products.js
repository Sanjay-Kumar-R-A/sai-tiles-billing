import { todayISO } from '../../../shared/format.js';
import { icon } from '../icons.js';
import { openProductForm, openStockAdjust } from '../product-form.js';
import { store } from '../store.js';
import {
  confirmDialog,
  debounce,
  downloadCsv,
  emptyState,
  escapeHtml,
  money,
  pageHead,
  productSwatch,
  qty,
  toast
} from '../ui.js';

const view = {
  search: '',
  category: '',
  lowStock: false,
  showArchived: false
};

let cache = [];
let pageAbort = null;
let searchTimer = null;
let pageRoot = null;

function activeProducts() {
  return cache.filter((product) => product.active);
}

function filteredProducts() {
  const term = view.search.trim().toLowerCase();
  return cache.filter((product) => {
    if (!view.showArchived && !product.active) return false;
    if (view.category && product.category !== view.category) return false;
    if (view.lowStock && !product.isLowStock) return false;
    if (!term) return true;
    return [product.name, product.brand, product.sku, product.size, product.finish, product.category]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });
}

function hasFilters() {
  return Boolean(view.search.trim()) || Boolean(view.category) || view.lowStock || view.showArchived;
}

function categoryOptions() {
  const categories = [...new Set([...(store.categories ?? []), ...cache.map((product) => product.category)].filter(Boolean))].sort(
    (a, b) => a.localeCompare(b)
  );
  return `<option value="">All categories</option>${categories
    .map((category) => `<option value="${escapeHtml(category)}"${category === view.category ? ' selected' : ''}>${escapeHtml(category)}</option>`)
    .join('')}`;
}

function metricsMarkup() {
  const active = activeProducts();
  const lowCount = active.filter((product) => product.isLowStock).length;
  const boxes = active.reduce((sum, product) => sum + product.stockBoxes, 0);
  const area = active.reduce((sum, product) => sum + product.stockSqft, 0);
  const cost = active.reduce((sum, product) => sum + product.stockValueCost, 0);
  const retail = active.reduce((sum, product) => sum + product.stockValueRetail, 0);
  const archived = cache.length - active.length;

  return `
    <div class="metric-cell">
      <span class="metric-icon">${icon('products')}</span>
      <div class="metric-copy">
        <div class="metric-label">Active items</div>
        <div class="metric-value">${active.length}</div>
        <div class="metric-sub">${archived} archived</div>
      </div>
    </div>
    <div class="metric-cell">
      <span class="metric-icon warn">${icon('alert')}</span>
      <div class="metric-copy">
        <div class="metric-label">Low stock</div>
        <div class="metric-value" style="${lowCount ? 'color:var(--red);' : ''}">${lowCount}</div>
        <div class="metric-sub">${lowCount ? 'At or below reorder level' : 'All above reorder level'}</div>
      </div>
    </div>
    <div class="metric-cell">
      <span class="metric-icon">${icon('stock')}</span>
      <div class="metric-copy">
        <div class="metric-label">Stock on hand</div>
        <div class="metric-value">${qty(boxes)} <span class="muted" style="font-size:10px;font-weight:500;">boxes</span></div>
        <div class="metric-sub">${qty(area)} sq ft of tiles</div>
      </div>
    </div>
    <div class="metric-cell">
      <span class="metric-icon">${icon('card')}</span>
      <div class="metric-copy">
        <div class="metric-label">Retail stock value</div>
        <div class="metric-value">₹${money(retail, { decimals: 0 })}</div>
        <div class="metric-sub">Cost ₹${money(cost, { decimals: 0 })}</div>
      </div>
    </div>
  `;
}

function statusChip(product) {
  if (!product.active) return '<span class="chip chip-neutral">Archived</span>';
  if (product.stockBoxes <= 0) return '<span class="chip chip-unpaid">Out of stock</span>';
  if (product.isLowStock) return '<span class="chip chip-low">Low stock</span>';
  return '<span class="chip chip-green">Active</span>';
}

function priceCell(product) {
  const unit = product.sellUnit === 'sqft' ? 'sq ft' : 'box';
  let alternative = '';
  if (product.sqftPerBox > 0) {
    alternative = product.sellUnit === 'sqft' ? `₹${money(product.pricePerBox)} / box` : `₹${money(product.pricePerSqft)} / sq ft`;
  } else if (product.sellUnit === 'sqft') {
    alternative = 'No pack area set';
  }
  return `
    <div class="price-stack">
      <span class="price-main">₹${money(product.price)} <span class="muted" style="font-size:9px;font-weight:500;">/ ${unit}</span></span>
      ${alternative ? `<span class="price-sub">${alternative}</span>` : ''}
    </div>
  `;
}

function rowMarkup(product) {
  return `
    <tr>
      <td>
        <div class="product-cell">
          ${productSwatch(product)}
          <div class="cell-stack">
            <span class="cell-primary">${escapeHtml(product.name)}</span>
            <span class="cell-secondary">${[product.brand, product.sku, product.category].filter(Boolean).map(escapeHtml).join(' · ') || 'No item code'}</span>
          </div>
        </div>
      </td>
      <td>
        <div class="cell-stack">
          <span class="cell-primary">${escapeHtml(product.size || '—')}</span>
          <span class="cell-secondary">${escapeHtml(product.finish || 'No finish noted')}</span>
        </div>
      </td>
      <td>
        <div class="stock-cell">
          <span class="stock-number">${qty(product.stockBoxes)} boxes</span>
          <span class="cell-secondary">${product.sqftPerBox > 0 ? `${qty(product.stockSqft)} sq ft · ${qty(product.sqftPerBox)} / box` : 'Pack area not set'}</span>
        </div>
      </td>
      <td>${priceCell(product)}</td>
      <td>
        <div class="cell-stack">
          <span class="cell-primary">${qty(product.gstRate)}%</span>
          <span class="cell-secondary">HSN ${escapeHtml(product.hsn || '—')}</span>
        </div>
      </td>
      <td>${statusChip(product)}</td>
      <td>
        <div class="cell-actions">
          <button type="button" class="btn btn-icon" data-edit="${product.id}" title="Edit item" aria-label="Edit ${escapeHtml(product.name)}">${icon('edit')}</button>
          <button type="button" class="btn btn-icon" data-adjust="${product.id}" title="Adjust stock" aria-label="Adjust stock for ${escapeHtml(product.name)}" ${product.active ? '' : 'disabled'}>${icon('boxDown')}</button>
          <button type="button" class="btn btn-icon" data-toggle-active="${product.id}" title="${product.active ? 'Archive item' : 'Restore item'}" aria-label="${product.active ? 'Archive' : 'Restore'} ${escapeHtml(product.name)}">${icon(product.active ? 'archive' : 'restore')}</button>
        </div>
      </td>
    </tr>
  `;
}

function tableMarkup() {
  const products = filteredProducts();
  if (!products.length) {
    return `
      <div class="table-empty">
        ${cache.length
          ? emptyState({
              iconName: 'search',
              title: 'No items match these filters',
              text: 'Try another search, category or stock filter.',
              action: '<button type="button" class="btn btn-sm" data-action="clear-product-filters">Clear filters</button>'
            })
          : emptyState({
              iconName: 'products',
              title: 'Build your tile catalogue',
              text: 'Add tiles, adhesives and grouts with their box area, GST rate and selling price to start billing.',
              action: '<button type="button" class="btn btn-primary" data-action="add-product">Add the first item</button>'
            })}
      </div>
    `;
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Size / finish</th>
            <th>Stock</th>
            <th>Price</th>
            <th>GST</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${products.map(rowMarkup).join('')}</tbody>
      </table>
    </div>
    <div class="table-foot">
      <span>Showing <strong>${products.length}</strong> of <strong>${cache.length}</strong> catalogue items${view.showArchived ? ' · archived included' : ''}</span>
      <span class="muted">${activeProducts().filter((product) => product.isLowStock).length} need reordering</span>
    </div>
  `;
}

function paint() {
  if (!pageRoot) return;
  const metrics = pageRoot.querySelector('[data-product-metrics]');
  if (metrics) metrics.innerHTML = metricsMarkup();
  const table = pageRoot.querySelector('[data-product-table]');
  if (table) table.innerHTML = tableMarkup();
  for (const toggle of pageRoot.querySelectorAll('[data-low-toggle]')) {
    toggle.classList.toggle('active', view.lowStock);
  }
  for (const toggle of pageRoot.querySelectorAll('[data-archived-toggle]')) {
    toggle.classList.toggle('active', view.showArchived);
  }
}

async function loadCatalogue() {
  cache = await window.tiledesk.products.list({ includeArchived: true });
  const select = pageRoot?.querySelector('[data-category-filter]');
  if (select) {
    select.innerHTML = categoryOptions();
  }
  paint();
}

function openNewProduct() {
  openProductForm({
    onSaved: async () => {
      try {
        await loadCatalogue();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
}

async function toggleActive(productId) {
  const product = cache.find((entry) => entry.id === Number(productId));
  if (!product) return;
  const archiving = product.active;
  const confirmed = await confirmDialog({
    title: archiving ? 'Archive this item?' : 'Restore this item?',
    message: archiving
      ? `"${product.name}" will disappear from billing and the active catalogue. Past invoices keep their details.`
      : `"${product.name}" will reappear in billing and the catalogue.`,
    confirmLabel: archiving ? 'Archive item' : 'Restore item',
    danger: archiving
  });
  if (!confirmed) return;
  try {
    await window.tiledesk.products.setActive(product.id, !archiving);
    await loadCatalogue();
    toast(archiving ? 'Item archived' : 'Item restored', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function exportCatalogue() {
  const products = filteredProducts();
  if (!products.length) {
    toast('There are no items to export for these filters.', 'info');
    return;
  }
  const rows = [
    ['Item', 'SKU', 'Brand', 'Category', 'Size', 'Finish', 'HSN', 'GST rate', 'Selling unit', 'Price', 'Cost per box', 'Sq ft per box', 'Stock boxes', 'Stock sq ft', 'Reorder level', 'Low stock', 'Status'],
    ...products.map((product) => [
      product.name,
      product.sku,
      product.brand,
      product.category,
      product.size,
      product.finish,
      product.hsn,
      product.gstRate,
      product.sellUnit,
      product.price,
      product.costPerBox,
      product.sqftPerBox,
      product.stockBoxes,
      product.stockSqft,
      product.reorderLevel,
      product.isLowStock ? 'Yes' : 'No',
      product.active ? 'Active' : 'Archived'
    ])
  ];
  try {
    await downloadCsv(`SAI-TILES-catalogue-${todayISO()}.csv`, rows);
  } catch (error) {
    toast(error.message, 'error');
  }
}

export async function render(root, ctx) {
  if (pageAbort) pageAbort.abort();
  pageAbort = new AbortController();
  pageRoot = root;
  searchTimer?.cancel?.();

  if (ctx.query.low === '1') view.lowStock = true;
  if (ctx.query.category) view.category = ctx.query.category;

  try {
    cache = await window.tiledesk.products.list({ includeArchived: true });
  } catch (error) {
    root.innerHTML = `
      <div class="page">
        ${pageHead({ eyebrow: 'Catalogue', title: 'Products', subtitle: 'The catalogue could not be loaded.' })}
        <div class="card">
          ${emptyState({
            iconName: 'alert',
            title: 'Products could not load',
            text: error.message,
            action: '<button type="button" class="btn btn-primary" data-action="retry-products">Try again</button>'
          })}
        </div>
      </div>
    `;
    root.addEventListener(
      'click',
      (event) => {
        if (event.target.closest('[data-action="retry-products"]')) void render(root, ctx);
      },
      { signal: pageAbort.signal }
    );
    return;
  }

  root.innerHTML = `
    <div class="page">
      ${pageHead({
        eyebrow: 'Catalogue',
        title: 'Products',
        subtitle: 'Tiles, adhesives and grouts with their pack area, stock and GST details.',
        actions: `
          <button type="button" class="btn" data-action="export-products">${icon('download')} Export CSV</button>
          <button type="button" class="btn" data-nav="/products/import">${icon('upload')} Import catalogue</button>
          <button type="button" class="btn btn-primary" data-action="add-product">${icon('plus')} Add item</button>
        `
      })}

      <div class="metric-strip" data-product-metrics>${metricsMarkup()}</div>

      <section class="card" style="overflow:hidden;">
        <div class="page-toolbar">
          <div class="filter-bar" style="flex:1;">
            <div class="search-field">
              ${icon('search')}
              <input class="input" data-product-query placeholder="Search name, code, brand or size…" value="${escapeHtml(view.search)}" autocomplete="off" spellcheck="false" />
            </div>
            <select class="select filter-select" data-category-filter aria-label="Filter by category">${categoryOptions()}</select>
            <button type="button" class="filter-toggle${view.lowStock ? ' active' : ''}" data-low-toggle>${icon('alert')} Low stock</button>
            <button type="button" class="filter-toggle${view.showArchived ? ' active' : ''}" data-archived-toggle>${icon('archive')} Archived</button>
          </div>
        </div>
        <div data-product-table>${tableMarkup()}</div>
      </section>
    </div>
  `;

  searchTimer = debounce(() => paint(), 180);

  root.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('[data-action="add-product"]')) {
        openNewProduct();
        return;
      }
      if (event.target.closest('[data-action="export-products"]')) {
        void exportCatalogue();
        return;
      }
      if (event.target.closest('[data-action="clear-product-filters"]')) {
        view.search = '';
        view.category = '';
        view.lowStock = false;
        view.showArchived = false;
        const input = root.querySelector('[data-product-query]');
        if (input) input.value = '';
        const select = root.querySelector('[data-category-filter]');
        if (select) select.value = '';
        paint();
        return;
      }

      const lowToggle = event.target.closest('[data-low-toggle]');
      if (lowToggle) {
        view.lowStock = !view.lowStock;
        paint();
        return;
      }
      const archivedToggle = event.target.closest('[data-archived-toggle]');
      if (archivedToggle) {
        view.showArchived = !view.showArchived;
        paint();
        return;
      }

      const editButton = event.target.closest('[data-edit]');
      if (editButton) {
        const product = cache.find((entry) => entry.id === Number(editButton.dataset.edit));
        if (!product) return;
        openProductForm({
          product,
          onSaved: async () => {
            try {
              await loadCatalogue();
            } catch (error) {
              toast(error.message, 'error');
            }
          }
        });
        return;
      }

      const adjustButton = event.target.closest('[data-adjust]');
      if (adjustButton) {
        const product = cache.find((entry) => entry.id === Number(adjustButton.dataset.adjust));
        if (!product || !product.active) return;
        openStockAdjust({
          product,
          onSaved: async () => {
            try {
              await loadCatalogue();
            } catch (error) {
              toast(error.message, 'error');
            }
          }
        });
        return;
      }

      const toggleButton = event.target.closest('[data-toggle-active]');
      if (toggleButton) {
        void toggleActive(toggleButton.dataset.toggleActive);
      }
    },
    { signal: pageAbort.signal }
  );

  root.addEventListener(
    'input',
    (event) => {
      if (!event.target.matches('[data-product-query]')) return;
      view.search = event.target.value;
      searchTimer?.();
    },
    { signal: pageAbort.signal }
  );

  root.addEventListener(
    'change',
    (event) => {
      if (!event.target.matches('[data-category-filter]')) return;
      view.category = event.target.value;
      paint();
    },
    { signal: pageAbort.signal }
  );
}

export function cleanup() {
  if (pageAbort) {
    pageAbort.abort();
    pageAbort = null;
  }
  searchTimer?.cancel?.();
  searchTimer = null;
  pageRoot = null;
}

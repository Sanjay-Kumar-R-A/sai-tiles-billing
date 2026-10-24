import {
  addDaysISO,
  financialYearStart,
  localISO,
  monthStartISO,
  todayISO
} from '../../../shared/format.js';
import { icon } from '../icons.js';
import {
  barChart,
  barShare,
  dateText,
  downloadCsv,
  emptyState,
  escapeHtml,
  loadingPanel,
  money,
  pageHead,
  qty,
  toast
} from '../ui.js';

const TABS = [
  { value: 'sales', label: 'Sales' },
  { value: 'gst', label: 'GST returns' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'stock', label: 'Stock' }
];

const view = {
  tab: 'sales',
  preset: 'month',
  from: monthStartISO(),
  to: todayISO(),
  asOf: todayISO(),
  lowOnly: false
};

let pageAbort = null;
let loadToken = 0;
let pageRoot = null;
let lastResult = null;
let lastLoadedAt = '';

function presetRange(preset) {
  const today = todayISO();
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') return { from: addDaysISO(today, -6), to: today };
  if (preset === 'month') return { from: monthStartISO(today), to: today };
  if (preset === 'lastMonth') {
    const first = new Date(`${monthStartISO(today)}T00:00:00`);
    first.setMonth(first.getMonth() - 1);
    const start = localISO(first);
    const last = new Date(`${monthStartISO(today)}T00:00:00`);
    last.setDate(0);
    return { from: start, to: localISO(last) };
  }
  if (preset === 'fy') return { from: financialYearStart(today), to: today };
  return { from: view.from, to: view.to };
}

function filtersMarkup() {
  if (view.tab === 'outstanding') {
    return `
      <div class="range-bar" style="border-bottom:0;border-radius:var(--radius);">
        <div class="field">
          <span class="field-label">As of date</span>
          <input class="input" type="date" data-report-asof value="${view.asOf}" max="${todayISO()}" />
        </div>
        <div class="spacer"></div>
        <span class="muted small">Only unpaid and part-paid active invoices are included.</span>
      </div>
    `;
  }

  if (view.tab === 'stock') {
    return `
      <div class="range-bar" style="border-bottom:0;border-radius:var(--radius);">
        <button type="button" class="filter-toggle${view.lowOnly ? ' active' : ''}" data-low-only>${icon('alert')} Low stock only</button>
        <div class="spacer"></div>
        <span class="muted small">Valued at the weighted average cost of each item.</span>
      </div>
    `;
  }

  return `
    <div class="range-bar" style="border-bottom:0;border-radius:var(--radius);">
      <div class="field">
        <span class="field-label">Period</span>
        <select class="select preset-select" data-preset aria-label="Report period">
          <option value="today"${view.preset === 'today' ? ' selected' : ''}>Today</option>
          <option value="week"${view.preset === 'week' ? ' selected' : ''}>Last 7 days</option>
          <option value="month"${view.preset === 'month' ? ' selected' : ''}>This month</option>
          <option value="lastMonth"${view.preset === 'lastMonth' ? ' selected' : ''}>Last month</option>
          <option value="fy"${view.preset === 'fy' ? ' selected' : ''}>This financial year</option>
          <option value="custom"${view.preset === 'custom' ? ' selected' : ''}>Custom range</option>
        </select>
      </div>
      <div class="field">
        <span class="field-label">From</span>
        <input class="input" type="date" data-report-from value="${view.from}" />
      </div>
      <div class="field">
        <span class="field-label">To</span>
        <input class="input" type="date" data-report-to value="${view.to}" />
      </div>
      <div class="spacer"></div>
      <span class="muted small">${dateText(view.from)} – ${dateText(view.to)}</span>
    </div>
  `;
}

function reportKpi(label, value, sub, { alert = false, small = false } = {}) {
  return `
    <div class="card report-kpi">
      <div class="report-kpi-label">${escapeHtml(label)}</div>
      <div class="report-kpi-value" style="${alert ? 'color:var(--red);' : ''}${small ? 'font-size:21px;' : ''}">${value}</div>
      <div class="report-kpi-sub">${sub}</div>
    </div>
  `;
}

function panelEmpty(text) {
  return `<div class="payment-empty" style="padding:22px 0;">${escapeHtml(text)}</div>`;
}

function salesMarkup(data) {
  const summary = data.summary;
  const tax = summary.cgst + summary.sgst + summary.igst;
  const categoryTotal = data.categories.reduce((sum, category) => sum + category.total, 0);
  const paymentTotal = data.payments.reduce((sum, payment) => sum + payment.total, 0);
  const topMax = data.topProducts[0]?.revenue ?? 0;
  const labelEvery = Math.max(1, Math.ceil(data.daily.length / 10));

  const topRows = data.topProducts.length
    ? data.topProducts
        .map(
          (product, index) => `
            <div class="panel-list-row">
              <span class="rank">${index + 1}</span>
              <div class="panel-list-copy">
                <div class="panel-list-title">${escapeHtml(product.name)}</div>
                <div class="panel-list-sub">${escapeHtml(product.sku || 'Custom item')} · ${qty(product.areaSqft)} sq ft</div>
              </div>
              <div class="panel-list-value">₹${money(product.revenue)}</div>
            </div>
          `
        )
        .join('')
    : panelEmpty('No product sales in this period.');

  const categoryRows = data.categories.length
    ? data.categories
        .map(
          (category) => `
            <div class="panel-list-row">
              <div class="panel-list-copy">
                <div class="panel-list-title">${escapeHtml(category.category)}</div>
                ${barShare(category.total, categoryTotal)}
              </div>
              <div class="panel-list-value">₹${money(category.total)}</div>
            </div>
          `
        )
        .join('')
    : panelEmpty('No category sales in this period.');

  const paymentRows = data.payments.length
    ? data.payments
        .map(
          (payment) => `
            <div class="panel-list-row">
              <span class="payment-row-icon">${icon('wallet')}</span>
              <div class="panel-list-copy">
                <div class="panel-list-title">${escapeHtml(payment.method)}</div>
                <div class="panel-list-sub">${payment.count} ${payment.count === 1 ? 'payment' : 'payments'}</div>
                ${barShare(payment.total, paymentTotal)}
              </div>
              <div class="panel-list-value">₹${money(payment.total)}</div>
            </div>
          `
        )
        .join('')
    : panelEmpty('No payments collected in this period.');

  return `
    <div class="report-kpis">
      ${reportKpi('Invoiced sales', `₹${money(summary.total, { decimals: 0 })}`, `${summary.invoiceCount} ${summary.invoiceCount === 1 ? 'bill' : 'bills'} · including GST`)}
      ${reportKpi('Collected', `₹${money(summary.collected, { decimals: 0 })}`, `of ₹${money(summary.total, { decimals: 0 })} invoiced`)}
      ${reportKpi('Average bill', `₹${money(summary.averageBill, { decimals: 0 })}`, 'Across active invoices')}
      ${reportKpi('Balance due', `₹${money(summary.balance, { decimals: 0 })}`, 'From invoices in this period', { alert: summary.balance > 0 })}
    </div>

    <div class="report-grid">
      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Daily sales</h2>
            <div class="card-sub">${dateText(data.from)} – ${dateText(data.to)}</div>
          </div>
          <div class="chart-legend"><span class="legend-dot"></span>Invoiced value</div>
        </div>
        <div class="chart-wrap">
          <div class="chart-summary">
            <div class="chart-summary-value">₹${money(summary.total)}</div>
            <div class="chart-summary-label">${summary.invoiceCount} ${summary.invoiceCount === 1 ? 'bill' : 'bills'} · ₹${money(summary.collected)} collected</div>
          </div>
          <div style="margin-top:16px;">
            ${barChart(data.daily, { today: todayISO(), labelEvery, emptyText: 'No sales in this period yet.' })}
          </div>
        </div>
        <div class="report-note">
          Discounts ₹${money(summary.discountTotal)} · GST collected ₹${money(tax)} · Taxable value ₹${money(summary.taxableTotal)}.
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Top products</h2>
            <div class="card-sub">By revenue · max ${topMax ? `₹${money(topMax, { decimals: 0 })}` : '—'}</div>
          </div>
          ${icon('trendingUp')}
        </div>
        <div class="panel-list">${topRows}</div>
      </section>
    </div>

    <div class="report-grid report-grid-even">
      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Sales by category</h2>
            <div class="card-sub">Taxable line value before GST</div>
          </div>
          ${icon('products')}
        </div>
        <div class="panel-list">${categoryRows}</div>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Collections by method</h2>
            <div class="card-sub">Payments received in this period</div>
          </div>
          ${icon('coins')}
        </div>
        <div class="panel-list">${paymentRows}</div>
      </section>
    </div>
  `;
}

function gstMarkup(data) {
  const totals = data.totals;
  const taxTotal = totals.cgst + totals.sgst + totals.igst;

  const rateRows = data.rates.length
    ? data.rates
        .map(
          (rate) => `
            <tr>
              <td>${qty(rate.gstRate)}%</td>
              <td class="num money">₹${money(rate.taxable)}</td>
              <td class="num money">₹${money(rate.cgst)}</td>
              <td class="num money">₹${money(rate.sgst)}</td>
              <td class="num money">₹${money(rate.igst)}</td>
              <td class="num money strong">₹${money(rate.total)}</td>
            </tr>
          `
        )
        .join('')
    : `<tr><td colspan="6"><div class="payment-empty">No GST taxable sales in this period.</div></td></tr>`;

  const hsnRows = data.hsn.length
    ? data.hsn
        .map(
          (entry) => `
            <tr>
              <td class="mono">${escapeHtml(entry.hsn)}</td>
              <td>${qty(entry.gstRate)}%</td>
              <td class="num money">₹${money(entry.taxable)}</td>
              <td class="num money">₹${money(entry.cgst)}</td>
              <td class="num money">₹${money(entry.sgst)}</td>
              <td class="num money">₹${money(entry.igst)}</td>
              <td class="num money strong">₹${money(entry.total)}</td>
            </tr>
          `
        )
        .join('')
    : `<tr><td colspan="7"><div class="payment-empty">No HSN summary for this period.</div></td></tr>`;

  const segmentRows = ['b2b', 'b2c']
    .map((key) => {
      const segment = data.segments[key];
      const label = key === 'b2b' ? 'B2B · registered' : 'B2C · unregistered';
      return `
        <div class="panel-list-row">
          <div class="panel-list-copy">
            <div class="panel-list-title">${label}</div>
            <div class="panel-list-sub">${segment.invoices} ${segment.invoices === 1 ? 'invoice' : 'invoices'} · tax ₹${money(segment.cgst + segment.sgst + segment.igst)}</div>
            ${barShare(segment.taxable, totals.taxable)}
          </div>
          <div class="panel-list-value">₹${money(segment.total)}</div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="report-kpis">
      ${reportKpi('Taxable value', `₹${money(totals.taxable, { decimals: 0 })}`, `${totals.invoiceCount} ${totals.invoiceCount === 1 ? 'invoice' : 'invoices'}`)}
      ${reportKpi('CGST', `₹${money(totals.cgst, { decimals: 0 })}`, 'Central component')}
      ${reportKpi('SGST', `₹${money(totals.sgst, { decimals: 0 })}`, 'State component')}
      ${reportKpi('IGST', `₹${money(totals.igst, { decimals: 0 })}`, 'Inter-state supplies')}
    </div>

    <div class="report-grid report-grid-even">
      <section class="card" style="overflow:hidden;">
        <div class="card-head">
          <div>
            <h2 class="card-title">Rate-wise tax</h2>
            <div class="card-sub">GST grouped by the rate charged on each line</div>
          </div>
          ${icon('percent')}
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Rate</th>
                <th class="num">Taxable</th>
                <th class="num">CGST</th>
                <th class="num">SGST</th>
                <th class="num">IGST</th>
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>${rateRows}</tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">B2B and B2C split</h2>
            <div class="card-sub">Based on the GSTIN recorded on the invoice</div>
          </div>
          ${icon('customers')}
        </div>
        <div class="panel-list">${segmentRows}</div>
        <div class="report-note">Total GST for the period: <strong>₹${money(taxTotal)}</strong>.</div>
      </section>
    </div>

    <section class="card" style="overflow:hidden;">
      <div class="card-head">
        <div>
          <h2 class="card-title">HSN summary</h2>
          <div class="card-sub">Use this view when preparing GSTR-1</div>
        </div>
        ${icon('fileText')}
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>HSN / SAC</th>
              <th>Rate</th>
              <th class="num">Taxable</th>
              <th class="num">CGST</th>
              <th class="num">SGST</th>
              <th class="num">IGST</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>${hsnRows}</tbody>
        </table>
      </div>
      <div class="report-note">Derived from active invoices dated ${dateText(data.from)} – ${dateText(data.to)}. Cancelled bills are excluded. Verify with your accountant before filing.</div>
    </section>
  `;
}

function outstandingMarkup(data) {
  const rows = data.rows.length
    ? data.rows
        .map((invoice) => {
          const ageColor = invoice.daysOutstanding > 90 ? 'var(--red)' : invoice.daysOutstanding > 30 ? 'var(--amber)' : '';
          return `
            <tr class="is-clickable" data-row-href="/invoices/${invoice.id}">
              <td>
                <div class="cell-stack">
                  <span class="invoice-no">${escapeHtml(invoice.invoiceNo)}</span>
                  <span class="cell-secondary">${dateText(invoice.invoiceDate)}</span>
                </div>
              </td>
              <td>
                <div class="cell-stack">
                  <span class="cell-primary">${escapeHtml(invoice.customerName)}</span>
                  <span class="cell-secondary">${escapeHtml(invoice.customerPhone || 'Walk-in customer')}</span>
                </div>
              </td>
              <td><span style="${ageColor ? `color:${ageColor};font-weight:600;` : ''}">${invoice.daysOutstanding} ${invoice.daysOutstanding === 1 ? 'day' : 'days'}</span></td>
              <td class="num money">₹${money(invoice.total)}</td>
              <td class="num money strong"><span class="negative">₹${money(invoice.balance)}</span></td>
            </tr>
          `;
        })
        .join('')
    : '';

  const aging = data.buckets
    .map(
      (bucket) => `
        <div class="aging-card${bucket.label === 'Over 90 days' && bucket.amount > 0 ? ' overdue' : ''}">
          <div class="aging-label">${bucket.label}</div>
          <div class="aging-value">₹${money(bucket.amount, { decimals: 0 })}</div>
          <div class="aging-count">${bucket.count} ${bucket.count === 1 ? 'invoice' : 'invoices'}</div>
        </div>
      `
    )
    .join('');

  const over90 = data.buckets[3]?.amount ?? 0;

  return `
    <div class="report-kpis">
      ${reportKpi('Total outstanding', `₹${money(data.totalOutstanding, { decimals: 0 })}`, `As of ${dateText(data.asOf)}`, { alert: data.totalOutstanding > 0 })}
      ${reportKpi('Open invoices', String(data.invoiceCount), `Across ${data.customerCount} ${data.customerCount === 1 ? 'customer' : 'customers'}`)}
      ${reportKpi('Over 90 days', `₹${money(over90, { decimals: 0 })}`, 'Follow up urgently', { alert: over90 > 0 })}
      ${reportKpi('Average due', data.invoiceCount ? `₹${money(data.totalOutstanding / data.invoiceCount, { decimals: 0 })}` : '₹0', 'Per open invoice')}
    </div>

    <div class="aging-grid">${aging}</div>

    <section class="card" style="overflow:hidden;">
      <div class="card-head">
        <div>
          <h2 class="card-title">Outstanding invoices</h2>
          <div class="card-sub">Oldest first · as of ${dateText(data.asOf)}</div>
        </div>
        ${icon('clock')}
      </div>
      ${data.rows.length
        ? `<div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Age</th>
                  <th class="num">Invoice total</th>
                  <th class="num">Balance</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div class="table-foot">
            <span>${data.invoiceCount} ${data.invoiceCount === 1 ? 'invoice' : 'invoices'} · ${data.customerCount} ${data.customerCount === 1 ? 'customer' : 'customers'}</span>
            <span class="negative strong">₹${money(data.totalOutstanding)} due</span>
          </div>`
        : `<div class="table-empty">
            ${emptyState({
              iconName: 'checkCircle',
              title: 'Nothing outstanding',
              text: `All invoices are settled as of ${dateText(data.asOf)}.`,
              action: '<button type="button" class="btn btn-sm" data-nav="/invoices">Review invoices</button>'
            })}
          </div>`}
    </section>
  `;
}

function stockMarkup(data) {
  const productRows = data.products.length
    ? data.products
        .map(
          (product) => `
            <tr>
              <td>
                <div class="cell-stack">
                  <span class="cell-primary">${escapeHtml(product.name)}</span>
                  <span class="cell-secondary">${escapeHtml(product.sku || 'No item code')} · ${escapeHtml(product.category)}</span>
                </div>
              </td>
              <td class="num">
                <span class="stock-number">${qty(product.stockBoxes)}</span>
                <div class="cell-secondary">boxes</div>
              </td>
              <td class="num">${product.sqftPerBox > 0 ? `${qty(product.stockSqft)} sq ft` : '—'}</td>
              <td class="num money">₹${money(product.stockValueCost)}</td>
              <td class="num money">₹${money(product.stockValueRetail)}</td>
              <td>${product.isLowStock ? '<span class="chip chip-low">Low stock</span>' : '<span class="chip chip-green">In stock</span>'}</td>
            </tr>
          `
        )
        .join('')
    : '';

  return `
    <div class="report-kpis">
      ${reportKpi('Active SKUs', String(data.totals.skuCount), `${data.totals.lowStockCount} need reordering`, { alert: data.totals.lowStockCount > 0 })}
      ${reportKpi('Stock on hand', `${qty(data.totals.boxes)} <span style="font-size:12px;color:var(--muted);font-family:var(--font-sans);">boxes</span>`, `${qty(data.totals.areaSqft)} sq ft`)}
      ${reportKpi('Value at cost', `₹${money(data.totals.costValue, { decimals: 0 })}`, 'Weighted average cost')}
      ${reportKpi('Retail value', `₹${money(data.totals.retailValue, { decimals: 0 })}`, 'At current selling prices')}
    </div>

    <section class="card" style="overflow:hidden;">
      <div class="card-head">
        <div>
          <h2 class="card-title">Stock valuation</h2>
          <div class="card-sub">${view.lowOnly ? 'Only items at or below reorder level' : 'All active catalogue items'}</div>
        </div>
        ${icon('stock')}
      </div>
      ${data.products.length
        ? `<div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th class="num">Stock</th>
                  <th class="num">Area</th>
                  <th class="num">Cost value</th>
                  <th class="num">Retail value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${productRows}</tbody>
            </table>
          </div>
          <div class="table-foot">
            <span>${data.products.length} ${data.products.length === 1 ? 'item' : 'items'} · ${qty(data.totals.boxes)} boxes · ${qty(data.totals.areaSqft)} sq ft</span>
            <span class="strong">₹${money(data.totals.retailValue)} retail</span>
          </div>`
        : `<div class="table-empty">
            ${emptyState({
              iconName: 'stock',
              title: view.lowOnly ? 'No items need reordering' : 'No stock to value',
              text: view.lowOnly ? 'Every active item is above its reorder level.' : 'Add items and stock entries to see a valuation.',
              action: `<button type="button" class="btn btn-sm" data-nav="/products">Open catalogue</button>`
            })}
          </div>`}
    </section>
  `;
}

async function loadReport() {
  const token = ++loadToken;
  lastResult = null;
  const body = pageRoot?.querySelector('[data-report-body]');
  if (!body) return;
  body.innerHTML = loadingPanel(6);
  try {
    let data;
    if (view.tab === 'sales') {
      data = await window.tiledesk.reports.sales({ from: view.from, to: view.to });
    } else if (view.tab === 'gst') {
      data = await window.tiledesk.reports.gst({ from: view.from, to: view.to });
    } else if (view.tab === 'outstanding') {
      data = await window.tiledesk.reports.outstanding({ asOf: view.asOf });
    } else {
      data = await window.tiledesk.reports.stock({ lowOnly: view.lowOnly });
    }
    if (token !== loadToken) return;
    lastResult = { tab: view.tab, data };
    lastLoadedAt = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    body.innerHTML =
      view.tab === 'sales'
        ? salesMarkup(data)
        : view.tab === 'gst'
          ? gstMarkup(data)
          : view.tab === 'outstanding'
            ? outstandingMarkup(data)
            : stockMarkup(data);
  } catch (error) {
    if (token !== loadToken) return;
    body.innerHTML = `<div class="card">${emptyState({
      iconName: 'alert',
      title: 'This report could not load',
      text: error.message,
      action: '<button type="button" class="btn btn-primary btn-sm" data-retry-report>Try again</button>'
    })}</div>`;
  }
}

function renderFilters() {
  const container = pageRoot?.querySelector('[data-report-filters]');
  if (container) container.innerHTML = filtersMarkup();
}

function syncTabs() {
  for (const tab of pageRoot?.querySelectorAll('[data-tab]') ?? []) {
    tab.classList.toggle('active', tab.dataset.tab === view.tab);
  }
}

async function exportReport() {
  if (!lastResult) {
    toast('Run the report first, then export it.', 'info');
    return;
  }
  const { tab, data } = lastResult;
  let fileName;
  let rows;
  if (tab === 'sales') {
    fileName = `SAI-TILES-sales-${data.from}-to-${data.to}.csv`;
    rows = [
      ['Sales report', `${data.from} to ${data.to}`],
      ['Invoiced', data.summary.total.toFixed(2)],
      ['Invoices', data.summary.invoiceCount],
      ['Collected', data.summary.collected.toFixed(2)],
      ['Balance', data.summary.balance.toFixed(2)],
      ['Taxable value', data.summary.taxableTotal.toFixed(2)],
      ['GST', (data.summary.cgst + data.summary.sgst + data.summary.igst).toFixed(2)],
      [],
      ['Date', 'Invoices', 'Sales'],
      ...data.daily.map((day) => [day.date, day.count, day.total.toFixed(2)]),
      [],
      ['Top products', 'SKU', 'Area sq ft', 'Revenue'],
      ...data.topProducts.map((product) => [product.name, product.sku, product.areaSqft, product.revenue.toFixed(2)]),
      [],
      ['Payment method', 'Count', 'Collected'],
      ...data.payments.map((payment) => [payment.method, payment.count, payment.total.toFixed(2)])
    ];
  } else if (tab === 'gst') {
    fileName = `SAI-TILES-gst-${data.from}-to-${data.to}.csv`;
    rows = [
      ['GST report', `${data.from} to ${data.to}`],
      ['Taxable value', data.totals.taxable.toFixed(2)],
      ['CGST', data.totals.cgst.toFixed(2)],
      ['SGST', data.totals.sgst.toFixed(2)],
      ['IGST', data.totals.igst.toFixed(2)],
      [],
      ['HSN', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
      ...data.hsn.map((entry) => [entry.hsn, entry.gstRate, entry.taxable.toFixed(2), entry.cgst.toFixed(2), entry.sgst.toFixed(2), entry.igst.toFixed(2), entry.total.toFixed(2)]),
      [],
      ['Segment', 'Invoices', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
      ...['b2b', 'b2c'].map((key) => [
        key === 'b2b' ? 'B2B' : 'B2C',
        data.segments[key].invoices,
        data.segments[key].taxable.toFixed(2),
        data.segments[key].cgst.toFixed(2),
        data.segments[key].sgst.toFixed(2),
        data.segments[key].igst.toFixed(2),
        data.segments[key].total.toFixed(2)
      ])
    ];
  } else if (tab === 'outstanding') {
    fileName = `SAI-TILES-outstanding-${data.asOf}.csv`;
    rows = [
      ['Outstanding report', `As of ${data.asOf}`],
      ['Total outstanding', data.totalOutstanding.toFixed(2)],
      ['Invoices', data.invoiceCount],
      ['Customers', data.customerCount],
      [],
      ['Invoice no', 'Date', 'Customer', 'Phone', 'Days outstanding', 'Invoice total', 'Balance'],
      ...data.rows.map((invoice) => [
        invoice.invoiceNo,
        invoice.invoiceDate,
        invoice.customerName,
        invoice.customerPhone,
        invoice.daysOutstanding,
        invoice.total.toFixed(2),
        invoice.balance.toFixed(2)
      ]),
      [],
      ['Ageing bucket', 'Invoices', 'Amount'],
      ...data.buckets.map((bucket) => [bucket.label, bucket.count, bucket.amount.toFixed(2)])
    ];
  } else {
    fileName = `SAI-TILES-stock-${todayISO()}.csv`;
    rows = [
      ['Stock valuation', todayISO()],
      ['SKUs', data.totals.skuCount],
      ['Boxes', data.totals.boxes],
      ['Area sq ft', data.totals.areaSqft],
      ['Cost value', data.totals.costValue.toFixed(2)],
      ['Retail value', data.totals.retailValue.toFixed(2)],
      [],
      ['Item', 'SKU', 'Category', 'Stock boxes', 'Stock sq ft', 'Cost value', 'Retail value', 'Low stock'],
      ...data.products.map((product) => [
        product.name,
        product.sku,
        product.category,
        product.stockBoxes,
        product.stockSqft,
        product.stockValueCost.toFixed(2),
        product.stockValueRetail.toFixed(2),
        product.isLowStock ? 'Yes' : 'No'
      ])
    ];
  }

  try {
    await downloadCsv(fileName, rows);
  } catch (error) {
    toast(error.message, 'error');
  }
}

export async function render(root, ctx) {
  if (pageAbort) pageAbort.abort();
  pageAbort = new AbortController();
  pageRoot = root;
  loadToken += 1;
  lastResult = null;

  if (ctx.query.tab && TABS.some((tab) => tab.value === ctx.query.tab)) {
    view.tab = ctx.query.tab;
  }

  root.innerHTML = `
    <div class="page">
      ${pageHead({
        eyebrow: 'Business',
        title: 'Reports',
        subtitle: 'Sales, GST, receivables and stock valuation built from your saved invoices.',
        actions: `<button type="button" class="btn" data-action="export-report">${icon('download')} Export CSV</button>`
      })}

      <div class="report-tabs" role="tablist" aria-label="Report type">
        ${TABS.map((tab) => `<button type="button" class="report-tab${tab.value === view.tab ? ' active' : ''}" data-tab="${tab.value}" role="tab" aria-selected="${tab.value === view.tab}">${tab.label}</button>`).join('')}
      </div>

      <div class="card" style="margin-bottom:14px;" data-report-filters>${filtersMarkup()}</div>
      <div data-report-body>${loadingPanel(6)}</div>
    </div>
  `;

  const { signal } = pageAbort;

  root.addEventListener(
    'click',
    (event) => {
      const tab = event.target.closest('[data-tab]');
      if (tab) {
        view.tab = tab.dataset.tab;
        syncTabs();
        renderFilters();
        void loadReport();
        return;
      }
      if (event.target.closest('[data-retry-report]')) {
        void loadReport();
        return;
      }
      if (event.target.closest('[data-action="export-report"]')) {
        void exportReport();
        return;
      }
      const lowToggle = event.target.closest('[data-low-only]');
      if (lowToggle) {
        view.lowOnly = !view.lowOnly;
        renderFilters();
        void loadReport();
      }
    },
    { signal }
  );

  root.addEventListener(
    'change',
    (event) => {
      if (event.target.matches('[data-preset]')) {
        view.preset = event.target.value;
        if (view.preset !== 'custom') {
          const range = presetRange(view.preset);
          view.from = range.from;
          view.to = range.to;
        }
        renderFilters();
        void loadReport();
        return;
      }
      if (event.target.matches('[data-report-from]')) {
        view.from = event.target.value;
        view.preset = 'custom';
        renderFilters();
        if (view.from > view.to) {
          toast('The start date must be before the end date.', 'error');
          return;
        }
        void loadReport();
        return;
      }
      if (event.target.matches('[data-report-to]')) {
        view.to = event.target.value;
        view.preset = 'custom';
        renderFilters();
        if (view.from > view.to) {
          toast('The end date must be after the start date.', 'error');
          return;
        }
        void loadReport();
        return;
      }
      if (event.target.matches('[data-report-asof]')) {
        view.asOf = event.target.value || todayISO();
        renderFilters();
        void loadReport();
      }
    },
    { signal }
  );

  await loadReport();
}

export function cleanup() {
  if (pageAbort) {
    pageAbort.abort();
    pageAbort = null;
  }
  loadToken += 1;
  lastResult = null;
  pageRoot = null;
}

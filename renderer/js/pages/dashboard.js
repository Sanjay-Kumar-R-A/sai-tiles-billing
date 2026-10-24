import { formatCompactMoney, formatQty } from '../../../shared/format.js';
import { store } from '../store.js';
import {
  barChart,
  dateText,
  emptyState,
  escapeHtml,
  invoiceStatusChip,
  money,
  pageHead,
  productSwatch
} from '../ui.js';
import { icon } from '../icons.js';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function kpiCard({ label, value, foot, iconName, tone = '', alert = false }) {
  return `
    <div class="card kpi${alert ? ' kpi-alert' : ''}">
      <div class="kpi-icon ${tone}">${icon(iconName)}</div>
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-foot">${foot}</div>
    </div>
  `;
}

export async function render(root, ctx) {
  const settings = store.settings;
  const [data] = await Promise.all([window.tiledesk.dashboard.get()]);
  const seriesTotal = data.series.reduce((sum, entry) => sum + entry.total, 0);
  const seriesBills = data.series.reduce((sum, entry) => sum + entry.count, 0);
  const profileIncomplete = !settings.profileReviewed || !settings.gstin;

  const recentRows = data.recentInvoices.length
    ? data.recentInvoices
        .map(
          (invoice) => `
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
                  <span class="cell-secondary">${escapeHtml(invoice.customerPhone || 'Walk-in')}</span>
                </div>
              </td>
              <td>${invoiceStatusChip(invoice)}</td>
              <td class="num money">₹${money(invoice.total)}</td>
            </tr>
          `
        )
        .join('')
    : '';

  const topRows = data.topProducts.length
    ? data.topProducts
        .map(
          (product, index) => `
            <div class="mini-row">
              <span class="rank">${index + 1}</span>
              <div class="mini-copy">
                <div class="mini-title">${escapeHtml(product.name)}</div>
                <div class="mini-sub">${escapeHtml(product.sku || 'Custom item')} · ${formatQty(product.areaSqft)} sq ft</div>
              </div>
              <div class="mini-value">₹${formatCompactMoney(product.revenue).replace('₹', '')}</div>
            </div>
          `
        )
        .join('')
    : `<div class="empty-state" style="padding:26px 12px;">
        <div class="empty-icon">${icon('products')}</div>
        <div class="empty-title" style="font-size:15px;">No sales yet</div>
        <p class="empty-text">Top selling tiles appear here after your first bills.</p>
      </div>`;

  const lowStockRows = data.lowStock.length
    ? data.lowStock
        .map(
          (product) => `
            <div class="mini-row">
              ${productSwatch(product)}
              <div class="mini-copy">
                <div class="mini-title">${escapeHtml(product.name)}</div>
                <div class="mini-sub">${escapeHtml(product.sku || product.category)} · reorder at ${formatQty(product.reorderLevel)}</div>
              </div>
              <div class="mini-value" style="color:var(--red);">${formatQty(product.stockBoxes)} box</div>
            </div>
          `
        )
        .join('')
    : `<div class="mini-list">
        <div class="mini-row" style="border-bottom:0;">
          <span class="payment-row-icon">${icon('checkCircle')}</span>
          <div class="mini-copy">
            <div class="mini-title">Stock levels look healthy</div>
            <div class="mini-sub">No items are at their reorder level.</div>
          </div>
        </div>
      </div>`;

  root.innerHTML = `
    <div class="page">
      ${pageHead({
        eyebrow: ctx.info?.summary?.localDateLong ?? '',
        title: `${greeting()}${settings.showroomName ? `.` : '.'}`,
        subtitle: `Here's the picture at <strong>${escapeHtml(settings.showroomName)}</strong> today.`,
        actions: `
          <button type="button" class="btn" data-nav="/reports">${icon('reports')} Reports</button>
          <button type="button" class="btn btn-primary" data-nav="/billing">${icon('plus')} New bill</button>
        `
      })}

      ${profileIncomplete
        ? `<div class="setup-banner">
            <div class="setup-banner-icon">${icon('sparkle')}</div>
            <div class="setup-banner-copy">
              <div class="setup-banner-title">Finish your showroom profile</div>
              <div class="setup-banner-text">${!settings.gstin ? 'Add your GSTIN,' : ''} bank details and invoice terms so the first tax invoice is complete.</div>
            </div>
            <button type="button" class="btn btn-sm" data-nav="/settings">Review settings ${icon('arrowRight')}</button>
          </div>`
        : ''}

      <div class="kpi-grid">
        ${kpiCard({
          label: "Today's sales",
          value: `₹${money(data.todaySales, { decimals: 0 })}`,
          foot: `<span class="positive">${data.todayCount} ${data.todayCount === 1 ? 'bill' : 'bills'}</span> billed today`,
          iconName: 'card',
          tone: 'kpi-icon-accent'
        })}
        ${kpiCard({
          label: 'This month',
          value: `₹${money(data.monthSales, { decimals: 0 })}`,
          foot: `${data.monthCount} bills · ₹${formatCompactMoney(data.monthCollected).replace('₹', '')} collected`,
          iconName: 'trendingUp',
          tone: 'kpi-icon-green'
        })}
        ${kpiCard({
          label: 'Outstanding',
          value: `₹${money(data.outstanding, { decimals: 0 })}`,
          foot: `${data.outstandingCount} ${data.outstandingCount === 1 ? 'invoice' : 'invoices'} awaiting payment`,
          iconName: 'clock',
          tone: 'kpi-icon-amber',
          alert: data.outstandingCount > 0
        })}
        ${kpiCard({
          label: 'Running low',
          value: `${data.lowStockCount} <small>items</small>`,
          foot: data.lowStockCount ? '<span class="negative">At or below reorder level</span>' : 'All stock above reorder levels',
          iconName: 'stock',
          tone: 'kpi-icon-amber',
          alert: data.lowStockCount > 0
        })}
      </div>

      <div class="dashboard-grid">
        <div class="dashboard-col">
          <section class="card">
            <div class="card-head">
              <div>
                <h2 class="card-title">Sales · last 14 days</h2>
                <div class="card-sub">Invoiced value including GST</div>
              </div>
              <div class="chart-legend"><span class="legend-dot"></span>Invoiced sales</div>
            </div>
            <div class="chart-wrap">
              <div class="chart-summary">
                <div class="chart-summary-value">₹${money(seriesTotal)}</div>
                <div class="chart-summary-label">across ${seriesBills} ${seriesBills === 1 ? 'bill' : 'bills'}</div>
              </div>
              <div style="margin-top:16px;">
                ${barChart(data.series, { today: data.today, labelEvery: 2 })}
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div>
                <h2 class="card-title">Recent invoices</h2>
                <div class="card-sub">Latest bills raised at the counter</div>
              </div>
              <button type="button" class="btn btn-sm btn-ghost" data-nav="/invoices">View all ${icon('arrowRight')}</button>
            </div>
            ${data.recentInvoices.length
              ? `<div class="table-wrap">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Customer</th>
                        <th>Status</th>
                        <th class="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>${recentRows}</tbody>
                  </table>
                </div>`
              : emptyState({
                  iconName: 'receipt',
                  title: 'No bills yet',
                  text: 'Create your first invoice and it will appear here.',
                  action: '<button type="button" class="btn btn-primary btn-sm" data-nav="/billing">Create a bill</button>'
                })}
          </section>
        </div>

        <div class="dashboard-col">
          <section class="card">
            <div class="card-head">
              <div>
                <h2 class="card-title">Top sellers</h2>
                <div class="card-sub">By revenue · last 30 days</div>
              </div>
              ${icon('trendingUp')}
            </div>
            ${data.topProducts.length ? `<div class="mini-list">${topRows}</div>` : topRows}
          </section>

          <section class="card">
            <div class="card-head">
              <div>
                <h2 class="card-title">Running low</h2>
                <div class="card-sub">${data.lowStockCount} ${data.lowStockCount === 1 ? 'item needs' : 'items need'} attention</div>
              </div>
              <button type="button" class="btn btn-sm btn-ghost" data-nav="/products?low=1">View ${icon('arrowRight')}</button>
            </div>
            ${data.lowStock.length ? `<div class="mini-list">${lowStockRows}</div>` : lowStockRows}
          </section>
        </div>
      </div>
    </div>
  `;
}

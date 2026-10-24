import { CUSTOMER_TYPES } from '../../../shared/constants.js';
import { todayISO } from '../../../shared/format.js';
import { openCustomerForm } from '../customer-form.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import {
  confirmDialog,
  customerAvatar,
  dateText,
  debounce,
  downloadCsv,
  emptyState,
  escapeHtml,
  invoiceStatusChip,
  money,
  openModal,
  pageHead,
  toast
} from '../ui.js';

const view = {
  search: '',
  type: '',
  showArchived: false
};

let cache = [];
let pageAbort = null;
let searchTimer = null;
let pageRoot = null;

function activeCustomers() {
  return cache.filter((customer) => customer.active);
}

function hasFilters() {
  return Boolean(view.search.trim()) || Boolean(view.type) || view.showArchived;
}

function filteredCustomers() {
  const term = view.search.trim().toLowerCase();
  return cache.filter((customer) => {
    if (!view.showArchived && !customer.active) return false;
    if (view.type && customer.type !== view.type) return false;
    if (!term) return true;
    return [customer.name, customer.phone, customer.gstin, customer.city, customer.email]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });
}

function metricsMarkup() {
  const active = activeCustomers();
  const outstanding = active.reduce((sum, customer) => sum + customer.outstanding, 0);
  const withDues = active.filter((customer) => customer.outstanding > 0.004).length;
  const registered = active.filter((customer) => customer.gstin).length;

  return `
    <div class="metric-cell">
      <span class="metric-icon">${icon('customers')}</span>
      <div class="metric-copy">
        <div class="metric-label">Active customers</div>
        <div class="metric-value">${active.length}</div>
        <div class="metric-sub">${cache.length - active.length} archived</div>
      </div>
    </div>
    <div class="metric-cell">
      <span class="metric-icon warn">${icon('clock')}</span>
      <div class="metric-copy">
        <div class="metric-label">Outstanding</div>
        <div class="metric-value" style="${outstanding > 0 ? 'color:var(--red);' : ''}">₹${money(outstanding, { decimals: 0 })}</div>
        <div class="metric-sub">${withDues} ${withDues === 1 ? 'customer has' : 'customers have'} a balance</div>
      </div>
    </div>
    <div class="metric-cell">
      <span class="metric-icon">${icon('receipt')}</span>
      <div class="metric-copy">
        <div class="metric-label">Invoices raised</div>
        <div class="metric-value">${active.reduce((sum, customer) => sum + customer.invoiceCount, 0)}</div>
        <div class="metric-sub">For active customer records</div>
      </div>
    </div>
    <div class="metric-cell">
      <span class="metric-icon">${icon('shield')}</span>
      <div class="metric-copy">
        <div class="metric-label">GST registered</div>
        <div class="metric-value">${registered}</div>
        <div class="metric-sub">Ready for B2B invoices</div>
      </div>
    </div>
  `;
}

function rowMarkup(customer) {
  const outstanding = customer.outstanding > 0.004;
  return `
    <tr class="is-clickable" data-customer="${customer.id}">
      <td>
        <div class="customer-cell">
          ${customerAvatar(customer)}
          <div class="cell-stack">
            <span class="cell-primary">${escapeHtml(customer.name)}${customer.active ? '' : ' <span class="chip chip-neutral" style="margin-left:5px;">Archived</span>'}</span>
            <span class="cell-secondary">${escapeHtml(customer.phone || customer.email || 'No contact saved')}</span>
          </div>
        </div>
      </td>
      <td><span class="type-chip">${escapeHtml(customer.type)}</span></td>
      <td>
        <div class="cell-stack">
          <span class="cell-primary">${escapeHtml(customer.city || '—')}</span>
          <span class="cell-secondary">${escapeHtml(customer.state || '')}</span>
        </div>
      </td>
      <td><span class="mono">${escapeHtml(customer.gstin || '—')}</span></td>
      <td>
        <div class="cell-stack">
          <span class="cell-primary">${customer.invoiceCount} ${customer.invoiceCount === 1 ? 'invoice' : 'invoices'}</span>
          <span class="cell-secondary">${customer.lastInvoiceDate ? `Last ${dateText(customer.lastInvoiceDate)}` : 'No bills yet'}</span>
        </div>
      </td>
      <td class="num money">${outstanding ? `<span class="negative">₹${money(customer.outstanding)}</span>` : '<span class="muted">—</span>'}</td>
      <td>
        <div class="cell-actions">
          <button type="button" class="btn btn-icon" data-view-customer="${customer.id}" title="View customer" aria-label="View ${escapeHtml(customer.name)}">${icon('fileText')}</button>
          <button type="button" class="btn btn-icon" data-edit-customer="${customer.id}" title="Edit customer" aria-label="Edit ${escapeHtml(customer.name)}">${icon('edit')}</button>
          <button type="button" class="btn btn-icon" data-bill-customer="${customer.id}" title="New bill" aria-label="New bill for ${escapeHtml(customer.name)}" ${customer.active ? '' : 'disabled'}>${icon('receipt')}</button>
          <button type="button" class="btn btn-icon" data-toggle-customer="${customer.id}" title="${customer.active ? 'Archive customer' : 'Restore customer'}" aria-label="${customer.active ? 'Archive' : 'Restore'} ${escapeHtml(customer.name)}">${icon(customer.active ? 'archive' : 'restore')}</button>
        </div>
      </td>
    </tr>
  `;
}

function tableMarkup() {
  const customers = filteredCustomers();
  if (!customers.length) {
    return `
      <div class="table-empty">
        ${cache.length
          ? emptyState({
              iconName: 'search',
              title: 'No customers match these filters',
              text: 'Try a different search, or show archived customer records.',
              action: '<button type="button" class="btn btn-sm" data-action="clear-customer-filters">Clear filters</button>'
            })
          : emptyState({
              iconName: 'customers',
              title: 'Add your first customer',
              text: 'Save builders, contractors and walk-in regulars with their GSTIN and site address.',
              action: '<button type="button" class="btn btn-primary" data-action="add-customer">Add customer</button>'
            })}
      </div>
    `;
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Type</th>
            <th>City</th>
            <th>GSTIN</th>
            <th>Bills</th>
            <th class="num">Outstanding</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${customers.map(rowMarkup).join('')}</tbody>
      </table>
    </div>
    <div class="table-foot">
      <span>Showing <strong>${customers.length}</strong> of <strong>${cache.length}</strong> customer records${view.showArchived ? ' · archived included' : ''}</span>
      <span class="muted">${activeCustomers().filter((customer) => customer.outstanding > 0.004).length} with a balance</span>
    </div>
  `;
}

function paint() {
  if (!pageRoot) return;
  const metrics = pageRoot.querySelector('[data-customer-metrics]');
  if (metrics) metrics.innerHTML = metricsMarkup();
  const table = pageRoot.querySelector('[data-customer-table]');
  if (table) table.innerHTML = tableMarkup();
  const toggle = pageRoot.querySelector('[data-archived-toggle]');
  if (toggle) toggle.classList.toggle('active', view.showArchived);
}

async function loadCustomers() {
  cache = await window.tiledesk.customers.list({ includeArchived: true });
  paint();
}

function openForm(customer, ctx) {
  openCustomerForm({
    customer,
    defaultState: ctx.settings?.state ?? 'Tamil Nadu',
    onSaved: async () => {
      try {
        await loadCustomers();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
}

function contactLines(customer) {
  const cityLine = [customer.city, customer.pincode].filter(Boolean).join(' - ');
  return [customer.address, cityLine, customer.state].filter(Boolean);
}

async function openCustomerDetail(customerId) {
  let data;
  try {
    data = await window.tiledesk.customers.get(customerId);
  } catch (error) {
    toast(error.message, 'error');
    return;
  }
  const { customer, invoices, payments } = data;
  const recentInvoices = invoices.slice(0, 8);
  const recentPayments = payments.slice(0, 5);
  const outstanding = customer.outstanding > 0.004;

  const invoiceTable = recentInvoices.length
    ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Invoice</th><th>Status</th><th class="num">Total</th></tr></thead>
          <tbody>
            ${recentInvoices
              .map(
                (invoice) => `
                  <tr class="is-clickable" data-modal-invoice="${invoice.id}">
                    <td>
                      <div class="cell-stack">
                        <span class="invoice-no">${escapeHtml(invoice.invoiceNo)}</span>
                        <span class="cell-secondary">${dateText(invoice.invoiceDate)}</span>
                      </div>
                    </td>
                    <td>${invoiceStatusChip(invoice)}</td>
                    <td class="num money">₹${money(invoice.total)}</td>
                  </tr>
                `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `
    : '<div class="payment-empty">No invoices for this customer yet.</div>';

  const paymentList = recentPayments.length
    ? `<div class="payment-history">
        ${recentPayments
          .map(
            (payment) => `
              <div class="payment-row">
                <span class="payment-row-icon">${icon('checkCircle')}</span>
                <div class="payment-row-copy">
                  <div class="payment-row-title">${escapeHtml(payment.invoiceNo || 'Invoice')} · ${escapeHtml(payment.method)}</div>
                  <div class="payment-row-meta">${dateText(payment.paymentDate)}${payment.reference ? ` · ${escapeHtml(payment.reference)}` : ''}</div>
                </div>
                <div class="payment-row-amount">₹${money(payment.amount)}</div>
              </div>
            `
          )
          .join('')}
      </div>`
    : '<div class="payment-empty">No payments recorded yet.</div>';

  const address = contactLines(customer);

  const handle = openModal({
    eyebrow: `${customer.type} customer`,
    title: customer.name,
    subtitle: [customer.phone, customer.email, customer.gstin ? `GSTIN ${customer.gstin}` : ''].filter(Boolean).join(' · ') || 'No contact details saved',
    size: 'modal-xl',
    body: `
      <div class="metric-strip" style="margin-bottom:14px;">
        <div class="metric-cell">
          <span class="metric-icon warn">${icon('clock')}</span>
          <div class="metric-copy">
            <div class="metric-label">Outstanding</div>
            <div class="metric-value" style="${outstanding ? 'color:var(--red);' : ''}">₹${money(customer.outstanding)}</div>
            <div class="metric-sub">${outstanding ? 'Payment pending' : 'All settled'}</div>
          </div>
        </div>
        <div class="metric-cell">
          <span class="metric-icon">${icon('receipt')}</span>
          <div class="metric-copy">
            <div class="metric-label">Invoices</div>
            <div class="metric-value">${customer.invoiceCount}</div>
            <div class="metric-sub">${customer.lastInvoiceDate ? `Last ${dateText(customer.lastInvoiceDate)}` : 'No bills yet'}</div>
          </div>
        </div>
        <div class="metric-cell">
          <span class="metric-icon">${icon('calendar')}</span>
          <div class="metric-copy">
            <div class="metric-label">Customer since</div>
            <div class="metric-value" style="font-size:13px;">${customer.createdAt ? dateText(customer.createdAt.slice(0, 10)) : '—'}</div>
            <div class="metric-sub">${escapeHtml(customer.state || 'State not set')}</div>
          </div>
        </div>
      </div>

      <div class="report-grid report-grid-even">
        <section class="card" style="overflow:hidden;">
          <div class="card-head">
            <div>
              <h2 class="card-title">Invoices</h2>
              <div class="card-sub">${recentInvoices.length < invoices.length ? `Latest ${recentInvoices.length} of ${invoices.length}` : `${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}`}</div>
            </div>
            ${icon('invoices')}
          </div>
          ${invoiceTable}
        </section>

        <div class="detail-side">
          <section class="card">
            <div class="card-head">
              <div>
                <h2 class="card-title">Contact &amp; tax</h2>
                <div class="card-sub">Used for future invoices</div>
              </div>
            </div>
            <dl class="meta-card">
              <div class="meta-row"><dt>Phone</dt><dd>${escapeHtml(customer.phone || '—')}</dd></div>
              <div class="meta-row"><dt>Email</dt><dd>${escapeHtml(customer.email || '—')}</dd></div>
              <div class="meta-row"><dt>GSTIN</dt><dd><span class="mono">${escapeHtml(customer.gstin || '—')}</span></dd></div>
              <div class="meta-row"><dt>Type</dt><dd>${escapeHtml(customer.type)}</dd></div>
              <div class="meta-row"><dt>Address</dt><dd style="text-align:right;line-height:1.5;">${address.length ? address.map(escapeHtml).join('<br>') : '—'}</dd></div>
              ${customer.notes ? `<div class="meta-row"><dt>Notes</dt><dd style="text-align:right;line-height:1.5;">${escapeHtml(customer.notes)}</dd></div>` : ''}
            </dl>
          </section>

          <section class="card">
            <div class="card-head">
              <div>
                <h2 class="card-title">Recent payments</h2>
                <div class="card-sub">${payments.length} ${payments.length === 1 ? 'payment' : 'payments'} recorded</div>
              </div>
            </div>
            ${paymentList}
          </section>
        </div>
      </div>
    `,
    footer: `
      <button type="button" class="btn" data-modal-close-x>Close</button>
      <button type="button" class="btn" data-modal-edit>${icon('edit')} Edit customer</button>
      <button type="button" class="btn btn-primary" data-modal-bill ${customer.active ? '' : 'disabled'}>${icon('receipt')} New bill</button>
    `,
    onMount(modal, close) {
      modal.querySelector('[data-modal-close-x]').addEventListener('click', close);
      modal.querySelector('[data-modal-edit]').addEventListener('click', () => {
        close();
        openForm(customer, { settings: { state: customer.state } });
      });
      modal.querySelector('[data-modal-bill]').addEventListener('click', () => {
        close();
        navigate('/billing');
      });
      modal.querySelectorAll('[data-modal-invoice]').forEach((row) => {
        row.addEventListener('click', () => {
          close();
          navigate(`/invoices/${row.dataset.modalInvoice}`);
        });
      });
    }
  });
  return handle;
}

async function toggleCustomer(customerId) {
  const customer = cache.find((entry) => entry.id === Number(customerId));
  if (!customer) return;
  const archiving = customer.active;
  const confirmed = await confirmDialog({
    title: archiving ? 'Archive this customer?' : 'Restore this customer?',
    message: archiving
      ? `"${customer.name}" will be hidden when billing. Their past invoices stay untouched.`
      : `"${customer.name}" will be available again in billing and the customer list.`,
    confirmLabel: archiving ? 'Archive customer' : 'Restore customer',
    danger: archiving
  });
  if (!confirmed) return;
  try {
    await window.tiledesk.customers.setActive(customer.id, !archiving);
    await loadCustomers();
    toast(archiving ? 'Customer archived' : 'Customer restored', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function exportCustomers() {
  const customers = filteredCustomers();
  if (!customers.length) {
    toast('There are no customers to export for these filters.', 'info');
    return;
  }
  const rows = [
    ['Name', 'Type', 'Phone', 'Email', 'GSTIN', 'Address', 'City', 'State', 'Pincode', 'Invoices', 'Outstanding', 'Last invoice', 'Notes', 'Status'],
    ...customers.map((customer) => [
      customer.name,
      customer.type,
      customer.phone,
      customer.email,
      customer.gstin,
      customer.address,
      customer.city,
      customer.state,
      customer.pincode,
      customer.invoiceCount,
      customer.outstanding.toFixed(2),
      customer.lastInvoiceDate || '',
      customer.notes,
      customer.active ? 'Active' : 'Archived'
    ])
  ];
  try {
    await downloadCsv(`SAI-TILES-customers-${todayISO()}.csv`, rows);
  } catch (error) {
    toast(error.message, 'error');
  }
}

export async function render(root, ctx) {
  if (pageAbort) pageAbort.abort();
  pageAbort = new AbortController();
  pageRoot = root;
  searchTimer?.cancel?.();

  try {
    cache = await window.tiledesk.customers.list({ includeArchived: true });
  } catch (error) {
    root.innerHTML = `
      <div class="page">
        ${pageHead({ eyebrow: 'Customers', title: 'Customers', subtitle: 'The customer list could not be loaded.' })}
        <div class="card">
          ${emptyState({
            iconName: 'alert',
            title: 'Customers could not load',
            text: error.message,
            action: '<button type="button" class="btn btn-primary" data-action="retry-customers">Try again</button>'
          })}
        </div>
      </div>
    `;
    root.addEventListener(
      'click',
      (event) => {
        if (event.target.closest('[data-action="retry-customers"]')) void render(root, ctx);
      },
      { signal: pageAbort.signal }
    );
    return;
  }

  root.innerHTML = `
    <div class="page">
      ${pageHead({
        eyebrow: 'Customers',
        title: 'Customers',
        subtitle: 'Builders, contractors and retail buyers with their GST and site details ready.',
        actions: `
          <button type="button" class="btn" data-action="export-customers">${icon('download')} Export CSV</button>
          <button type="button" class="btn btn-primary" data-action="add-customer">${icon('userPlus')} Add customer</button>
        `
      })}

      <div class="metric-strip" data-customer-metrics>${metricsMarkup()}</div>

      <section class="card" style="overflow:hidden;">
        <div class="page-toolbar">
          <div class="filter-bar" style="flex:1;">
            <div class="search-field">
              ${icon('search')}
              <input class="input" data-customer-query placeholder="Search name, phone, GSTIN or city…" value="${escapeHtml(view.search)}" autocomplete="off" spellcheck="false" />
            </div>
            <select class="select filter-select" data-type-filter aria-label="Filter by customer type">
              <option value="">All types</option>
              ${CUSTOMER_TYPES.map((type) => `<option value="${escapeHtml(type)}"${type === view.type ? ' selected' : ''}>${escapeHtml(type)}</option>`).join('')}
            </select>
            <button type="button" class="filter-toggle${view.showArchived ? ' active' : ''}" data-archived-toggle>${icon('archive')} Archived</button>
          </div>
        </div>
        <div data-customer-table>${tableMarkup()}</div>
      </section>
    </div>
  `;

  searchTimer = debounce(() => paint(), 180);

  root.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('[data-action="add-customer"]')) {
        openForm(null, ctx);
        return;
      }
      if (event.target.closest('[data-action="export-customers"]')) {
        void exportCustomers();
        return;
      }
      if (event.target.closest('[data-action="clear-customer-filters"]')) {
        view.search = '';
        view.type = '';
        view.showArchived = false;
        const input = root.querySelector('[data-customer-query]');
        if (input) input.value = '';
        const select = root.querySelector('[data-type-filter]');
        if (select) select.value = '';
        paint();
        return;
      }

      const archivedToggle = event.target.closest('[data-archived-toggle]');
      if (archivedToggle) {
        view.showArchived = !view.showArchived;
        paint();
        return;
      }

      const viewButton = event.target.closest('[data-view-customer]');
      if (viewButton) {
        void openCustomerDetail(Number(viewButton.dataset.viewCustomer));
        return;
      }
      const editButton = event.target.closest('[data-edit-customer]');
      if (editButton) {
        const customer = cache.find((entry) => entry.id === Number(editButton.dataset.editCustomer));
        if (customer) openForm(customer, ctx);
        return;
      }
      const billButton = event.target.closest('[data-bill-customer]');
      if (billButton && !billButton.disabled) {
        navigate('/billing');
        return;
      }
      const toggleButton = event.target.closest('[data-toggle-customer]');
      if (toggleButton) {
        void toggleCustomer(toggleButton.dataset.toggleCustomer);
        return;
      }

      const row = event.target.closest('[data-customer]');
      if (row) {
        void openCustomerDetail(Number(row.dataset.customer));
      }
    },
    { signal: pageAbort.signal }
  );

  root.addEventListener(
    'input',
    (event) => {
      if (!event.target.matches('[data-customer-query]')) return;
      view.search = event.target.value;
      searchTimer?.();
    },
    { signal: pageAbort.signal }
  );

  root.addEventListener(
    'change',
    (event) => {
      if (!event.target.matches('[data-type-filter]')) return;
      view.type = event.target.value;
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

import { todayISO } from '../../../shared/format.js';
import { icon } from '../icons.js';
import {
  dateText,
  debounce,
  downloadCsv,
  emptyState,
  escapeHtml,
  invoiceStatusChip,
  money,
  pageHead,
  tableLoading,
  toast
} from '../ui.js';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Part paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Cancelled' }
];

const listState = {
  search: '',
  status: 'all',
  page: 1,
  pageSize: 25
};

let pageAbort = null;
let searchTimer = null;
let loadToken = 0;
let listRoot = null;

function hasFilters() {
  return Boolean(listState.search.trim()) || listState.status !== 'all';
}

function statusLabel(value) {
  return STATUS_OPTIONS.find((option) => option.value === value)?.label ?? 'All';
}

function paginationMarkup(page, pages) {
  if (pages <= 1) return '';
  const numbers = new Set([1, pages]);
  for (let index = page - 1; index <= page + 1; index += 1) {
    if (index >= 1 && index <= pages) numbers.add(index);
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const buttons = [
    `<button type="button" class="page-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevronLeft')}</button>`
  ];
  let previous = 0;
  for (const number of sorted) {
    if (previous && number - previous > 1) buttons.push('<span class="muted small">…</span>');
    buttons.push(
      `<button type="button" class="page-btn${number === page ? ' active' : ''}" data-page="${number}" aria-label="Page ${number}">${number}</button>`
    );
    previous = number;
  }
  buttons.push(
    `<button type="button" class="page-btn" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">${icon('chevronRight')}</button>`
  );
  return `<div class="pagination">${buttons.join('')}</div>`;
}

function invoiceRows(invoices) {
  return invoices
    .map((invoice) => {
      const outstanding = invoice.status === 'active' && invoice.balance > 0.004;
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
          <td>
            <div class="cell-stack">
              <span class="cell-primary">${escapeHtml(invoice.placeOfSupply)}</span>
              <span class="cell-secondary">${invoice.isInterState ? 'IGST · Inter-state' : 'CGST + SGST'}</span>
            </div>
          </td>
          <td>${invoiceStatusChip(invoice)}</td>
          <td class="num money strong">₹${money(invoice.total)}</td>
          <td class="num money">${outstanding ? `<span class="negative">₹${money(invoice.balance)}</span>` : '<span class="muted">—</span>'}</td>
          <td class="num" style="width:34px;color:var(--muted);">${icon('chevronRight')}</td>
        </tr>
      `;
    })
    .join('');
}

function tableMarkup(result) {
  if (!result.items.length) {
    return `
      <div class="table-empty">
        ${hasFilters()
          ? emptyState({
              iconName: 'search',
              title: 'No invoices match these filters',
              text: `Nothing found for “${listState.search.trim() || statusLabel(listState.status)}”. Try a different search or status.`,
              action: '<button type="button" class="btn btn-sm" data-action="clear-invoice-filters">Clear filters</button>'
            })
          : emptyState({
              iconName: 'receipt',
              title: 'No invoices yet',
              text: 'Your first bill will appear here once it is raised at the counter.',
              action: '<button type="button" class="btn btn-primary btn-sm" data-nav="/billing">Create the first bill</button>'
            })}
      </div>
    `;
  }

  const start = (result.page - 1) * result.pageSize + 1;
  const end = Math.min(result.page * result.pageSize, result.total);

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Place of supply</th>
            <th>Status</th>
            <th class="num">Total</th>
            <th class="num">Balance</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${invoiceRows(result.items)}</tbody>
      </table>
    </div>
    <div class="table-foot">
      <span>Showing <strong>${start}–${end}</strong> of <strong>${result.total}</strong> invoices${hasFilters() ? ` · ${statusLabel(listState.status)}` : ''}</span>
      ${paginationMarkup(result.page, result.pages)}
    </div>
  `;
}

async function loadList(container) {
  const token = ++loadToken;
  container.innerHTML = tableLoading(6);
  try {
    const result = await window.tiledesk.invoices.list({
      search: listState.search.trim(),
      status: listState.status,
      page: listState.page,
      pageSize: listState.pageSize
    });
    if (token !== loadToken) return;
    if (result.page > result.pages && result.pages >= 1) {
      listState.page = result.pages;
      await loadList(container);
      return;
    }
    container.innerHTML = tableMarkup(result);
    const searchInput = listRoot?.querySelector('[data-invoices-search]');
    if (searchInput && searchInput.value !== listState.search) {
      searchInput.value = listState.search;
    }
  } catch (error) {
    if (token !== loadToken) return;
    container.innerHTML = `
      <div class="table-empty">
        ${emptyState({
          iconName: 'alert',
          title: 'Invoices could not load',
          text: error.message,
          action: '<button type="button" class="btn btn-sm" data-action="retry-invoices">Try again</button>'
        })}
      </div>
    `;
  }
}

function syncStatusButtons() {
  for (const button of listRoot?.querySelectorAll('[data-status]') ?? []) {
    button.classList.toggle('active', button.dataset.status === listState.status);
  }
}

async function exportInvoices() {
  try {
    const result = await window.tiledesk.invoices.list({
      search: listState.search.trim(),
      status: listState.status,
      page: 1,
      pageSize: 100
    });
    if (!result.items.length) {
      toast('There are no invoices to export for these filters.', 'info');
      return;
    }
    const rows = [
      [
        'Invoice no',
        'Invoice date',
        'Customer',
        'Phone',
        'GSTIN',
        'Place of supply',
        'Taxable',
        'CGST',
        'SGST',
        'IGST',
        'Total',
        'Received',
        'Balance',
        'Payment status',
        'Invoice status'
      ],
      ...result.items.map((invoice) => [
        invoice.invoiceNo,
        invoice.invoiceDate,
        invoice.customerName,
        invoice.customerPhone,
        invoice.customerGstin,
        `${invoice.placeOfSupply} (${invoice.stateCode})`,
        invoice.taxableTotal.toFixed(2),
        invoice.cgst.toFixed(2),
        invoice.sgst.toFixed(2),
        invoice.igst.toFixed(2),
        invoice.total.toFixed(2),
        invoice.amountPaid.toFixed(2),
        invoice.balance.toFixed(2),
        invoice.status === 'void' ? 'Cancelled' : invoice.paymentStatus,
        invoice.status
      ])
    ];
    await downloadCsv(`SAI-TILES-invoices-${todayISO()}.csv`, rows);
    if (result.total > result.items.length) {
      toast(`Exported the latest ${result.items.length} invoices. Narrow the filters to include the rest.`, 'info', { duration: 5600 });
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

export async function render(root, ctx) {
  if (pageAbort) pageAbort.abort();
  pageAbort = new AbortController();
  listRoot = root;
  loadToken += 1;

  if (ctx.query.status && STATUS_OPTIONS.some((option) => option.value === ctx.query.status)) {
    listState.status = ctx.query.status;
    listState.page = 1;
  }
  if (typeof ctx.query.q === 'string') {
    listState.search = ctx.query.q;
    listState.page = 1;
  }

  const content = `
    <div class="page-toolbar">
      <div class="filter-bar" style="flex:1;">
        <div class="search-field">
          ${icon('search')}
          <input class="input" data-invoices-search placeholder="Search invoice no, customer or phone…" value="${escapeHtml(listState.search)}" autocomplete="off" spellcheck="false" />
        </div>
        <div class="segmented" data-status-filter>
          ${STATUS_OPTIONS.map(
            (option) =>
              `<button type="button" data-status="${option.value}" class="${option.value === listState.status ? 'active' : ''}">${option.label}</button>`
          ).join('')}
        </div>
      </div>
    </div>
    <div data-invoices-list>${tableLoading(6)}</div>
  `;

  root.innerHTML = `
    <div class="page">
      ${pageHead({
        eyebrow: 'Sales ledger',
        title: 'Invoices',
        subtitle: 'Search, review and reprint every tax invoice raised at the counter.',
        actions: `
          <button type="button" class="btn" data-action="export-invoices">${icon('download')} Export CSV</button>
          <button type="button" class="btn btn-primary" data-nav="/billing">${icon('plus')} New bill</button>
        `
      })}
      <section class="card" style="overflow:hidden;">${content}</section>
    </div>
  `;

  const listContainer = root.querySelector('[data-invoices-list]');
  searchTimer = debounce(() => {
    listState.page = 1;
    loadList(listContainer);
  }, 260);

  const { signal } = pageAbort;
  root.addEventListener(
    'click',
    (event) => {
      const statusButton = event.target.closest('[data-status]');
      if (statusButton) {
        listState.status = statusButton.dataset.status;
        listState.page = 1;
        searchTimer?.cancel?.();
        syncStatusButtons();
        loadList(listContainer);
        return;
      }

      const pageButton = event.target.closest('[data-page]');
      if (pageButton && !pageButton.disabled) {
        const page = Number(pageButton.dataset.page);
        if (Number.isFinite(page) && page >= 1 && page !== listState.page) {
          listState.page = page;
          loadList(listContainer);
        }
        return;
      }

      if (event.target.closest('[data-action="export-invoices"]')) {
        void exportInvoices();
        return;
      }

      if (event.target.closest('[data-action="retry-invoices"]')) {
        loadList(listContainer);
        return;
      }

      if (event.target.closest('[data-action="clear-invoice-filters"]')) {
        listState.search = '';
        listState.status = 'all';
        listState.page = 1;
        searchTimer?.cancel?.();
        const input = root.querySelector('[data-invoices-search]');
        if (input) input.value = '';
        syncStatusButtons();
        loadList(listContainer);
      }
    },
    { signal }
  );

  root.addEventListener(
    'input',
    (event) => {
      if (!event.target.matches('[data-invoices-search]')) return;
      listState.search = event.target.value;
      searchTimer?.();
    },
    { signal }
  );

  await loadList(listContainer);
}

export function cleanup() {
  if (pageAbort) {
    pageAbort.abort();
    pageAbort = null;
  }
  searchTimer?.cancel?.();
  searchTimer = null;
  listRoot = null;
}

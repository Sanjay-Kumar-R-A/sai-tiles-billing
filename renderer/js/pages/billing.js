import { computeInvoice, derivedRate, GST_RATES, PAYMENT_METHODS } from '../../../shared/calc.js';
import { addDaysISO, formatQty, todayISO } from '../../../shared/format.js';
import { INDIAN_STATES } from '../../../shared/states.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { store } from '../store.js';
import { openCustomerForm } from '../customer-form.js';
import {
  clearFormError,
  confirmDialog,
  escapeHtml,
  formDataObject,
  money,
  openModal,
  pageHead,
  parseNumber,
  productSwatch,
  qty,
  setButtonLoading,
  showFormError,
  toast
} from '../ui.js';

const DRAFT_KEY = 'tiledesk.billingDraft.v1';
const GST_OPTIONS = GST_RATES;

let state = null;
let ctxRef = null;
let pageRoot = null;
let pageAbort = null;
let comboOpen = false;
let comboIndex = 0;
let comboResults = [];
let lineCounter = 0;

function makeKey() {
  lineCounter += 1;
  return `line-${Date.now()}-${lineCounter}`;
}

function formatLineQty(line) {
  return line.unit === 'sqft'
    ? `${qty(line.qty)} sq ft`
    : `${qty(line.qty)} box${Number(line.qty) === 1 ? '' : 'es'}`;
}

function formatBoxes(value) {
  return `${qty(value)} box${Number(value) === 1 ? '' : 'es'}`;
}

function stateOptions(selected) {
  return INDIAN_STATES.map(
    (entry) =>
      `<option value="${escapeHtml(entry.name)}"${entry.name === selected ? ' selected' : ''}>${escapeHtml(entry.name)} (${entry.code})</option>`
  ).join('');
}

function methodOptions(selected) {
  return PAYMENT_METHODS.map(
    (method) => `<option value="${escapeHtml(method)}"${method === selected ? ' selected' : ''}>${escapeHtml(method)}</option>`
  ).join('');
}

function createInitialState() {
  const settings = store.settings;
  const today = todayISO();
  return {
    mode: 'walkin',
    walkin: { name: '', phone: '', gstin: '', billingAddress: '' },
    customerId: null,
    placeOfSupply: settings.state,
    invoiceDate: today,
    dueDate: addDaysISO(today, Number(settings.dueDays) || 0),
    dueTouched: false,
    items: [],
    notes: '',
    amountPaid: '',
    paymentMethod: 'Cash',
    paymentReference: '',
    nextInvoice: '',
    customers: [],
    products: []
  };
}

function hydrateDraft() {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== 'object') return;
    if (draft.mode === 'saved' || draft.mode === 'walkin') state.mode = draft.mode;
    if (draft.walkin && typeof draft.walkin === 'object') {
      for (const field of ['name', 'phone', 'gstin', 'billingAddress']) {
        if (typeof draft.walkin[field] === 'string') state.walkin[field] = draft.walkin[field];
      }
    }
    if (draft.customerId) state.customerId = Number(draft.customerId) || null;
    if (INDIAN_STATES.some((entry) => entry.name === draft.placeOfSupply)) {
      state.placeOfSupply = draft.placeOfSupply;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(draft.invoiceDate || '')) state.invoiceDate = draft.invoiceDate;
    if (/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate || '')) state.dueDate = draft.dueDate;
    state.dueTouched = Boolean(draft.dueTouched);
    if (Array.isArray(draft.items)) {
      state.items = draft.items
        .filter((item) => item && typeof item === 'object' && item.name && item.key)
        .map((item) => ({
          key: String(item.key),
          productId: item.productId ? Number(item.productId) : null,
          isCustom: !item.productId,
          name: String(item.name).slice(0, 120),
          sku: String(item.sku ?? '').slice(0, 40),
          size: String(item.size ?? '').slice(0, 40),
          brand: String(item.brand ?? '').slice(0, 60),
          hsn: String(item.hsn ?? '').slice(0, 20),
          unit: item.unit === 'box' ? 'box' : 'sqft',
          qty: String(item.qty ?? ''),
          rate: String(item.rate ?? ''),
          discountPct: String(item.discountPct ?? ''),
          gstRate: Number(item.gstRate) || 0,
          sqftPerBox: Number(item.sqftPerBox) || 0,
          stockBoxes: Number(item.stockBoxes) || 0
        }));
    }
    if (typeof draft.notes === 'string') state.notes = draft.notes.slice(0, 2000);
    if (draft.amountPaid != null) state.amountPaid = String(draft.amountPaid);
    if (PAYMENT_METHODS.includes(draft.paymentMethod)) state.paymentMethod = draft.paymentMethod;
    if (typeof draft.paymentReference === 'string') state.paymentReference = draft.paymentReference.slice(0, 100);
  } catch {
    // Ignore a corrupt draft and start clean.
  }
}

function saveDraft() {
  if (!state) return;
  try {
    window.sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        mode: state.mode,
        walkin: state.walkin,
        customerId: state.customerId,
        placeOfSupply: state.placeOfSupply,
        invoiceDate: state.invoiceDate,
        dueDate: state.dueDate,
        dueTouched: state.dueTouched,
        items: state.items,
        notes: state.notes,
        amountPaid: state.amountPaid,
        paymentMethod: state.paymentMethod,
        paymentReference: state.paymentReference
      })
    );
  } catch {
    // A full disk should not block billing.
  }
}

function clearDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore storage failures.
  }
}

async function loadReferences() {
  const [customers, products, info] = await Promise.all([
    window.tiledesk.customers.list(),
    window.tiledesk.products.list(),
    window.tiledesk.app.info()
  ]);
  state.customers = customers;
  state.products = products;
  state.nextInvoice = info?.summary?.nextInvoiceNumber ?? '';

  let removed = 0;
  state.items = state.items.filter((item) => {
    if (!item.productId) return true;
    const product = products.find((entry) => entry.id === item.productId);
    if (!product) {
      removed += 1;
      return false;
    }
    item.name = product.name;
    item.sku = product.sku;
    item.size = product.size;
    item.brand = product.brand;
    item.hsn = product.hsn;
    item.gstRate = product.gstRate;
    item.sqftPerBox = product.sqftPerBox;
    item.stockBoxes = product.stockBoxes;
    if (item.unit === 'sqft' && product.sqftPerBox <= 0) item.unit = 'box';
    return true;
  });
  if (state.customerId && !customers.some((customer) => customer.id === state.customerId)) {
    state.customerId = null;
    if (state.mode === 'saved') state.mode = 'walkin';
  }
  if (removed > 0) {
    toast('Some items in the saved draft are no longer in the catalogue.', 'info');
    saveDraft();
  }
}

function currentCustomer() {
  return state.customers.find((customer) => customer.id === state.customerId) ?? null;
}

function isIntraState() {
  return String(state.placeOfSupply).toLowerCase() === String(store.settings.state).toLowerCase();
}

function productFor(item) {
  return item.productId ? state.products.find((product) => product.id === item.productId) ?? null : null;
}

function computeTotals() {
  return computeInvoice(
    state.items.map((item) => ({
      key: item.key,
      productId: item.productId,
      name: item.name,
      sku: item.sku,
      size: item.size,
      brand: item.brand,
      hsn: item.hsn,
      qty: parseNumber(item.qty),
      rate: parseNumber(item.rate),
      discountPct: parseNumber(item.discountPct),
      unit: item.unit,
      sqftPerBox: parseNumber(item.sqftPerBox),
      gstRate: parseNumber(item.gstRate)
    })),
    {
      intraState: isIntraState(),
      roundOff: Boolean(store.settings.roundOffEnabled)
    }
  );
}

function billIsDirty() {
  return (
    state.items.length > 0 ||
    Boolean(state.notes.trim()) ||
    Boolean(state.customerId) ||
    Boolean(state.walkin.name || state.walkin.phone || state.walkin.gstin || state.walkin.billingAddress) ||
    (state.amountPaid !== '' && Number(state.amountPaid) > 0)
  );
}

function taxPillMarkup() {
  const intra = isIntraState();
  return `<span class="dot"></span>${intra ? 'CGST + SGST · Intra-state' : 'IGST · Inter-state'}`;
}

function walkinPanel() {
  return `
    <div class="customer-form-row">
      <div class="field">
        <label for="bill-customer-name">Name</label>
        <input class="input" id="bill-customer-name" data-walkin="name" value="${escapeHtml(state.walkin.name)}" placeholder="Walk-in Customer" maxlength="120" autocomplete="off" />
      </div>
      <div class="field">
        <label for="bill-customer-phone">Phone</label>
        <input class="input" id="bill-customer-phone" data-walkin="phone" value="${escapeHtml(state.walkin.phone)}" placeholder="Mobile number" maxlength="30" inputmode="tel" autocomplete="off" />
      </div>
      <div class="field">
        <label for="bill-pos-walkin">Place of supply</label>
        <select class="select" id="bill-pos-walkin" data-place-of-supply>${stateOptions(state.placeOfSupply)}</select>
      </div>
    </div>
    <div class="field-grid" style="margin-top:12px;">
      <div class="field">
        <label for="bill-customer-gstin">GSTIN <span class="optional">optional</span></label>
        <input class="input" id="bill-customer-gstin" data-walkin="gstin" value="${escapeHtml(state.walkin.gstin)}" placeholder="For a B2B walk-in customer" maxlength="15" spellcheck="false" style="text-transform:uppercase;" autocomplete="off" />
      </div>
      <div class="field">
        <label for="bill-customer-address">Billing address <span class="optional">optional</span></label>
        <input class="input" id="bill-customer-address" data-walkin="billingAddress" value="${escapeHtml(state.walkin.billingAddress)}" placeholder="Printed on the invoice" maxlength="300" />
      </div>
    </div>
    <p class="customer-hint">${state.walkin.gstin ? 'This will be recorded as a B2B invoice.' : 'Selling to a business with a GSTIN? Add it so they can claim input tax credit.'}</p>
  `;
}

function savedPanel() {
  const selected = currentCustomer();
  const options = [
    '<option value="">Choose a saved customer…</option>',
    ...state.customers.map(
      (customer) =>
        `<option value="${customer.id}"${customer.id === state.customerId ? ' selected' : ''}>${escapeHtml(customer.name)}${customer.phone ? ` · ${escapeHtml(customer.phone)}` : ''}</option>`
    )
  ].join('');
  const address = selected
    ? [selected.address, [selected.city, selected.pincode].filter(Boolean).join(' - ')].filter(Boolean).join(', ')
    : '';

  return `
    <div class="saved-customer-row">
      <div class="field">
        <label for="bill-customer-select">Customer</label>
        <select class="select" id="bill-customer-select" data-customer-select>${options}</select>
      </div>
      <div class="field">
        <label for="bill-pos-saved">Place of supply</label>
        <select class="select" id="bill-pos-saved" data-place-of-supply>${stateOptions(state.placeOfSupply)}</select>
      </div>
      <button type="button" class="btn" data-action="edit-customer"${selected ? '' : ' disabled'}>${icon('edit')} Edit</button>
    </div>
    ${selected
      ? `<div class="customer-selected" style="margin-top:12px;">
          <span class="avatar avatar-lg ${selected.type === 'Retail' ? '' : 'avatar-green'}">${escapeHtml(initials(selected.name))}</span>
          <div class="customer-selected-copy">
            <div class="customer-selected-name">${escapeHtml(selected.name)}</div>
            <div class="customer-selected-meta">${[selected.type, selected.phone, selected.gstin ? `GSTIN ${selected.gstin}` : 'No GSTIN'].filter(Boolean).map(escapeHtml).join(' · ')}${address ? `<br>${escapeHtml(address)}` : ''}</div>
          </div>
          ${selected.outstanding > 0 ? `<span class="chip chip-partial">₹${money(selected.outstanding)} due</span>` : '<span class="chip chip-paid">Settled</span>'}
          <button type="button" class="btn btn-sm btn-ghost" data-action="clear-customer">${icon('close')}</button>
        </div>`
      : `<p class="customer-hint" style="margin-top:12px;">No customer selected. Pick one from the list above, or add a new customer from the top right.</p>`}
    ${state.customers.length === 0 ? `<p class="customer-hint">There are no saved customers yet. Use <strong>New customer</strong> to create one.</p>` : ''}
  `;
}

function customerPanelMarkup() {
  return state.mode === 'saved' ? savedPanel() : walkinPanel();
}

function customerMetaText() {
  if (state.mode === 'saved') {
    const customer = currentCustomer();
    return customer ? `${customer.type} · ${customer.city || customer.state}` : 'Choose a saved customer';
  }
  return state.walkin.gstin ? 'B2B walk-in customer' : 'Retail walk-in';
}

function itemMetaMarkup(item, line) {
  const pieces = [item.sku, item.size, item.hsn ? `HSN ${item.hsn}` : '', item.brand].filter(Boolean);
  const area = line.areaSqft > 0 ? `${qty(line.areaSqft)} sq ft` : '';
  if (item.unit === 'sqft' && item.sqftPerBox > 0) pieces.push(`${formatBoxes(line.boxes)} · ${qty(item.sqftPerBox)} sq ft/box`);
  else if (item.unit === 'box' && item.sqftPerBox > 0) pieces.push(`${area}`);
  else if (area) pieces.push(area);
  return pieces.map(escapeHtml).join(' · ');
}

function lineWarning(item, line) {
  if (!item.productId) return '';
  const product = productFor(item);
  if (!product) return 'This item is no longer in the catalogue.';
  if (line.boxes > product.stockBoxes + 0.0001) {
    return product.stockBoxes <= 0
      ? 'Out of stock — save only if this is a special order.'
      : `Only ${formatBoxes(product.stockBoxes)} in stock.`;
  }
  return '';
}

function rowMarkup(item, line) {
  const product = productFor(item);
  const currentCustomerType = product ? null : null;
  const removeSqft = product && product.sqftPerBox <= 0;
  return `
    <tr data-line-key="${escapeHtml(item.key)}">
      <td>
        <div class="cart-item">
          ${product ? productSwatch(product) : `<span class="avatar avatar-slate">${icon('note')}</span>`}
          <div style="min-width:0;">
            <div class="cart-item-name">${escapeHtml(item.name)}${currentCustomerType ?? ''}</div>
            <div class="cart-item-meta" data-line-meta>${itemMetaMarkup(item, line)}</div>
            <div class="cart-item-note${lineWarning(item, line) ? '' : ' hidden'}" data-line-warning>${escapeHtml(lineWarning(item, line))}</div>
          </div>
        </div>
      </td>
      <td>
        <div class="qty-cluster">
          <input class="input qty-input" data-field="qty" data-key="${escapeHtml(item.key)}" value="${escapeHtml(item.qty)}" inputmode="decimal" aria-label="Quantity" />
          <select class="select unit-select" data-field="unit" data-key="${escapeHtml(item.key)}" aria-label="Billing unit">
            <option value="sqft"${item.unit === 'sqft' ? ' selected' : ''}${removeSqft ? ' disabled' : ''}>sq ft</option>
            <option value="box"${item.unit === 'box' ? ' selected' : ''}>box</option>
          </select>
        </div>
        <div class="cell-secondary" data-line-qty-hint style="margin-top:3px;text-align:left;">${escapeHtml(formatLineQty(line))}</div>
      </td>
      <td>
        <input class="input rate-input" data-field="rate" data-key="${escapeHtml(item.key)}" value="${escapeHtml(item.rate)}" inputmode="decimal" aria-label="Rate per ${item.unit === 'sqft' ? 'sq ft' : 'box'}" />
        <div class="cell-secondary" style="margin-top:3px;">per ${item.unit === 'sqft' ? 'sq ft' : 'box'}</div>
      </td>
      <td>
        <input class="input discount-input" data-field="discountPct" data-key="${escapeHtml(item.key)}" value="${escapeHtml(item.discountPct)}" inputmode="decimal" aria-label="Discount percent" />
      </td>
      <td class="tax-cell num" data-line-tax>${formatQty(line.gstRate)}% · ₹${money(line.cgst + line.sgst + line.igst)}</td>
      <td class="num">
        <div class="cart-amount" data-line-amount>₹${money(line.total)}</div>
        <button type="button" class="cart-remove" data-remove-line="${escapeHtml(item.key)}" aria-label="Remove ${escapeHtml(item.name)}">${icon('trash')}</button>
      </td>
    </tr>
  `;
}

function cartMarkup(totals) {
  if (!state.items.length) {
    return `
      <div class="cart-empty">
        <div class="empty-icon" style="margin:0 auto;">${icon('products')}</div>
        <div class="cart-empty-title">Your bill is empty</div>
        <p class="cart-empty-text">Search for a tile above to start the bill, or add a custom line for cutting, fitting or other charges.</p>
        <button type="button" class="btn btn-sm" style="margin-top:13px;" data-action="custom-item">${icon('plus')} Add custom item</button>
      </div>
    `;
  }

  return `
    <div class="table-wrap">
      <table class="cart-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Quantity</th>
            <th>Rate</th>
            <th>Disc %</th>
            <th class="num">GST</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${totals.lines.map((line, index) => rowMarkup(state.items[index], line)).join('')}</tbody>
      </table>
    </div>
    <div class="cart-foot">
      <div class="cart-foot-meta" data-cart-meta></div>
      <div class="cart-foot-actions">
        <button type="button" class="btn btn-sm btn-ghost" data-action="custom-item">${icon('plus')} Custom item</button>
      </div>
    </div>
  `;
}

function renderCartArea(totals) {
  const area = pageRoot.querySelector('[data-cart-area]');
  if (!area) return;
  area.innerHTML = cartMarkup(totals);
}

function summaryTaxLines(totals) {
  if (isIntraState()) {
    return `
      <div class="summary-line small"><span>CGST</span><span class="value">₹${money(totals.cgst)}</span></div>
      <div class="summary-line small"><span>SGST</span><span class="value">₹${money(totals.sgst)}</span></div>
    `;
  }
  return `<div class="summary-line small"><span>IGST</span><span class="value">₹${money(totals.igst)}</span></div>`;
}

function summaryMarkup() {
  const today = todayISO();
  return `
    <div class="card summary-card">
      <div class="summary-head">
        <div class="summary-title">Bill summary</div>
        <div class="summary-badge">GST invoice</div>
      </div>
      <div class="summary-meta">
        <div class="field">
          <label for="bill-invoice-date">Invoice date</label>
          <input class="input input-sm" id="bill-invoice-date" type="date" data-invoice-date value="${escapeHtml(state.invoiceDate)}" max="${today}" />
        </div>
        <div class="field">
          <label for="bill-due-date">Due date</label>
          <input class="input input-sm" id="bill-due-date" type="date" data-due-date value="${escapeHtml(state.dueDate)}" min="${escapeHtml(state.invoiceDate)}" />
        </div>
      </div>
      <div class="summary-lines">
        <div class="summary-line"><span>Items</span><span class="value" data-summary-items>0</span></div>
        <div class="summary-line small" data-summary-area-row><span>Total area</span><span class="value" data-summary-area>0 sq ft</span></div>
        <div class="summary-line"><span>Subtotal</span><span class="value" data-summary-subtotal>₹0.00</span></div>
        <div class="summary-line" data-summary-discount-row><span>Discount</span><span class="value discount" data-summary-discount>− ₹0.00</span></div>
        <div class="summary-line"><span>Taxable value</span><span class="value" data-summary-taxable>₹0.00</span></div>
        <div data-tax-lines></div>
        <div class="summary-line small" data-roundoff-row><span>Round off</span><span class="value" data-summary-roundoff>₹0.00</span></div>
      </div>
      <div class="summary-total">
        <span class="summary-total-label">Invoice total</span>
        <span class="summary-total-value" data-summary-total>₹0.00</span>
      </div>
      <div class="summary-payment">
        <div class="field">
          <label for="bill-payment-amount">Amount received</label>
          <div class="input-affix">
            <span class="affix">₹</span>
            <input class="input" id="bill-payment-amount" data-payment-amount value="${escapeHtml(state.amountPaid)}" placeholder="0.00" inputmode="decimal" autocomplete="off" />
          </div>
        </div>
        <div class="summary-quick">
          <button type="button" class="btn" data-action="pay-full">Full</button>
          <button type="button" class="btn" data-action="pay-half">Half</button>
          <button type="button" class="btn" data-action="pay-none">None</button>
        </div>
        <div class="field">
          <label for="bill-payment-method">Payment method</label>
          <select class="select" id="bill-payment-method" data-payment-method>${methodOptions(state.paymentMethod)}</select>
        </div>
        <div class="field">
          <label for="bill-payment-reference">Reference <span class="optional">optional</span></label>
          <input class="input" id="bill-payment-reference" data-payment-reference value="${escapeHtml(state.paymentReference)}" placeholder="UPI ref, cheque no…" maxlength="100" autocomplete="off" />
        </div>
        <p class="hint" data-payment-hint>Save the bill as unpaid, or collect payment now.</p>
      </div>
      <div class="summary-balance" data-balance-row>
        <span>Balance due</span>
        <strong data-summary-balance>₹0.00</strong>
      </div>
      <div class="summary-actions">
        <div class="form-error hidden" data-form-error></div>
        <button type="button" class="btn btn-primary btn-lg btn-block" data-action="create-invoice"${state.items.length ? '' : ' disabled'}>${icon('check')} Create invoice</button>
        <button type="button" class="btn btn-block" data-action="create-print"${state.items.length ? '' : ' disabled'}>${icon('printer')} Create &amp; print A4</button>
      </div>
      <div style="padding:0 20px 17px;">
        <div class="summary-note">
          ${icon('shield')}
          <span>GST is calculated after line discounts. Stock is deducted when the invoice is saved.</span>
        </div>
      </div>
    </div>
  `;
}

function summaryCustomerLine() {
  if (state.mode === 'saved') {
    const customer = currentCustomer();
    return customer?.name ?? 'Saved customer not selected';
  }
  return state.walkin.name || 'Walk-in Customer';
}

function updateTaxPill() {
  const pill = pageRoot?.querySelector('[data-tax-pill]');
  if (!pill) return;
  pill.classList.toggle('inter', !isIntraState());
  pill.innerHTML = taxPillMarkup();
}

function updateRows(totals) {
  for (let index = 0; index < totals.lines.length; index += 1) {
    const line = totals.lines[index];
    const item = state.items[index];
    const row = pageRoot.querySelector(`[data-line-key="${CSS.escape(item.key)}"]`);
    if (!row) continue;
    const meta = row.querySelector('[data-line-meta]');
    if (meta) meta.innerHTML = itemMetaMarkup(item, line);
    const warning = row.querySelector('[data-line-warning]');
    if (warning) {
      const text = lineWarning(item, line);
      warning.textContent = text;
      warning.classList.toggle('hidden', !text);
    }
    const tax = row.querySelector('[data-line-tax]');
    if (tax) tax.textContent = `${formatQty(line.gstRate)}% · ₹${money(line.cgst + line.sgst + line.igst)}`;
    const amount = row.querySelector('[data-line-amount]');
    if (amount) amount.textContent = `₹${money(line.total)}`;
    const hint = row.querySelector('[data-line-qty-hint]');
    if (hint) hint.textContent = formatLineQty(line);
    const rate = row.querySelector('[data-field="rate"]');
    if (rate) rate.setAttribute('aria-label', `Rate per ${item.unit === 'sqft' ? 'sq ft' : 'box'}`);
    const rateCaption = rate?.nextElementSibling;
    if (rateCaption) rateCaption.textContent = `per ${item.unit === 'sqft' ? 'sq ft' : 'box'}`;
  }
}

function updatePaymentSummary(totals) {
  const amount = parseNumber(state.amountPaid);
  const balance = Math.max(Number(totals.total) - amount, 0);
  const balanceValue = pageRoot.querySelector('[data-summary-balance]');
  const balanceRow = pageRoot.querySelector('[data-balance-row]');
  const hint = pageRoot.querySelector('[data-payment-hint]');
  const method = pageRoot.querySelector('[data-payment-method]');
  const reference = pageRoot.querySelector('[data-payment-reference]');
  if (balanceValue) balanceValue.textContent = `₹${money(balance)}`;
  if (balanceRow) balanceRow.classList.toggle('is-paid', amount > 0 && balance <= 0.004);
  if (method) method.disabled = amount <= 0;
  if (reference) reference.disabled = amount <= 0;
  if (!hint) return;
  if (amount > Number(totals.total) + 0.009) {
    hint.textContent = `Received amount exceeds the invoice total by ₹${money(amount - Number(totals.total))}.`;
    hint.style.color = 'var(--red)';
  } else if (Number(totals.total) > 0 && amount > 0 && balance <= 0.004) {
    hint.textContent = 'Fully paid at the counter.';
    hint.style.color = 'var(--green)';
  } else if (amount > 0) {
    hint.textContent = `₹${money(balance)} will be recorded as balance due.`;
    hint.style.color = '';
  } else {
    hint.textContent = 'Save the bill as unpaid, or collect payment now.';
    hint.style.color = '';
  }
}

function updateBillActions() {
  const clearButton = pageRoot?.querySelector('[data-action="clear-bill"]');
  if (clearButton) clearButton.disabled = !billIsDirty();
  const create = pageRoot?.querySelector('[data-action="create-invoice"]');
  const createPrint = pageRoot?.querySelector('[data-action="create-print"]');
  if (create) create.disabled = state.items.length === 0;
  if (createPrint) createPrint.disabled = state.items.length === 0;
}

function updateTotals() {
  const totals = computeTotals();
  const areaRow = pageRoot.querySelector('[data-summary-area-row]');
  const discountRow = pageRoot.querySelector('[data-summary-discount-row]');
  const roundRow = pageRoot.querySelector('[data-roundoff-row]');
  const itemsCount = pageRoot.querySelector('[data-summary-items]');
  const areaValue = pageRoot.querySelector('[data-summary-area]');
  const subtotal = pageRoot.querySelector('[data-summary-subtotal]');
  const discount = pageRoot.querySelector('[data-summary-discount]');
  const taxable = pageRoot.querySelector('[data-summary-taxable]');
  const taxLines = pageRoot.querySelector('[data-tax-lines]');
  const roundOff = pageRoot.querySelector('[data-summary-roundoff]');
  const total = pageRoot.querySelector('[data-summary-total]');

  if (itemsCount) itemsCount.textContent = `${state.items.length} ${state.items.length === 1 ? 'item' : 'items'}`;
  if (areaValue) areaValue.textContent = `${qty(totals.areaTotal)} sq ft`;
  if (areaRow) areaRow.classList.toggle('hidden', totals.areaTotal <= 0);
  if (subtotal) subtotal.textContent = `₹${money(totals.subtotal)}`;
  if (discount) discount.textContent = `− ₹${money(totals.discountTotal)}`;
  if (discountRow) discountRow.classList.toggle('hidden', totals.discountTotal <= 0);
  if (taxable) taxable.textContent = `₹${money(totals.taxableTotal)}`;
  if (taxLines) taxLines.innerHTML = summaryTaxLines(totals);
  if (roundOff) {
    roundOff.textContent = `${Number(totals.roundOff) > 0 ? '+' : Number(totals.roundOff) < 0 ? '−' : ''} ₹${money(Math.abs(totals.roundOff))}`;
  }
  if (roundRow) roundRow.classList.toggle('hidden', Math.abs(Number(totals.roundOff)) < 0.005);
  if (total) total.textContent = `₹${money(totals.total)}`;
  const maxAmount = Number(totals.total) > 0 ? Number(totals.total).toFixed(2) : '';
  const amountInput = pageRoot.querySelector('[data-payment-amount]');
  if (amountInput) {
    if (maxAmount) amountInput.setAttribute('max', maxAmount);
    else amountInput.removeAttribute('max');
  }
  const cartMeta = pageRoot.querySelector('[data-cart-meta]');
  if (cartMeta) {
    cartMeta.textContent = `${state.items.length} ${state.items.length === 1 ? 'line' : 'lines'} · ${qty(totals.areaTotal)} sq ft · ${formatBoxes(totals.boxesTotal)}`;
  }
  const cartCount = pageRoot.querySelector('[data-cart-count]');
  if (cartCount) {
    cartCount.textContent = `${state.items.length} ${state.items.length === 1 ? 'line' : 'lines'}`;
  }
  updateRows(totals);
  updatePaymentSummary(totals);
  updateBillActions();
  return totals;
}

function openProductCombo() {
  const input = pageRoot.querySelector('[data-product-search]');
  const menu = pageRoot.querySelector('[data-product-combo]');
  if (!input || !menu) return;
  renderCombo(input.value);
}

function comboMatches(query) {
  const term = String(query || '').trim().toLowerCase();
  const list = state.products.filter((product) => {
    if (!term) return true;
    return [product.name, product.brand, product.sku, product.size, product.category]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });
  return list.slice(0, 8);
}

function comboMarkup() {
  if (!comboResults.length) {
    const query = pageRoot.querySelector('[data-product-search]')?.value?.trim();
    return `<div class="combo-empty">${query ? `No items match “${escapeHtml(query)}”.` : 'No items in the catalogue yet.'}</div>
      <button type="button" class="combo-add" data-action="custom-item">${icon('plus')} Add “${escapeHtml(query || 'custom item')}” as a custom line</button>`;
  }
  const options = comboResults
    .map((product, index) => {
      const low = product.isLowStock || product.stockBoxes <= 0;
      return `
        <div class="combo-option${index === comboIndex ? ' is-active' : ''}" data-product-id="${product.id}">
          ${productSwatch(product)}
          <div class="combo-option-copy">
            <div class="combo-option-title">${escapeHtml(product.name)}</div>
            <div class="combo-option-meta">${[product.brand, product.size, product.category].filter(Boolean).map(escapeHtml).join(' · ')}</div>
          </div>
          <div class="combo-option-side">
            <div class="combo-option-price">₹${money(product.price)} <span class="muted" style="font-weight:400;font-size:9px;">/ ${product.sellUnit === 'sqft' ? 'sq ft' : 'box'}</span></div>
            <div class="combo-option-stock${low ? ' is-low' : ''}">${product.stockBoxes <= 0 ? 'Out of stock' : `${formatBoxes(product.stockBoxes)} in stock`}</div>
          </div>
        </div>
      `;
    })
    .join('');
  return `${options}
    <button type="button" class="combo-add" data-action="custom-item">${icon('plus')} Add a custom item instead</button>`;
}

function renderCombo(query) {
  const input = pageRoot.querySelector('[data-product-search]');
  const menu = pageRoot.querySelector('[data-product-combo]');
  if (!input || !menu) return;
  comboResults = comboMatches(query ?? input.value);
  comboIndex = Math.min(comboIndex, Math.max(comboResults.length - 1, 0));
  comboOpen = true;
  menu.hidden = false;
  menu.innerHTML = comboMarkup();
}

function closeCombo() {
  const menu = pageRoot?.querySelector('[data-product-combo]');
  if (menu) menu.hidden = true;
  comboOpen = false;
  comboIndex = 0;
}

function highlightCombo() {
  const menu = pageRoot.querySelector('[data-product-combo]');
  if (!menu) return;
  menu.querySelectorAll('.combo-option').forEach((option, index) => {
    option.classList.toggle('is-active', index === comboIndex);
  });
  menu.querySelector('.combo-option.is-active')?.scrollIntoView({ block: 'nearest' });
}

function addProduct(product, quantity = null) {
  const unit = product.sellUnit === 'sqft' && product.sqftPerBox > 0 ? 'sqft' : product.sellUnit === 'sqft' ? 'box' : 'box';
  const startingQty = quantity ?? (product.sellUnit === 'sqft' && product.sqftPerBox > 0 ? product.sqftPerBox : 1);
  const existing = state.items.find(
    (item) => item.productId === product.id && item.unit === unit
  );
  let focusedKey;
  if (existing) {
    existing.qty = String(Number((parseNumber(existing.qty) + startingQty).toFixed(3)));
    focusedKey = existing.key;
  } else {
    const item = {
      key: makeKey(),
      productId: product.id,
      isCustom: false,
      name: product.name,
      sku: product.sku,
      size: product.size,
      brand: product.brand,
      hsn: product.hsn,
      unit,
      qty: String(Number(startingQty.toFixed(3))),
      rate: String(product.sellUnit === unit ? product.price : derivedRate(product, unit)),
      discountPct: '',
      gstRate: product.gstRate,
      sqftPerBox: product.sqftPerBox,
      stockBoxes: product.stockBoxes
    };
    state.items.push(item);
    focusedKey = item.key;
  }
  saveDraft();
  closeCombo();
  const input = pageRoot.querySelector('[data-product-search]');
  if (input) input.value = '';
  const totals = computeTotals();
  renderCartArea(totals);
  updateTotals();
  window.requestAnimationFrame(() => {
    const row = pageRoot.querySelector(`[data-line-key="${CSS.escape(focusedKey)}"]`);
    const qtyInput = row?.querySelector('[data-field="qty"]');
    qtyInput?.focus();
    qtyInput?.select?.();
  });
}

function addCustomItem(item) {
  state.items.push({
    key: makeKey(),
    productId: null,
    isCustom: true,
    name: item.name,
    sku: '',
    size: '',
    brand: '',
    hsn: item.hsn,
    unit: item.unit,
    qty: item.qty,
    rate: item.rate,
    discountPct: item.discountPct,
    gstRate: item.gstRate,
    sqftPerBox: item.sqftPerBox,
    stockBoxes: 0
  });
  saveDraft();
  const totals = computeTotals();
  renderCartArea(totals);
  updateTotals();
}

function removeItem(key) {
  state.items = state.items.filter((item) => item.key !== key);
  saveDraft();
  const totals = computeTotals();
  renderCartArea(totals);
  updateTotals();
}

function itemByKey(key) {
  return state.items.find((item) => item.key === key) ?? null;
}

function setPaymentAmount(value) {
  state.amountPaid = value;
  saveDraft();
  const input = pageRoot.querySelector('[data-payment-amount]');
  if (input && input.value !== value) input.value = value;
  updatePaymentSummary(computeTotals());
  updateBillActions();
}

function refreshCustomerPanel() {
  const panel = pageRoot.querySelector('[data-customer-panel]');
  if (!panel) return;
  panel.innerHTML = customerPanelMarkup();
  updateTaxPill();
  updateTotals();
}

function openCustomItemModal(initialName = '') {
  const formId = `custom-item-${Date.now()}`;
  const gstOptions = GST_OPTIONS.map(
    (rate) => `<option value="${rate}"${Number(store.settings.defaultGstRate) === rate ? ' selected' : ''}>${rate}%</option>`
  ).join('');
  const handle = openModal({
    eyebrow: 'Custom line',
    title: 'Add a custom item',
    subtitle: 'Use this for cutting, fitting, delivery or any item not in the catalogue. Custom lines do not change stock.',
    body: `
      <form id="${formId}" novalidate>
        <div class="form-error hidden" data-form-error></div>
        <div class="field-grid" style="margin-top:6px;">
          <div class="field field-full">
            <label for="ci-name">Description *</label>
            <input class="input" id="ci-name" name="name" value="${escapeHtml(initialName)}" placeholder="e.g. Cutting &amp; fitting charges" maxlength="120" data-autofocus required />
          </div>
          <div class="field">
            <label for="ci-hsn">HSN / SAC</label>
            <input class="input" id="ci-hsn" name="hsn" value="" placeholder="Optional" maxlength="20" />
          </div>
          <div class="field">
            <label for="ci-gst">GST rate</label>
            <select class="select" id="ci-gst" name="gstRate">${gstOptions}</select>
          </div>
          <div class="field">
            <label for="ci-unit">Billing unit</label>
            <select class="select" id="ci-unit" name="unit">
              <option value="box">Per box / piece</option>
              <option value="sqft">Per sq ft</option>
            </select>
          </div>
          <div class="field">
            <label for="ci-sqft">Area per unit (sq ft)</label>
            <input class="input" id="ci-sqft" name="sqftPerBox" value="" placeholder="Optional" inputmode="decimal" />
          </div>
          <div class="field">
            <label for="ci-qty">Quantity *</label>
            <input class="input" id="ci-qty" name="qty" value="1" inputmode="decimal" required />
          </div>
          <div class="field">
            <label for="ci-rate">Rate (₹) *</label>
            <div class="input-affix"><span class="affix">₹</span><input class="input" id="ci-rate" name="rate" value="" placeholder="0.00" inputmode="decimal" required /></div>
          </div>
          <div class="field">
            <label for="ci-discount">Discount %</label>
            <input class="input" id="ci-discount" name="discountPct" value="" placeholder="0" inputmode="decimal" />
          </div>
        </div>
      </form>
    `,
    footer: `
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="submit" class="btn btn-primary" form="${formId}" data-save>${icon('plus')} Add to bill</button>
    `,
    onMount(modal, close) {
      const form = modal.querySelector(`#${formId}`);
      modal.querySelector('[data-cancel]').addEventListener('click', close);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        clearFormError(form);
        const data = formDataObject(form);
        if (!String(data.name ?? '').trim()) {
          showFormError(form, 'Description is required.');
          return;
        }
        const quantity = parseNumber(data.qty);
        if (quantity <= 0) {
          showFormError(form, 'Enter a quantity greater than zero.');
          return;
        }
        const rate = parseNumber(data.rate);
        if (!Number.isFinite(rate) || rate < 0) {
          showFormError(form, 'Enter a valid rate.');
          return;
        }
        const discount = parseNumber(data.discountPct);
        if (discount < 0 || discount > 100) {
          showFormError(form, 'Discount must be between 0 and 100.');
          return;
        }
        const unit = data.unit === 'sqft' ? 'sqft' : 'box';
        const sqftPerBox = parseNumber(data.sqftPerBox);
        addCustomItem({
          name: String(data.name).trim(),
          hsn: String(data.hsn ?? '').trim(),
          gstRate: Number(data.gstRate),
          unit,
          sqftPerBox: unit === 'sqft' ? sqftPerBox : Math.max(sqftPerBox, 0),
          qty: String(quantity),
          rate: String(rate),
          discountPct: data.discountPct === '' ? '' : String(discount)
        });
        close();
        const search = pageRoot.querySelector('[data-product-search]');
        search?.focus();
      });
      modal.querySelector('[name="unit"]').addEventListener('change', (event) => {
        const field = modal.querySelector('[name="sqftPerBox"]');
        field.disabled = event.target.value !== 'sqft';
      });
      modal.querySelector('[name="sqftPerBox"]').disabled = true;
    }
  });
  return handle;
}

function openNewCustomer() {
  openCustomerForm({
    defaultState: state.placeOfSupply,
    onSaved: (customer) => {
      state.mode = 'saved';
      state.customerId = customer.id;
      state.placeOfSupply = customer.state || state.placeOfSupply;
      saveDraft();
      ctxRef.rerender();
    }
  });
}

function openEditCustomer() {
  const customer = currentCustomer();
  if (!customer) {
    toast('Choose a customer to edit.', 'info');
    return;
  }
  openCustomerForm({
    customer,
    onSaved: (saved) => {
      state.placeOfSupply = saved.state || state.placeOfSupply;
      saveDraft();
      ctxRef.rerender();
    }
  });
}

function showSuccessModal(invoice) {
  let finished = false;
  const handle = openModal({
    eyebrow: 'Saved',
    title: 'Invoice created',
    subtitle: 'The bill is saved and stock has been updated.',
    size: '',
    body: `
      <div class="success-hero">
        <div class="success-hero-icon">${icon('checkCircle')}</div>
        <h3>${escapeHtml(invoice.invoiceNo)}</h3>
        <p>${escapeHtml(invoice.customerName)} · ${escapeHtml(invoice.placeOfSupply)}</p>
        <div class="success-facts">
          <div>
            <div class="success-fact-label">Invoice total</div>
            <div class="success-fact-value">₹${money(invoice.total)}</div>
          </div>
          <div>
            <div class="success-fact-label">Received</div>
            <div class="success-fact-value">₹${money(invoice.amountPaid)}</div>
          </div>
          <div>
            <div class="success-fact-label">Balance</div>
            <div class="success-fact-value" style="color:${invoice.balance > 0 ? 'var(--red)' : 'var(--green)'};">₹${money(invoice.balance)}</div>
          </div>
        </div>
      </div>
    `,
    footer: `
      <button type="button" class="btn btn-ghost" data-done>New bill</button>
      <button type="button" class="btn" data-print>${icon('printer')} Print A4</button>
      <button type="button" class="btn btn-primary" data-view>View invoice ${icon('arrowRight')}</button>
    `,
    closeOnBackdrop: false,
    onClose() {
      if (!finished) {
        finished = true;
        ctxRef.rerender();
      }
    }
  });
  handle.modal.querySelector('[data-done]').addEventListener('click', () => {
    finished = true;
    handle.close();
    ctxRef.rerender();
  });
  handle.modal.querySelector('[data-print]').addEventListener('click', () => {
    finished = true;
    handle.close();
    navigate(`/invoices/${invoice.id}/print?auto=print`);
  });
  handle.modal.querySelector('[data-view]').addEventListener('click', () => {
    finished = true;
    handle.close();
    navigate(`/invoices/${invoice.id}`);
  });
}

function buildPayload(totals) {
  const paymentAmount = parseNumber(state.amountPaid);
  const payload = {
    invoiceDate: state.invoiceDate,
    dueDate: state.dueDate || undefined,
    placeOfSupply: state.placeOfSupply,
    amountPaid: paymentAmount,
    paymentMethod: state.paymentMethod,
    paymentReference: state.paymentReference,
    notes: state.notes,
    items: state.items.map((item) => ({
      productId: item.productId,
      name: item.name.trim(),
      sku: item.sku,
      hsn: item.hsn,
      gstRate: Number(item.gstRate),
      sqftPerBox: parseNumber(item.sqftPerBox),
      unit: item.unit,
      qty: parseNumber(item.qty),
      rate: parseNumber(item.rate),
      discountPct: parseNumber(item.discountPct)
    }))
  };
  if (state.mode === 'saved') {
    payload.customerId = state.customerId;
  } else {
    payload.customerName = state.walkin.name.trim();
    payload.customerPhone = state.walkin.phone.trim();
    payload.customerGstin = state.walkin.gstin.trim();
    payload.billingAddress = state.walkin.billingAddress.trim();
    payload.customerState = state.placeOfSupply;
  }
  return payload;
}

function validateBill(totals) {
  if (!state.items.length) throw new Error('Add at least one item to the bill.');
  if (state.mode === 'saved' && !state.customerId) {
    throw new Error('Choose a saved customer or switch to Walk-in.');
  }
  for (const [index, item] of state.items.entries()) {
    if (!String(item.name).trim()) throw new Error(`Item name on line ${index + 1} is required.`);
    if (parseNumber(item.qty) <= 0) throw new Error(`Enter a quantity on line ${index + 1}.`);
    if (parseNumber(item.rate) < 0) throw new Error(`Enter a valid rate on line ${index + 1}.`);
    const discount = parseNumber(item.discountPct);
    if (discount < 0 || discount > 100) throw new Error(`Discount on line ${index + 1} must be between 0 and 100.`);
    if (item.productId && item.unit === 'sqft' && parseNumber(item.sqftPerBox) <= 0) {
      throw new Error(`Line ${index + 1} cannot be billed by sq ft because its pack area is missing.`);
    }
    if (item.productId && Number(item.gstRate) < 0) throw new Error(`GST rate on line ${index + 1} is invalid.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.invoiceDate)) throw new Error('Choose an invoice date.');
  const amount = parseNumber(state.amountPaid);
  if (amount < 0) throw new Error('Amount received cannot be negative.');
  if (amount > Number(totals.total) + 0.009) throw new Error('Amount received cannot be more than the invoice total.');
}

async function submitInvoice({ printAfter = false, button }) {
  clearFormError(pageRoot);
  const totals = computeTotals();
  try {
    validateBill(totals);
  } catch (error) {
    showFormError(pageRoot, error.message);
    toast(error.message, 'error');
    return;
  }

  const printButton = pageRoot.querySelector('[data-action="create-print"]');
  const createButton = pageRoot.querySelector('[data-action="create-invoice"]');
  setButtonLoading(button, true, 'Creating…');
  if (button !== createButton) createButton.disabled = true;
  if (button !== printButton) printButton.disabled = true;

  try {
    const invoice = await window.tiledesk.invoices.create(buildPayload(totals));
    state = null;
    clearDraft();
    if (printAfter) {
      toast(`Invoice ${invoice.invoiceNo} created`, 'success');
      navigate(`/invoices/${invoice.id}/print?auto=print`);
      return;
    }
    showSuccessModal(invoice);
  } catch (error) {
    setButtonLoading(button, false);
    if (button !== createButton) createButton.disabled = state?.items.length === 0;
    if (button !== printButton) printButton.disabled = state?.items.length === 0;
    clearFormError(pageRoot);
    showFormError(pageRoot, error.message);
    toast(error.message, 'error');
  }
}

async function startFreshBill({ ask = true } = {}) {
  if (ask && billIsDirty()) {
    const confirmed = await confirmDialog({
      title: 'Start a new bill?',
      message: 'The current bill will be cleared. Saved invoices are not affected.',
      confirmLabel: 'Start new bill',
      cancelLabel: 'Keep this bill'
    });
    if (!confirmed) return;
  }
  state = createInitialState();
  clearDraft();
  ctxRef.rerender();
}

function clearCurrentBill() {
  if (!billIsDirty()) return;
  void startFreshBill({ ask: true });
}

function handlePageClick(event) {
  if (!pageRoot) return;
  const actionElement = event.target.closest('[data-action]');
  if (actionElement) {
    const action = actionElement.dataset.action;
    if (action === 'new-customer') {
      event.preventDefault();
      openNewCustomer();
      return;
    }
    if (action === 'edit-customer') {
      event.preventDefault();
      openEditCustomer();
      return;
    }
    if (action === 'clear-customer') {
      event.preventDefault();
      state.customerId = null;
      saveDraft();
      refreshCustomerPanel();
      return;
    }
    if (action === 'custom-item') {
      event.preventDefault();
      const query = pageRoot.querySelector('[data-product-search]')?.value?.trim() ?? '';
      closeCombo();
      openCustomItemModal(query);
      return;
    }
    if (action === 'pay-full') {
      event.preventDefault();
      const total = computeTotals().total;
      setPaymentAmount(Number(total).toFixed(2));
      return;
    }
    if (action === 'pay-half') {
      event.preventDefault();
      const total = computeTotals().total;
      setPaymentAmount((Number(total) / 2).toFixed(2));
      return;
    }
    if (action === 'pay-none') {
      event.preventDefault();
      setPaymentAmount('');
      return;
    }
    if (action === 'create-invoice') {
      event.preventDefault();
      void submitInvoice({ printAfter: false, button: actionElement });
      return;
    }
    if (action === 'create-print') {
      event.preventDefault();
      void submitInvoice({ printAfter: true, button: actionElement });
      return;
    }
    if (action === 'clear-bill') {
      event.preventDefault();
      clearCurrentBill();
      return;
    }
  }

  const modeButton = event.target.closest('[data-customer-mode]');
  if (modeButton) {
    const mode = modeButton.dataset.customerMode;
    if (mode !== state.mode) {
      state.mode = mode;
      if (mode === 'saved' && state.customerId) {
        const customer = currentCustomer();
        if (customer?.state) state.placeOfSupply = customer.state;
      }
      saveDraft();
      pageRoot.querySelectorAll('[data-customer-mode]').forEach((button) => {
        button.classList.toggle('active', button.dataset.customerMode === mode);
      });
      refreshCustomerPanel();
    }
    return;
  }

  const option = event.target.closest('[data-product-id]');
  if (option) {
    const product = state.products.find((entry) => entry.id === Number(option.dataset.productId));
    if (product) addProduct(product);
    return;
  }

  const removeButton = event.target.closest('[data-remove-line]');
  if (removeButton) {
    removeItem(removeButton.dataset.removeLine);
    return;
  }

  if (!event.target.closest('.product-finder')) {
    closeCombo();
  }
}

function handlePageInput(event) {
  const target = event.target;
  if (target.matches('[data-product-search]')) {
    comboIndex = 0;
    renderCombo(target.value);
    return;
  }
  if (target.matches('[data-walkin]')) {
    const field = target.dataset.walkin;
    state.walkin[field] = field === 'gstin' ? target.value.toUpperCase() : target.value;
    if (field === 'gstin') target.value = state.walkin[field];
    saveDraft();
    updateBillActions();
    const hint = pageRoot.querySelector('.customer-hint');
    if (hint && field === 'gstin') {
      hint.textContent = state.walkin.gstin
        ? 'This will be recorded as a B2B invoice.'
        : 'Selling to a business with a GSTIN? Add it so they can claim input tax credit.';
    }
    return;
  }
  if (target.matches('[data-field="qty"], [data-field="rate"], [data-field="discountPct"]')) {
    const item = itemByKey(target.dataset.key);
    if (!item) return;
    const field = target.dataset.field;
    item[field] = target.value;
    saveDraft();
    updateTotals();
    return;
  }
  if (target.matches('[data-notes]')) {
    state.notes = target.value;
    saveDraft();
    updateBillActions();
    return;
  }
  if (target.matches('[data-payment-amount]')) {
    state.amountPaid = target.value;
    saveDraft();
    updatePaymentSummary(computeTotals());
    updateBillActions();
    return;
  }
  if (target.matches('[data-payment-reference]')) {
    state.paymentReference = target.value;
    saveDraft();
  }
}

function handlePageChange(event) {
  const target = event.target;
  if (target.matches('[data-field="unit"]')) {
    const item = itemByKey(target.dataset.key);
    if (!item) return;
    item.unit = target.value === 'box' ? 'box' : 'sqft';
    if (item.productId) {
      const product = productFor(item);
      if (product) item.rate = String(derivedRate(product, item.unit));
    }
    saveDraft();
    const totals = computeTotals();
    renderCartArea(totals);
    updateTotals();
    return;
  }
  if (target.matches('[data-place-of-supply]')) {
    state.placeOfSupply = target.value;
    saveDraft();
    updateTaxPill();
    updateTotals();
    pageRoot.querySelectorAll('[data-place-of-supply]').forEach((select) => {
      if (select !== target) select.value = state.placeOfSupply;
    });
    return;
  }
  if (target.matches('[data-customer-select]')) {
    state.customerId = target.value ? Number(target.value) : null;
    const customer = currentCustomer();
    if (customer?.state) state.placeOfSupply = customer.state;
    saveDraft();
    refreshCustomerPanel();
    return;
  }
  if (target.matches('[data-payment-method]')) {
    state.paymentMethod = target.value;
    saveDraft();
    return;
  }
  if (target.matches('[data-invoice-date]')) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target.value)) {
      target.value = state.invoiceDate;
      return;
    }
    state.invoiceDate = target.value;
    if (!state.dueTouched) {
      state.dueDate = addDaysISO(state.invoiceDate, Number(store.settings.dueDays) || 0);
      const dueInput = pageRoot.querySelector('[data-due-date]');
      if (dueInput) {
        dueInput.value = state.dueDate;
        dueInput.min = state.invoiceDate;
      }
    }
    const dueInput = pageRoot.querySelector('[data-due-date]');
    if (dueInput) dueInput.min = state.invoiceDate;
    saveDraft();
    return;
  }
  if (target.matches('[data-due-date]')) {
    state.dueDate = target.value;
    state.dueTouched = true;
    saveDraft();
  }
}

function handlePageKeyDown(event) {
  const target = event.target;
  if (!target.matches('[data-product-search]')) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!comboOpen) renderCombo(target.value);
    if (comboResults.length) {
      comboIndex = (comboIndex + 1) % comboResults.length;
      highlightCombo();
    }
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (!comboOpen) renderCombo(target.value);
    if (comboResults.length) {
      comboIndex = (comboIndex - 1 + comboResults.length) % comboResults.length;
      highlightCombo();
    }
    return;
  }
  if (event.key === 'Escape') {
    closeCombo();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    if (!comboOpen) renderCombo(target.value);
    const product = comboResults[comboIndex] ?? comboResults[0];
    if (product) addProduct(product);
    else if (target.value.trim()) {
      const name = target.value.trim();
      closeCombo();
      openCustomItemModal(name);
    }
  }
}

function bindEvents(controller) {
  const options = { signal: controller.signal };
  pageRoot.addEventListener('click', handlePageClick, options);
  pageRoot.addEventListener('input', handlePageInput, options);
  pageRoot.addEventListener('change', handlePageChange, options);
  pageRoot.addEventListener('keydown', handlePageKeyDown, options);
  window.addEventListener(
    'tiledesk:new-bill',
    () => {
      void startFreshBill({ ask: true });
    },
    options
  );
}

export async function render(root, ctx) {
  ctxRef = ctx;
  if (!state) {
    state = createInitialState();
    hydrateDraft();
  }
  await loadReferences();

  if (pageAbort) pageAbort.abort();
  pageAbort = new AbortController();

  root.innerHTML = `
    <div class="page billing-page" data-testid="billing-page">
      ${pageHead({
        eyebrow: 'Counter · GST invoice',
        title: 'New bill',
        subtitle: 'Search the catalogue, check the tax split, and collect payment at the counter.',
        actions: `
          <span class="next-invoice-pill">Next invoice <strong>${escapeHtml(state.nextInvoice || '—')}</strong></span>
          <button type="button" class="btn" data-action="clear-bill" disabled>${icon('refresh')} Clear</button>
        `
      })}

      <div class="billing-layout">
        <div class="billing-main">
          <section class="card">
            <div class="card-head">
              <div>
                <h2 class="card-title">Customer</h2>
                <div class="card-sub" data-customer-meta>${escapeHtml(customerMetaText())}</div>
              </div>
              <div class="row wrap" style="justify-content:flex-end;">
                <span class="tax-pill${isIntraState() ? '' : ' inter'}" data-tax-pill>${taxPillMarkup()}</span>
                <button type="button" class="btn btn-sm btn-ghost" data-action="new-customer">${icon('userPlus')} New customer</button>
              </div>
            </div>
            <div class="customer-pane">
              <div class="customer-tabs">
                <div class="segmented">
                  <button type="button" data-customer-mode="walkin" class="${state.mode === 'walkin' ? 'active' : ''}">Walk-in</button>
                  <button type="button" data-customer-mode="saved" class="${state.mode === 'saved' ? 'active' : ''}">Saved customer</button>
                </div>
              </div>
              <div data-customer-panel style="margin-top:14px;">${customerPanelMarkup()}</div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div>
                <h2 class="card-title">Items on this bill</h2>
                <div class="card-sub">Rates are per the selling unit; stock is kept in boxes.</div>
              </div>
              <span class="chip chip-neutral" data-cart-count>${state.items.length} ${state.items.length === 1 ? 'line' : 'lines'}</span>
            </div>
            <div class="product-finder">
              <div class="search-field">
                ${icon('search')}
                <input class="input" id="product-search" data-product-search placeholder="Search tile, brand, size or item code…" autocomplete="off" spellcheck="false" data-testid="product-search" />
              </div>
              <div class="product-finder-hint">${icon('sparkle')} Type to search · press Enter to add the first match</div>
              <div class="combo-menu" data-product-combo hidden></div>
            </div>
            <div class="cart-wrap" data-cart-area></div>
          </section>

          <section class="card">
            <div class="card-head">
              <div>
                <h2 class="card-title">Bill note</h2>
                <div class="card-sub">Optional note printed beneath the invoice items.</div>
              </div>
              ${icon('note')}
            </div>
            <div class="card-pad" style="padding-top:0;">
              <textarea class="textarea" data-notes maxlength="2000" placeholder="Delivery instructions, site reference, shade matching note…">${escapeHtml(state.notes)}</textarea>
            </div>
          </section>
        </div>

        <aside class="billing-summary">
          ${summaryMarkup()}
        </aside>
      </div>
    </div>
  `;

  pageRoot = root.querySelector('.billing-page');
  bindEvents(pageAbort);

  const totals = computeTotals();
  const cartContainer = pageRoot.querySelector('[data-cart-area]');
  cartContainer.innerHTML = cartMarkup(totals);
  updateTotals();
}

export function cleanup() {
  if (pageAbort) {
    pageAbort.abort();
    pageAbort = null;
  }
  pageRoot = null;
  comboOpen = false;
  comboResults = [];
  comboIndex = 0;
}

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

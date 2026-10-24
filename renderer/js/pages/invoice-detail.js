import { PAYMENT_METHODS } from '../../../shared/calc.js';
import { todayISO } from '../../../shared/format.js';
import { icon } from '../icons.js';
import { renderInvoiceDocument } from '../invoice-document.js';
import { navigate } from '../router.js';
import {
  clearFormError,
  confirmDialog,
  dateText,
  emptyState,
  escapeHtml,
  formDataObject,
  invoiceStatusChip,
  money,
  openModal,
  pageHead,
  parseNumber,
  qty,
  setButtonLoading,
  showFormError,
  toast
} from '../ui.js';

let pageAbort = null;

function areaTotal(invoice) {
  return (invoice.items ?? []).reduce((sum, item) => sum + (Number(item.areaSqft) || 0), 0);
}

function paymentRows(invoice) {
  if (!invoice.payments.length) {
    return `<div class="payment-empty">No payments recorded yet.</div>`;
  }
  return invoice.payments
    .map(
      (payment) => `
        <div class="payment-row">
          <span class="payment-row-icon">${icon('checkCircle')}</span>
          <div class="payment-row-copy">
            <div class="payment-row-title">${escapeHtml(payment.method)}${payment.reference ? ` · ${escapeHtml(payment.reference)}` : ''}</div>
            <div class="payment-row-meta">${dateText(payment.paymentDate)}${payment.notes ? ` · ${escapeHtml(payment.notes)}` : ''}</div>
          </div>
          <div class="payment-row-amount">₹${money(payment.amount)}</div>
          ${invoice.status === 'active'
            ? `<button type="button" class="btn btn-icon" data-delete-payment="${payment.id}" title="Delete payment" aria-label="Delete payment of ₹${money(payment.amount)}">${icon('trash')}</button>`
            : ''}
        </div>
      `
    )
    .join('');
}

function metaRows(invoice) {
  const area = areaTotal(invoice);
  const rows = [
    ['Customer', invoice.customerName],
    invoice.customerPhone ? ['Phone', invoice.customerPhone] : null,
    invoice.customerGstin ? ['Customer GSTIN', `<span class="mono">${escapeHtml(invoice.customerGstin)}</span>`] : null,
    ['Place of supply', `${escapeHtml(invoice.placeOfSupply)} (${escapeHtml(invoice.stateCode)})`],
    ['Tax type', invoice.isInterState ? 'IGST · Inter-state' : 'CGST + SGST · Intra-state'],
    ['Items', `${invoice.itemCount} ${invoice.itemCount === 1 ? 'line' : 'lines'}${area > 0 ? ` · ${qty(area)} sq ft` : ''}`],
    ['Invoice date', dateText(invoice.invoiceDate)],
    ['Due date', dateText(invoice.dueDate)],
    ['Recorded', invoice.createdAt ? new Date(invoice.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—']
  ].filter(Boolean);

  return rows
    .map(([label, value]) => `<div class="meta-row"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`)
    .join('');
}

function voidBanner(invoice) {
  if (invoice.status !== 'void') return '';
  return `
    <div class="void-banner">
      ${icon('xCircle')}
      <div>
        <strong>Cancelled${invoice.voidedAt ? ` on ${dateText(invoice.voidedAt)}` : ''}</strong>
        ${escapeHtml(invoice.voidReason || 'This invoice has been cancelled.')}
        Stock from tracked items has been returned to the catalogue.
      </div>
    </div>
  `;
}

function paymentCard(invoice) {
  if (invoice.status === 'void') {
    return `
      <section class="card payment-hero">
        <div class="payment-hero-label">Payment status</div>
        <div class="payment-hero-value is-settled">Cancelled</div>
        <p class="muted small mt-8" style="margin-bottom:0;">Payments cannot be recorded against a cancelled invoice.</p>
      </section>
    `;
  }

  const settled = invoice.balance <= 0.004;
  const percentage = invoice.total > 0 ? Math.min(100, Math.max(0, (invoice.amountPaid / invoice.total) * 100)) : 100;
  return `
    <section class="card payment-hero">
      <div class="row-between" style="align-items:flex-start;">
        <div>
          <div class="payment-hero-label">${settled ? 'Paid in full' : 'Balance due'}</div>
          <div class="payment-hero-value${settled ? ' is-settled' : ''}">${settled ? 'Settled' : `₹${money(invoice.balance)}`}</div>
        </div>
        ${invoiceStatusChip(invoice)}
      </div>
      <div class="payment-progress"><span style="width:${percentage.toFixed(1)}%;"></span></div>
      <div class="payment-breakdown">
        <span>Received ₹${money(invoice.amountPaid)}</span>
        <span>Invoice ₹${money(invoice.total)}</span>
      </div>
      ${settled
        ? `<p class="muted small mt-12" style="margin-bottom:0;">This invoice has been collected in full.</p>`
        : `<button type="button" class="btn btn-primary btn-block mt-16" data-action="add-payment">${icon('plus')} Record a payment</button>`}
    </section>
  `;
}

function invoiceBody(invoice, settings) {
  return `
    <div class="page">
      ${pageHead({
        back: { href: '/invoices', label: 'All invoices' },
        eyebrow: `Tax invoice · ${dateText(invoice.invoiceDate)}`,
        title: invoice.invoiceNo,
        subtitle: `${escapeHtml(invoice.customerName)} · ${invoice.itemCount} ${invoice.itemCount === 1 ? 'line' : 'lines'} · <strong>₹${money(invoice.total)}</strong>`,
        actions: `
          <button type="button" class="btn" data-action="save-pdf">${icon('download')} Save PDF</button>
          <button type="button" class="btn btn-primary" data-action="open-print">${icon('printer')} Print A4</button>
        `
      })}

      ${voidBanner(invoice)}

      <div class="detail-layout">
        <div>
          <div class="card" style="padding:0;overflow:hidden;">
            ${renderInvoiceDocument(invoice, settings)}
            <div class="doc-actions">
              <span>${invoice.status === 'void' ? 'Cancelled document' : 'Computer-generated tax invoice'}</span>
              <span>${escapeHtml(invoice.placeOfSupply)} · ${invoice.itemCount} ${invoice.itemCount === 1 ? 'line' : 'lines'}</span>
            </div>
          </div>
        </div>

        <aside class="detail-side">
          ${paymentCard(invoice)}

          <section class="card">
            <div class="card-head">
              <div>
                <h2 class="card-title">Payments</h2>
                <div class="card-sub">${invoice.payments.length} ${invoice.payments.length === 1 ? 'entry' : 'entries'} recorded</div>
              </div>
              ${icon('wallet')}
            </div>
            <div class="payment-history">${paymentRows(invoice)}</div>
          </section>

          <section class="card">
            <div class="card-head">
              <div>
                <h2 class="card-title">Details</h2>
                <div class="card-sub">Tax, customer and document information</div>
              </div>
            </div>
            <dl class="meta-card">${metaRows(invoice)}</dl>
            <div class="row wrap" style="padding:2px 19px 16px;gap:8px;">
              ${invoice.status === 'active'
                ? `<button type="button" class="btn btn-sm btn-danger-soft" data-action="void-invoice">${icon('xCircle')} Cancel this invoice</button>`
                : ''}
              <button type="button" class="btn btn-sm btn-danger-soft" data-action="delete-invoice">${icon('trash')} Delete bill</button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  `;
}

function openPaymentModal(invoice, ctx) {
  const formId = `payment-form-${Date.now()}`;
  openModal({
    eyebrow: 'Receipt',
    title: 'Record a payment',
    subtitle: `${invoice.invoiceNo} · balance ₹${money(invoice.balance)}`,
    body: `
      <form id="${formId}" novalidate>
        <div class="form-error hidden" data-form-error></div>
        <div class="field-grid" style="margin-top:6px;">
          <div class="field">
            <label for="pm-amount">Amount received *</label>
            <div class="input-affix">
              <span class="affix">₹</span>
              <input class="input" id="pm-amount" name="amount" value="${invoice.balance.toFixed(2)}" inputmode="decimal" data-autofocus required />
            </div>
          </div>
          <div class="field">
            <label for="pm-date">Payment date</label>
            <input class="input" id="pm-date" name="paymentDate" type="date" value="${todayISO()}" />
          </div>
          <div class="field">
            <label for="pm-method">Method</label>
            <select class="select" id="pm-method" name="method">
              ${PAYMENT_METHODS.map((method) => `<option value="${method}">${method}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="pm-reference">Reference <span class="optional">optional</span></label>
            <input class="input" id="pm-reference" name="reference" placeholder="Cheque no, UPI ref" maxlength="100" />
          </div>
          <div class="field field-full">
            <label for="pm-notes">Notes <span class="optional">optional</span></label>
            <input class="input" id="pm-notes" name="notes" placeholder="Received by, bank, remarks" maxlength="500" />
          </div>
        </div>
        <p class="hint" style="margin-top:12px;">The balance and payment status of this invoice update automatically.</p>
      </form>
    `,
    footer: `
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="submit" class="btn btn-primary" form="${formId}" data-save>Record payment</button>
    `,
    onMount(modal, close) {
      const form = modal.querySelector(`#${formId}`);
      const saveButton = modal.querySelector('[data-save]');
      modal.querySelector('[data-cancel]').addEventListener('click', close);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFormError(form);
        const data = formDataObject(form);
        const amount = parseNumber(data.amount);
        if (amount <= 0) {
          showFormError(form, 'Enter a payment amount greater than zero.');
          form.querySelector('[name="amount"]').focus();
          return;
        }
        if (amount > invoice.balance + 0.009) {
          showFormError(form, `Payment cannot be more than the balance of ₹${money(invoice.balance)}.`);
          return;
        }
        setButtonLoading(saveButton, true, 'Recording…');
        try {
          await window.tiledesk.invoices.addPayment(invoice.id, {
            amount,
            paymentDate: data.paymentDate,
            method: data.method,
            reference: data.reference,
            notes: data.notes
          });
          close();
          toast('Payment recorded', 'success');
          ctx.rerender();
        } catch (error) {
          setButtonLoading(saveButton, false);
          showFormError(form, error.message);
        }
      });
    }
  });
}

function openVoidModal(invoice, ctx) {
  const formId = `void-form-${Date.now()}`;
  openModal({
    eyebrow: 'Cancellation',
    title: `Cancel ${invoice.invoiceNo}?`,
    subtitle: 'The invoice stays in your records marked as cancelled.',
    body: `
      <div class="modal-icon danger">${icon('alert')}</div>
      <p class="muted" style="margin:0 0 14px;font-size:12px;line-height:1.6;">
        This cannot be undone. Stock for every tracked item on this bill is returned to the catalogue and the invoice will print with a cancelled watermark.
      </p>
      <form id="${formId}" novalidate>
        <div class="form-error hidden" data-form-error></div>
        <div class="field">
          <label for="vd-reason">Reason for cancellation</label>
          <input class="input" id="vd-reason" name="reason" placeholder="Wrong customer, duplicate bill, goods returned…" maxlength="300" data-autofocus />
        </div>
      </form>
    `,
    footer: `
      <button type="button" class="btn" data-cancel>Keep invoice</button>
      <button type="submit" class="btn btn-danger" form="${formId}" data-save>Cancel invoice</button>
    `,
    onMount(modal, close) {
      const form = modal.querySelector(`#${formId}`);
      const saveButton = modal.querySelector('[data-save]');
      modal.querySelector('[data-cancel]').addEventListener('click', close);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFormError(form);
        const data = formDataObject(form);
        setButtonLoading(saveButton, true, 'Cancelling…');
        try {
          await window.tiledesk.invoices.void(invoice.id, data.reason);
          close();
          toast('Invoice cancelled and stock restored', 'success');
          ctx.rerender();
        } catch (error) {
          setButtonLoading(saveButton, false);
          showFormError(form, error.message);
        }
      });
    }
  });
}

function openDeleteModal(invoice) {
  const formId = `delete-form-${Date.now()}`;
  const paymentNote =
    invoice.payments.length === 0
      ? 'No payment entries are attached to it.'
      : invoice.payments.length === 1
        ? 'Its one payment entry will be erased too.'
        : `Its ${invoice.payments.length} payment entries will be erased too.`;
  openModal({
    eyebrow: 'Permanent deletion',
    title: `Delete ${invoice.invoiceNo}?`,
    subtitle: 'This removes the bill from your records for good.',
    body: `
      <div class="modal-icon danger">${icon('alert')}</div>
      <p class="muted" style="margin:0 0 14px;font-size:12px;line-height:1.6;">
        The bill and its line items will be erased. ${paymentNote}
        ${invoice.status === 'active' ? 'Stock for every tracked item on this bill is returned to the catalogue.' : 'Stock was already returned when this bill was cancelled.'}
        The invoice number <strong>${escapeHtml(invoice.invoiceNo)}</strong> is kept reserved and will never be reused.
      </p>
      <form id="${formId}" novalidate>
        <div class="form-error hidden" data-form-error></div>
        <div class="field">
          <label for="del-confirm">Type <span class="mono">${escapeHtml(invoice.invoiceNo)}</span> to confirm</label>
          <input class="input" id="del-confirm" name="confirm" placeholder="${escapeHtml(invoice.invoiceNo)}" autocomplete="off" spellcheck="false" data-autofocus />
        </div>
      </form>
    `,
    footer: `
      <button type="button" class="btn" data-cancel>Keep invoice</button>
      <button type="submit" class="btn btn-danger" form="${formId}" data-save>Delete permanently</button>
    `,
    onMount(modal, close) {
      const form = modal.querySelector(`#${formId}`);
      const saveButton = modal.querySelector('[data-save]');
      modal.querySelector('[data-cancel]').addEventListener('click', close);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFormError(form);
        const typed = formDataObject(form).confirm.trim();
        if (typed.toUpperCase() !== invoice.invoiceNo.toUpperCase()) {
          showFormError(form, `Type ${invoice.invoiceNo} exactly to confirm.`);
          form.querySelector('[name="confirm"]').focus();
          return;
        }
        setButtonLoading(saveButton, true, 'Deleting…');
        try {
          await window.tiledesk.invoices.deleteInvoice(invoice.id);
          close();
          toast(`${invoice.invoiceNo} deleted. The invoice number will not be reused.`, 'success');
          navigate('/invoices');
        } catch (error) {
          setButtonLoading(saveButton, false);
          showFormError(form, error.message);
        }
      });
    }
  });
}

async function deletePayment(invoice, paymentId, ctx) {
  const payment = invoice.payments.find((entry) => entry.id === Number(paymentId));
  if (!payment) return;
  const confirmed = await confirmDialog({
    title: 'Delete this payment?',
    message: `The ${payment.method} payment of ₹${money(payment.amount)} on ${dateText(payment.paymentDate)} will be removed and the invoice balance recalculated.`,
    confirmLabel: 'Delete payment',
    danger: true
  });
  if (!confirmed) return;
  try {
    await window.tiledesk.invoices.deletePayment(payment.id);
    toast('Payment deleted', 'success');
    ctx.rerender();
  } catch (error) {
    toast(error.message, 'error');
  }
}

export async function render(root, ctx) {
  if (pageAbort) pageAbort.abort();
  pageAbort = new AbortController();

  let invoice;
  try {
    invoice = await window.tiledesk.invoices.get(Number(ctx.params.id));
  } catch (error) {
    root.innerHTML = `
      <div class="page">
        ${pageHead({
          back: { href: '/invoices', label: 'All invoices' },
          eyebrow: 'Invoice',
          title: 'Invoice not found',
          subtitle: 'This bill may have been removed or the link is out of date.'
        })}
        <div class="card">
          ${emptyState({
            iconName: 'alert',
            title: 'This invoice could not be opened',
            text: error.message,
            action: '<button type="button" class="btn btn-primary" data-nav="/invoices">Back to invoices</button>'
          })}
        </div>
      </div>
    `;
    return;
  }

  root.innerHTML = invoiceBody(invoice, ctx.settings);

  root.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('[data-action="open-print"]')) {
        navigate(`/invoices/${invoice.id}/print`);
        return;
      }
      if (event.target.closest('[data-action="save-pdf"]')) {
        navigate(`/invoices/${invoice.id}/print?auto=pdf`);
        return;
      }
      if (event.target.closest('[data-action="add-payment"]')) {
        openPaymentModal(invoice, ctx);
        return;
      }
      if (event.target.closest('[data-action="void-invoice"]')) {
        openVoidModal(invoice, ctx);
        return;
      }
      if (event.target.closest('[data-action="delete-invoice"]')) {
        openDeleteModal(invoice);
        return;
      }
      const deleteButton = event.target.closest('[data-delete-payment]');
      if (deleteButton) {
        void deletePayment(invoice, deleteButton.dataset.deletePayment, ctx);
      }
    },
    { signal: pageAbort.signal }
  );
}

export function cleanup() {
  if (pageAbort) {
    pageAbort.abort();
    pageAbort = null;
  }
}

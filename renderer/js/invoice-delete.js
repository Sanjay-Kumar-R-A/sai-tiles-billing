import { icon } from './icons.js';
import {
  clearFormError,
  escapeHtml,
  formDataObject,
  openModal,
  setButtonLoading,
  showFormError,
  toast
} from './ui.js';

export function openInvoiceDeleteModal(invoice, { onDeleted } = {}) {
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
          onDeleted?.();
        } catch (error) {
          setButtonLoading(saveButton, false);
          showFormError(form, error.message);
        }
      });
    }
  });
}

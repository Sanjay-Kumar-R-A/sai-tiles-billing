import { CUSTOMER_TYPES } from '../../shared/constants.js';
import { INDIAN_STATES } from '../../shared/states.js';
import {
  clearFormError,
  escapeHtml,
  formDataObject,
  openModal,
  setButtonLoading,
  showFormError,
  toast
} from './ui.js';

export function openCustomerForm({ customer = null, defaultState = 'Tamil Nadu', onSaved } = {}) {
  const editing = Boolean(customer?.id);
  const formId = `customer-form-${Date.now()}`;
  const stateOptions = INDIAN_STATES.map(
    (state) =>
      `<option value="${escapeHtml(state.name)}"${(customer?.state ?? defaultState) === state.name ? ' selected' : ''}>${escapeHtml(state.name)}</option>`
  ).join('');
  const typeOptions = CUSTOMER_TYPES.map(
    (type) => `<option value="${escapeHtml(type)}"${(customer?.type ?? 'Retail') === type ? ' selected' : ''}>${escapeHtml(type)}</option>`
  ).join('');

  openModal({
    eyebrow: editing ? 'Customer record' : 'New customer',
    title: editing ? 'Edit customer' : 'Add a customer',
    subtitle: editing
      ? 'Changes apply to future bills. Issued invoices keep their original details.'
      : 'A saved customer keeps their GSTIN and address ready for future invoices.',
    size: 'modal-lg',
    body: `
      <form id="${formId}" novalidate>
        <div class="form-error hidden" data-form-error></div>
        <div class="field-grid" style="margin-top:6px;">
          <div class="field field-full">
            <label for="cf-name">Customer name *</label>
            <input class="input" id="cf-name" name="name" value="${escapeHtml(customer?.name ?? '')}" placeholder="e.g. Arun Kumar / Sree Builders" maxlength="120" data-autofocus required />
          </div>
          <div class="field">
            <label for="cf-phone">Phone</label>
            <input class="input" id="cf-phone" name="phone" value="${escapeHtml(customer?.phone ?? '')}" placeholder="Mobile number" maxlength="30" inputmode="tel" />
          </div>
          <div class="field">
            <label for="cf-type">Customer type</label>
            <select class="select" id="cf-type" name="type">${typeOptions}</select>
          </div>
          <div class="field">
            <label for="cf-email">Email <span class="optional">optional</span></label>
            <input class="input" id="cf-email" name="email" value="${escapeHtml(customer?.email ?? '')}" placeholder="name@example.com" maxlength="120" inputmode="email" />
          </div>
          <div class="field">
            <label for="cf-gstin">GSTIN <span class="optional">for B2B</span></label>
            <input class="input" id="cf-gstin" name="gstin" value="${escapeHtml(customer?.gstin ?? '')}" placeholder="33ABCDE1234F1Z5" maxlength="15" autocomplete="off" spellcheck="false" style="text-transform:uppercase;" />
          </div>
          <div class="field field-full">
            <label for="cf-address">Billing address</label>
            <textarea class="textarea" id="cf-address" name="address" placeholder="Door no., street, area" maxlength="300">${escapeHtml(customer?.address ?? '')}</textarea>
          </div>
          <div class="field">
            <label for="cf-city">City / town</label>
            <input class="input" id="cf-city" name="city" value="${escapeHtml(customer?.city ?? '')}" placeholder="City" maxlength="80" />
          </div>
          <div class="field">
            <label for="cf-pincode">Pincode</label>
            <input class="input" id="cf-pincode" name="pincode" value="${escapeHtml(customer?.pincode ?? '')}" placeholder="600001" maxlength="10" inputmode="numeric" />
          </div>
          <div class="field">
            <label for="cf-state">State</label>
            <select class="select" id="cf-state" name="state">${stateOptions}</select>
          </div>
          <div class="field">
            <label for="cf-notes">Notes <span class="optional">optional</span></label>
            <input class="input" id="cf-notes" name="notes" value="${escapeHtml(customer?.notes ?? '')}" placeholder="Site, reference or credit note" maxlength="500" />
          </div>
        </div>
        <p class="hint" style="margin-top:12px;">GSTIN is needed only when the customer claims input tax credit. The place of supply is picked from this address when billing.</p>
      </form>
    `,
    footer: `
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="submit" class="btn btn-primary" form="${formId}" data-save>${editing ? 'Save customer' : 'Add customer'}</button>
    `,
    onMount(modal, close) {
      const form = modal.querySelector(`#${formId}`);
      const saveButton = modal.querySelector('[data-save]');
      modal.querySelector('[data-cancel]').addEventListener('click', close);
      modal.querySelector('#cf-gstin').addEventListener('input', (event) => {
        event.target.value = event.target.value.toUpperCase();
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFormError(form);
        const data = formDataObject(form);
        if (!String(data.name ?? '').trim()) {
          showFormError(form, 'Customer name is required.');
          form.querySelector('[name="name"]').focus();
          return;
        }
        setButtonLoading(saveButton, true, editing ? 'Saving…' : 'Adding…');
        try {
          const saved = editing
            ? await window.tiledesk.customers.update(customer.id, data)
            : await window.tiledesk.customers.create(data);
          close();
          toast(editing ? 'Customer updated' : 'Customer added', 'success');
          onSaved?.(saved);
        } catch (error) {
          setButtonLoading(saveButton, false);
          showFormError(form, error.message);
        }
      });
    }
  });
}

import { GST_RATES } from '../../shared/calc.js';
import { todayISO } from '../../shared/format.js';
import { store } from './store.js';
import {
  clearFormError,
  confirmDialog,
  escapeHtml,
  formDataObject,
  money,
  openModal,
  parseNumber,
  qty,
  setButtonLoading,
  showFormError,
  toast
} from './ui.js';

function categoryOptions(selected) {
  const categories = [...new Set([...(store.categories ?? []), selected].filter(Boolean))];
  return categories
    .map((category) => `<option value="${escapeHtml(category)}"${category === selected ? ' selected' : ''}>${escapeHtml(category)}</option>`)
    .join('');
}

export function openProductForm({ product = null, onSaved } = {}) {
  const editing = Boolean(product?.id);
  const formId = `product-form-${Date.now()}`;
  const unit = product?.sellUnit ?? 'sqft';
  const gstOptions = GST_RATES.map(
    (rate) => `<option value="${rate}"${Number(product?.gstRate ?? store.settings?.defaultGstRate ?? 18) === rate ? ' selected' : ''}>${rate}%</option>`
  ).join('');

  openModal({
    eyebrow: editing ? 'Catalogue item' : 'New catalogue item',
    title: editing ? 'Edit item' : 'Add a tile or material',
    subtitle: 'Stock is tracked in boxes. Pack area converts your selling rate between sq ft and boxes.',
    size: 'modal-lg',
    body: `
      <form id="${formId}" novalidate>
        <div class="form-error hidden" data-form-error></div>
        <div class="field-grid-3" style="margin-top:6px;">
          <div class="field" style="grid-column:span 2;">
            <label for="pf-name">Item name *</label>
            <input class="input" id="pf-name" name="name" value="${escapeHtml(product?.name ?? '')}" placeholder="e.g. Aspen Grey Matt" maxlength="120" data-autofocus required />
          </div>
          <div class="field">
            <label for="pf-sku">Item code</label>
            <input class="input" id="pf-sku" name="sku" value="${escapeHtml(product?.sku ?? '')}" placeholder="ASP-GRY-600" maxlength="40" spellcheck="false" />
          </div>
          <div class="field">
            <label for="pf-brand">Brand</label>
            <input class="input" id="pf-brand" name="brand" value="${escapeHtml(product?.brand ?? '')}" placeholder="Brand" maxlength="60" />
          </div>
          <div class="field">
            <label for="pf-category">Category</label>
            <select class="select" id="pf-category" name="category">${categoryOptions(product?.category ?? 'Floor Tile')}</select>
          </div>
          <div class="field">
            <label for="pf-size">Size</label>
            <input class="input" id="pf-size" name="size" value="${escapeHtml(product?.size ?? '')}" placeholder="600 × 600 mm" maxlength="40" />
          </div>
          <div class="field">
            <label for="pf-finish">Finish</label>
            <input class="input" id="pf-finish" name="finish" value="${escapeHtml(product?.finish ?? '')}" placeholder="Matt / Glossy / Rustic" maxlength="40" />
          </div>
          <div class="field">
            <label for="pf-hsn">HSN code</label>
            <input class="input" id="pf-hsn" name="hsn" value="${escapeHtml(product?.hsn ?? '6907')}" placeholder="6907" maxlength="20" />
          </div>
          <div class="field">
            <label for="pf-gst">GST rate</label>
            <select class="select" id="pf-gst" name="gstRate">${gstOptions}</select>
          </div>
          <div class="field">
            <label for="pf-unit">Selling unit</label>
            <select class="select" id="pf-unit" name="sellUnit">
              <option value="sqft"${unit === 'sqft' ? ' selected' : ''}>Per sq ft</option>
              <option value="box"${unit === 'box' ? ' selected' : ''}>Per box</option>
            </select>
          </div>
          <div class="field">
            <label for="pf-price" data-price-label>Selling rate (₹ per sq ft) *</label>
            <div class="input-affix">
              <span class="affix">₹</span>
              <input class="input" id="pf-price" name="price" value="${escapeHtml(product?.price ?? '')}" placeholder="0.00" inputmode="decimal" required />
            </div>
          </div>
          <div class="field">
            <label for="pf-sqft">Area per box (sq ft)</label>
            <input class="input" id="pf-sqft" name="sqftPerBox" value="${escapeHtml(product?.sqftPerBox ?? '')}" placeholder="e.g. 15.5" inputmode="decimal" />
          </div>
          <div class="field">
            <label for="pf-pcs">Pieces per box</label>
            <input class="input" id="pf-pcs" name="pcsPerBox" value="${escapeHtml(product?.pcsPerBox || '')}" placeholder="e.g. 4" inputmode="numeric" />
          </div>
          <div class="field">
            <label for="pf-cost">Cost per box</label>
            <div class="input-affix">
              <span class="affix">₹</span>
              <input class="input" id="pf-cost" name="costPerBox" value="${escapeHtml(product?.costPerBox ?? '')}" placeholder="0.00" inputmode="decimal" />
            </div>
          </div>
          <div class="field">
            <label for="pf-reorder">Reorder level (boxes)</label>
            <input class="input" id="pf-reorder" name="reorderLevel" value="${escapeHtml(product?.reorderLevel ?? '')}" placeholder="e.g. 10" inputmode="decimal" />
          </div>
          ${editing
            ? `<div class="field">
                <label>Stock on hand</label>
                <input class="input" value="${escapeHtml(qty(product.stockBoxes))} boxes" readonly />
              </div>`
            : `<div class="field">
                <label for="pf-opening">Opening stock (boxes)</label>
                <input class="input" id="pf-opening" name="stockBoxes" value="" placeholder="0" inputmode="decimal" />
              </div>`}
          <div class="field">
            <label for="pf-batch">Batch / shade</label>
            <input class="input" id="pf-batch" name="batchNo" value="${escapeHtml(product?.batchNo ?? '')}" placeholder="Optional" maxlength="40" />
          </div>
          <div class="field field-full">
            <label for="pf-notes">Notes</label>
            <input class="input" id="pf-notes" name="notes" value="${escapeHtml(product?.notes ?? '')}" placeholder="Internal note about this item" maxlength="500" />
          </div>
        </div>
        <p class="hint" data-rate-hint style="margin-top:12px;"></p>
      </form>
    `,
    footer: `
      ${editing
        ? `<button type="button" class="btn btn-sm btn-danger-soft" data-archive>${product.active ? 'Archive item' : 'Restore item'}</button>`
        : ''}
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="submit" class="btn btn-primary" form="${formId}" data-save>${editing ? 'Save item' : 'Add item'}</button>
    `,
    onMount(modal, close) {
      const form = modal.querySelector(`#${formId}`);
      const saveButton = modal.querySelector('[data-save]');
      const priceLabel = modal.querySelector('[data-price-label]');
      const rateHint = modal.querySelector('[data-rate-hint]');
      const unitField = form.querySelector('[name="sellUnit"]');
      const priceField = form.querySelector('[name="price"]');
      const sqftField = form.querySelector('[name="sqftPerBox"]');

      const syncPricing = () => {
        const currentUnit = unitField.value;
        priceLabel.textContent = `Selling rate (₹ per ${currentUnit === 'box' ? 'box' : 'sq ft'}) *`;
        const price = parseNumber(priceField.value);
        const sqftPerBox = parseNumber(sqftField.value);
        const hints = [];
        if (sqftPerBox > 0 && price > 0) {
          if (currentUnit === 'sqft') hints.push(`≈ ₹${money(price * sqftPerBox)} per box`);
          else hints.push(`≈ ₹${money(price / sqftPerBox)} per sq ft`);
        }
        if (sqftPerBox <= 0) hints.push('Add the box area if you want to bill this item by square feet.');
        rateHint.textContent = hints.join(' · ');
      };

      unitField.addEventListener('change', syncPricing);
      priceField.addEventListener('input', syncPricing);
      sqftField.addEventListener('input', syncPricing);
      syncPricing();

      modal.querySelector('[data-cancel]').addEventListener('click', close);

      modal.querySelector('[data-archive]')?.addEventListener('click', async () => {
        const archiving = product.active;
        const confirmed = await confirmDialog({
          title: archiving ? 'Archive this item?' : 'Restore this item?',
          message: archiving
            ? `"${product.name}" will be hidden from billing and the catalogue. Past invoices are not affected.`
            : `"${product.name}" will reappear in billing and the catalogue.`,
          confirmLabel: archiving ? 'Archive item' : 'Restore item',
          danger: archiving
        });
        if (!confirmed) return;
        try {
          const saved = await window.tiledesk.products.setActive(product.id, !archiving);
          close();
          toast(archiving ? 'Item archived' : 'Item restored', 'success');
          onSaved?.(saved);
        } catch (error) {
          showFormError(form, error.message);
        }
      });

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFormError(form);
        const data = formDataObject(form);
        if (!String(data.name ?? '').trim()) {
          showFormError(form, 'Item name is required.');
          form.querySelector('[name="name"]').focus();
          return;
        }
        if (data.price !== '' && parseNumber(data.price) < 0) {
          showFormError(form, 'Selling rate cannot be negative.');
          return;
        }
        setButtonLoading(saveButton, true, editing ? 'Saving…' : 'Adding…');
        try {
          const saved = editing
            ? await window.tiledesk.products.update(product.id, data)
            : await window.tiledesk.products.create(data);
          close();
          toast(editing ? 'Item updated' : 'Item added to catalogue', 'success');
          onSaved?.(saved);
        } catch (error) {
          setButtonLoading(saveButton, false);
          showFormError(form, error.message);
        }
      });
    }
  });
}

export function openStockAdjust({ product, onSaved } = {}) {
  const formId = `stock-adjust-${Date.now()}`;
  openModal({
    eyebrow: 'Inventory',
    title: 'Adjust stock',
    subtitle: `${product.name} · ${qty(product.stockBoxes)} boxes on hand`,
    body: `
      <form id="${formId}" novalidate>
        <div class="form-error hidden" data-form-error></div>
        <div class="field-grid" style="margin-top:6px;">
          <div class="field">
            <label for="sa-direction">Adjustment</label>
            <select class="select" id="sa-direction" name="direction">
              <option value="add">Add stock</option>
              <option value="remove">Remove stock</option>
            </select>
          </div>
          <div class="field">
            <label for="sa-qty">Quantity (boxes) *</label>
            <input class="input" id="sa-qty" name="qty" value="" placeholder="0" inputmode="decimal" data-autofocus required />
          </div>
          <div class="field">
            <label for="sa-date">Date</label>
            <input class="input" id="sa-date" name="date" type="date" value="${todayISO()}" max="${todayISO()}" />
          </div>
          <div class="field">
            <label for="sa-reason">Reason *</label>
            <input class="input" id="sa-reason" name="reason" value="" placeholder="Breakage, count correction…" maxlength="200" required />
          </div>
        </div>
        <p class="customer-hint" data-adjust-preview></p>
      </form>
    `,
    footer: `
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="submit" class="btn btn-primary" form="${formId}" data-save>Save adjustment</button>
    `,
    onMount(modal, close) {
      const form = modal.querySelector(`#${formId}`);
      const saveButton = modal.querySelector('[data-save]');
      const preview = modal.querySelector('[data-adjust-preview]');
      const direction = form.querySelector('[name="direction"]');
      const qtyField = form.querySelector('[name="qty"]');

      const updatePreview = () => {
        const delta = parseNumber(qtyField.value) * (direction.value === 'remove' ? -1 : 1);
        const next = product.stockBoxes + delta;
        preview.innerHTML = qtyField.value === ''
          ? 'Stock will update immediately when you save.'
          : `New stock: <strong>${qty(next)} boxes</strong>${next < 0 ? ' — stock cannot go below zero.' : ''}`;
        preview.style.color = next < 0 ? 'var(--red)' : '';
      };
      direction.addEventListener('change', updatePreview);
      qtyField.addEventListener('input', updatePreview);
      updatePreview();

      modal.querySelector('[data-cancel]').addEventListener('click', close);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFormError(form);
        const data = formDataObject(form);
        const quantity = parseNumber(data.qty);
        if (quantity <= 0) {
          showFormError(form, 'Enter a quantity greater than zero.');
          qtyField.focus();
          return;
        }
        if (!String(data.reason ?? '').trim()) {
          showFormError(form, 'Add a reason for this adjustment.');
          return;
        }
        if (data.direction === 'remove' && product.stockBoxes - quantity < 0) {
          showFormError(form, 'Stock cannot be reduced below zero.');
          return;
        }
        setButtonLoading(saveButton, true, 'Saving…');
        try {
          const saved = await window.tiledesk.products.adjustStock(product.id, {
            qtyBoxes: quantity * (data.direction === 'remove' ? -1 : 1),
            reason: data.reason,
            date: data.date
          });
          close();
          toast('Stock adjusted', 'success');
          onSaved?.(saved);
        } catch (error) {
          setButtonLoading(saveButton, false);
          showFormError(form, error.message);
        }
      });
    }
  });
}

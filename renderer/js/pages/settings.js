import { GST_RATES } from '../../../shared/calc.js';
import { INDIAN_STATES } from '../../../shared/states.js';
import { brandMark, icon } from '../icons.js';
import {
  clearFormError,
  escapeHtml,
  pageHead,
  setButtonLoading,
  showFormError,
  toast
} from '../ui.js';

const SECTIONS = [
  { id: 'setting-profile', label: 'Showroom profile', iconName: 'building' },
  { id: 'setting-tax', label: 'Tax & invoicing', iconName: 'percent' },
  { id: 'setting-bank', label: 'Bank & payment', iconName: 'bank' },
  { id: 'setting-data', label: 'Data & backup', iconName: 'database' },
  { id: 'setting-about', label: 'About SAI TILES', iconName: 'info' }
];

const TEXT_FIELDS = [
  'showroomName',
  'legalName',
  'addressLine1',
  'addressLine2',
  'city',
  'pincode',
  'phone',
  'email',
  'gstin',
  'pan',
  'jurisdiction',
  'bankName',
  'accountName',
  'accountNumber',
  'ifsc',
  'upiId',
  'invoicePrefix',
  'defaultGstRate',
  'dueDays',
  'terms',
  'footerNote'
];

let pageAbort = null;
let pageRoot = null;
let settingsForm = null;
let savedSettings = null;
let baseline = null;
let saveButton = null;
let saveHint = null;
let lastSavedLabel = '';

function stateOptions(current) {
  return INDIAN_STATES.map(
    (state) =>
      `<option value="${escapeHtml(state.name)}"${state.name === current ? ' selected' : ''}>${escapeHtml(state.name)} (${state.code})</option>`
  ).join('');
}

function sectionHead(title, subtitle) {
  return `
    <div class="setting-section-head">
      <div>
        <h2 class="setting-section-title">${escapeHtml(title)}</h2>
        <div class="setting-section-sub">${escapeHtml(subtitle)}</div>
      </div>
    </div>
  `;
}

function navMarkup() {
  return SECTIONS.map(
    (section, index) => `
      <button type="button" class="settings-nav-link${index === 0 ? ' active' : ''}" data-scroll="${section.id}">
        ${icon(section.iconName)} ${escapeHtml(section.label)}
      </button>
    `
  ).join('');
}

function summaryMetrics(info) {
  const summary = info?.summary ?? {};
  const cells = [
    { label: 'Catalogue items', value: summary.products ?? 0, iconName: 'products', sub: 'Active items' },
    { label: 'Customers', value: summary.customers ?? 0, iconName: 'customers', sub: 'Active accounts' },
    { label: 'Invoices', value: summary.invoices ?? 0, iconName: 'invoices', sub: 'Including cancelled' },
    { label: 'Payments', value: summary.payments ?? 0, iconName: 'coins', sub: 'Receipts recorded' }
  ];
  return cells
    .map(
      (cell) => `
        <div class="metric-cell">
          <span class="metric-icon">${icon(cell.iconName)}</span>
          <div class="metric-copy">
            <div class="metric-label">${escapeHtml(cell.label)}</div>
            <div class="metric-value">${Number(cell.value).toLocaleString('en-IN')}</div>
            <div class="metric-sub">${escapeHtml(cell.sub)}</div>
          </div>
        </div>
      `
    )
    .join('');
}

function formMarkup(settings, info) {
  const gstinHint = settings.gstin
    ? 'GSTIN prints on every tax invoice. Keep it updated when your registration changes.'
    : 'Add your GSTIN once you are registered; it prints on every tax invoice.';

  return `
    <div class="page" data-testid="settings-page">
      ${pageHead({
        eyebrow: 'Preferences',
        title: 'Settings',
        subtitle: 'The showroom name, address and tax details below appear on every invoice you print.'
      })}

      ${
        settings.profileReviewed
          ? ''
          : `<div class="setup-banner">
              <div class="setup-banner-icon">${icon('sparkle')}</div>
              <div class="setup-banner-copy">
                <div class="setup-banner-title">Review your showroom profile before the first bill</div>
                <div class="setup-banner-text">Check the GSTIN, address and bank details, then save. You can change them any time — issued invoices keep their original details.</div>
              </div>
            </div>`
      }

      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Settings sections">
          <div class="settings-nav-title">Settings</div>
          ${navMarkup()}
        </nav>

        <form class="settings-main" id="settings-form" novalidate>
          <div class="form-error hidden" data-form-error></div>

          <section class="card setting-section" id="setting-profile" data-section>
            ${sectionHead('Showroom profile', 'Printed at the top of every invoice and used to set the place of supply.')}
            <div class="setting-section-body">
              <div class="field-grid">
                <div class="field field-full">
                  <label for="st-showroom">Showroom name *</label>
                  <input class="input" id="st-showroom" name="showroomName" value="${escapeHtml(settings.showroomName)}" placeholder="e.g. Sree Balaji Tiles" maxlength="120" data-autofocus required />
                </div>
                <div class="field field-full">
                  <label for="st-legal">Legal / registered name <span class="optional">optional</span></label>
                  <input class="input" id="st-legal" name="legalName" value="${escapeHtml(settings.legalName)}" placeholder="Proprietor or firm name as registered" maxlength="120" />
                </div>
                <div class="field">
                  <label for="st-phone">Phone</label>
                  <input class="input" id="st-phone" name="phone" value="${escapeHtml(settings.phone)}" placeholder="Landline or mobile" maxlength="30" inputmode="tel" />
                </div>
                <div class="field">
                  <label for="st-email">Email</label>
                  <input class="input" id="st-email" name="email" type="email" value="${escapeHtml(settings.email)}" placeholder="billing@example.com" maxlength="120" inputmode="email" autocomplete="off" />
                </div>
                <div class="field field-full">
                  <label for="st-address1">Address line 1</label>
                  <input class="input" id="st-address1" name="addressLine1" value="${escapeHtml(settings.addressLine1)}" placeholder="Shop no., building, street" maxlength="300" />
                </div>
                <div class="field field-full">
                  <label for="st-address2">Address line 2 <span class="optional">optional</span></label>
                  <input class="input" id="st-address2" name="addressLine2" value="${escapeHtml(settings.addressLine2)}" placeholder="Area or landmark" maxlength="300" />
                </div>
                <div class="field">
                  <label for="st-city">City / town</label>
                  <input class="input" id="st-city" name="city" value="${escapeHtml(settings.city)}" placeholder="City" maxlength="80" />
                </div>
                <div class="field">
                  <label for="st-pincode">Pincode</label>
                  <input class="input" id="st-pincode" name="pincode" value="${escapeHtml(settings.pincode)}" placeholder="600001" maxlength="10" inputmode="numeric" />
                </div>
                <div class="field">
                  <label for="st-state">State</label>
                  <select class="select" id="st-state" name="state" data-state>
                    ${stateOptions(settings.state)}
                  </select>
                  <p class="hint">Determines CGST/SGST for local sales and IGST for other states.</p>
                </div>
                <div class="field">
                  <label for="st-jurisdiction">Jurisdiction</label>
                  <input class="input" id="st-jurisdiction" name="jurisdiction" value="${escapeHtml(settings.jurisdiction)}" placeholder="e.g. Chennai" maxlength="120" />
                  <p class="hint">Printed in the invoice terms as “subject to … jurisdiction”.</p>
                </div>
              </div>
            </div>
          </section>

          <section class="card setting-section" id="setting-tax" data-section>
            ${sectionHead('Tax & invoicing', 'GST registration, invoice numbering and the terms printed beneath each bill.')}
            <div class="setting-section-body">
              <div class="field-grid">
                <div class="field">
                  <label for="st-gstin">GSTIN</label>
                  <input class="input" id="st-gstin" name="gstin" value="${escapeHtml(settings.gstin)}" placeholder="33ABCDE1234F1Z5" maxlength="15" autocomplete="off" spellcheck="false" style="text-transform:uppercase;" data-gstin />
                  <p class="hint" data-gstin-hint>${escapeHtml(gstinHint)}</p>
                </div>
                <div class="field">
                  <label for="st-pan">PAN <span class="optional">optional</span></label>
                  <input class="input" id="st-pan" name="pan" value="${escapeHtml(settings.pan)}" placeholder="ABCDE1234F" maxlength="10" autocomplete="off" spellcheck="false" style="text-transform:uppercase;" data-uppercase />
                  <p class="hint">Shown where the invoice template asks for it.</p>
                </div>
                <div class="field">
                  <label for="st-prefix">Invoice number prefix</label>
                  <input class="input" id="st-prefix" name="invoicePrefix" value="${escapeHtml(settings.invoicePrefix)}" placeholder="INV" maxlength="16" autocomplete="off" spellcheck="false" style="text-transform:uppercase;" data-prefix />
                  <p class="hint" data-prefix-preview></p>
                </div>
                <div class="field">
                  <label for="st-gstrate">Default GST rate</label>
                  <select class="select" id="st-gstrate" name="defaultGstRate">
                    ${GST_RATES.map(
                      (rate) =>
                        `<option value="${rate}"${Number(settings.defaultGstRate) === rate ? ' selected' : ''}>${rate}%</option>`
                    ).join('')}
                  </select>
                  <p class="hint">Used for new catalogue items unless you pick another rate.</p>
                </div>
                <div class="field">
                  <label for="st-due">Default credit period (days)</label>
                  <input class="input" id="st-due" name="dueDays" type="number" value="${escapeHtml(settings.dueDays)}" min="0" max="365" step="1" inputmode="numeric" />
                  <p class="hint">Added to the invoice date to suggest a due date. Use 0 for cash sales.</p>
                </div>
                <div class="field">
                  <label>Rounding</label>
                  <label class="switch" style="height:38px;">
                    <input type="checkbox" name="roundOffEnabled"${settings.roundOffEnabled ? ' checked' : ''} />
                    <span class="switch-track"></span>
                    <span>Round invoice total to the nearest rupee</span>
                  </label>
                  <p class="hint">The round-off amount is shown separately on the invoice.</p>
                </div>
                <div class="field field-full">
                  <label for="st-terms">Invoice terms & conditions</label>
                  <textarea class="textarea" id="st-terms" name="terms" rows="6" maxlength="2000">${escapeHtml(settings.terms)}</textarea>
                  <p class="hint">One line per term. These are printed beneath the invoice items.</p>
                </div>
              </div>
            </div>
          </section>

          <section class="card setting-section" id="setting-bank" data-section>
            ${sectionHead('Bank & payment', 'Printed on the invoice so customers can pay by transfer or UPI. Leave blank if not needed.')}
            <div class="setting-section-body">
              <div class="field-grid">
                <div class="field">
                  <label for="st-bank">Bank name</label>
                  <input class="input" id="st-bank" name="bankName" value="${escapeHtml(settings.bankName)}" placeholder="e.g. HDFC Bank" maxlength="120" />
                </div>
                <div class="field">
                  <label for="st-account-name">Account name</label>
                  <input class="input" id="st-account-name" name="accountName" value="${escapeHtml(settings.accountName)}" placeholder="Name on the account" maxlength="120" />
                </div>
                <div class="field">
                  <label for="st-account-no">Account number</label>
                  <input class="input" id="st-account-no" name="accountNumber" value="${escapeHtml(settings.accountNumber)}" placeholder="Account number" maxlength="34" inputmode="numeric" autocomplete="off" />
                </div>
                <div class="field">
                  <label for="st-ifsc">IFSC</label>
                  <input class="input" id="st-ifsc" name="ifsc" value="${escapeHtml(settings.ifsc)}" placeholder="HDFC0001234" maxlength="11" autocomplete="off" spellcheck="false" style="text-transform:uppercase;" data-uppercase />
                </div>
                <div class="field">
                  <label for="st-upi">UPI ID <span class="optional">optional</span></label>
                  <input class="input" id="st-upi" name="upiId" value="${escapeHtml(settings.upiId)}" placeholder="showroom@upi" maxlength="120" autocomplete="off" spellcheck="false" />
                </div>
                <div class="field">
                  <label for="st-footer">Invoice footer note</label>
                  <input class="input" id="st-footer" name="footerNote" value="${escapeHtml(settings.footerNote)}" placeholder="Thank you for choosing us." maxlength="300" />
                </div>
              </div>
            </div>
          </section>

          <section class="card setting-section" id="setting-data" data-section>
            ${sectionHead('Data & backup', 'Everything is stored in a local SQLite file on this Mac. Nothing is uploaded.')}
            <div class="setting-section-body">
              <div class="metric-strip" style="margin-bottom:16px;">
                ${summaryMetrics(info)}
              </div>
              <div class="setting-row">
                <div class="setting-row-copy">
                  <div class="setting-row-title">Database file</div>
                  <div class="setting-row-text">Your bills, stock and customer records live in this file.</div>
                  <div class="data-path">${escapeHtml(info?.dbPath ?? 'Not available')}</div>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-row-copy">
                  <div class="setting-row-title">Automatic backups</div>
                  <div class="setting-row-text">SAI TILES saves one copy each day on launch and keeps the latest 30.</div>
                  <div class="data-path">${escapeHtml(info?.backupsDir ?? 'Not available')}</div>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-row-copy">
                  <div class="setting-row-title">Manual backup</div>
                  <div class="setting-row-text">Save a copy of the database to a folder or external drive.</div>
                </div>
                <button type="button" class="btn" data-backup>${icon('download')} Backup now</button>
              </div>
              <div class="backup-actions">
                <button type="button" class="btn btn-sm btn-ghost" data-open-folder>${icon('folder')} Show data folder</button>
              </div>
            </div>
          </section>

          <section class="card setting-section" id="setting-about" data-section>
            ${sectionHead('About SAI TILES', 'A local-first billing desk for SAI TILES.')}
            <div class="setting-section-body">
              <div class="about-block">
                <div class="about-mark">${brandMark()}</div>
                <div>
                  <div class="about-name">SAI TILES</div>
                  <div class="about-meta">Version ${escapeHtml(info?.version ?? '1.0.0')} · ${escapeHtml(info?.platform === 'darwin' ? 'macOS' : info?.platform ?? 'Desktop')} · Local SQLite</div>
                </div>
              </div>
              <div class="setting-row" style="margin-top:14px;">
                <div class="setting-row-copy">
                  <div class="setting-row-title">Next invoice number</div>
                  <div class="setting-row-text">Generated from your prefix and the saved invoice sequence.</div>
                </div>
                <span class="invoice-no">${escapeHtml(info?.summary?.nextInvoiceNumber ?? '—')}</span>
              </div>
              <div class="setting-row">
                <div class="setting-row-copy">
                  <div class="setting-row-title">Today</div>
                  <div class="setting-row-text">Dates on invoices follow this Mac's local calendar.</div>
                </div>
                <span class="cell-primary">${escapeHtml(info?.summary?.localDateLong ?? new Date().toLocaleDateString('en-IN'))}</span>
              </div>
              <div class="setting-row">
                <div class="setting-row-copy">
                  <div class="setting-row-title">Privacy</div>
                  <div class="setting-row-text">No account, no cloud and no internet connection required. Keep the database file backed up.</div>
                </div>
                <span class="chip chip-neutral">${icon('shield')} Offline</span>
              </div>
            </div>
          </section>

          <div class="settings-save-bar">
            <div class="settings-save-hint" data-save-hint>${settings.profileReviewed ? 'All changes saved.' : 'Review these details and save before your first bill.'}</div>
            <div class="row" style="gap:8px;">
              <button type="button" class="btn" data-reset disabled>Discard changes</button>
              <button type="submit" class="btn btn-primary" data-save>${icon('check')} Save settings</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
}

function fieldValue(name) {
  return settingsForm?.querySelector(`[name="${name}"]`)?.value ?? '';
}

function collectSettings() {
  if (!settingsForm) return {};
  const values = {};
  for (const name of TEXT_FIELDS) values[name] = fieldValue(name);
  values.roundOffEnabled = Boolean(settingsForm.querySelector('[name="roundOffEnabled"]')?.checked);
  return values;
}

function fillForm(settings) {
  if (!settingsForm) return;
  for (const name of TEXT_FIELDS) {
    const field = settingsForm.querySelector(`[name="${name}"]`);
    if (field) field.value = settings[name] ?? '';
  }
  const roundOff = settingsForm.querySelector('[name="roundOffEnabled"]');
  if (roundOff) roundOff.checked = Boolean(settings.roundOffEnabled);
}

function updatePrefixPreview() {
  const target = pageRoot?.querySelector('[data-prefix-preview]');
  if (!target) return;
  const prefix = fieldValue('invoicePrefix').trim().toUpperCase() || 'INV';
  const nextNumber = pageRoot.querySelector('.setting-section .invoice-no')?.textContent?.trim() ?? '';
  const sequence = /(\d+)\s*$/.exec(nextNumber)?.[1] ?? '0001';
  target.textContent = `Next invoice will be ${prefix}-${sequence}.`;
}

function updateGstinHint() {
  const hint = pageRoot?.querySelector('[data-gstin-hint]');
  if (!hint) return;
  const gstin = fieldValue('gstin').trim().toUpperCase();
  const stateName = fieldValue('state');
  const stateCode = INDIAN_STATES.find((state) => state.name === stateName)?.code ?? '';
  hint.style.color = '';
  if (!gstin) {
    hint.textContent = 'Add your GSTIN once you are registered; it prints on every tax invoice.';
    return;
  }
  if (gstin.length < 15) {
    hint.textContent = `${gstin.length} of 15 characters entered.`;
    return;
  }
  if (stateCode && gstin.slice(0, 2) !== stateCode) {
    hint.textContent = `This GSTIN starts with ${gstin.slice(0, 2)} but ${stateName} uses state code ${stateCode}. Please check it.`;
    hint.style.color = 'var(--amber)';
    return;
  }
  hint.textContent = 'GSTIN looks complete. It will print on every tax invoice.';
}

function refreshDirtyState() {
  if (!settingsForm || !baseline) return;
  const dirty = JSON.stringify(collectSettings()) !== JSON.stringify(baseline);
  const resetButton = settingsForm.querySelector('[data-reset]');
  if (resetButton) resetButton.disabled = !dirty;
  if (saveHint) {
    saveHint.classList.toggle('is-dirty', dirty);
    saveHint.textContent = dirty
      ? 'You have unsaved changes.'
      : lastSavedLabel || 'All changes saved.';
  }
}

async function backupDatabase(button) {
  setButtonLoading(button, true, 'Opening…');
  try {
    const result = await window.tiledesk.app.backup();
    if (!result?.canceled) toast('Database backup saved', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setButtonLoading(button, false);
  }
}

async function openDataFolder(button) {
  setButtonLoading(button, true, 'Opening…');
  try {
    await window.tiledesk.app.openDataFolder();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setButtonLoading(button, false);
  }
}

function scrollToSection(sectionId) {
  const section = pageRoot?.querySelector(`#${sectionId}`);
  if (!section) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  for (const link of pageRoot.querySelectorAll('[data-scroll]')) {
    link.classList.toggle('active', link.dataset.scroll === sectionId);
  }
}

async function saveSettings(ctx) {
  clearFormError(settingsForm);
  const data = collectSettings();
  if (!String(data.showroomName ?? '').trim()) {
    showFormError(settingsForm, 'Showroom name is required.');
    settingsForm.querySelector('[name="showroomName"]')?.focus();
    return;
  }

  setButtonLoading(saveButton, true, 'Saving…');
  try {
    const patch = {
      ...data,
      dueDays: Number(data.dueDays || 0),
      defaultGstRate: Number(data.defaultGstRate),
      profileReviewed: true
    };
    const updated = await window.tiledesk.settings.update(patch);
    savedSettings = updated;
    fillForm(updated);
    baseline = collectSettings();
    lastSavedLabel = `Saved at ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}.`;
    pageRoot.querySelector('.setup-banner')?.remove();
    await ctx.refreshShell();
    updatePrefixPreview();
    updateGstinHint();
    refreshDirtyState();
    toast('Settings saved', 'success');
  } catch (error) {
    showFormError(settingsForm, error.message);
  } finally {
    setButtonLoading(saveButton, false);
  }
}

function bindEvents(ctx) {
  const options = { signal: pageAbort.signal };

  pageRoot.addEventListener(
    'click',
    (event) => {
      const scroll = event.target.closest('[data-scroll]');
      if (scroll) {
        event.preventDefault();
        scrollToSection(scroll.dataset.scroll);
        return;
      }

      const backup = event.target.closest('[data-backup]');
      if (backup) {
        event.preventDefault();
        void backupDatabase(backup);
        return;
      }

      const folder = event.target.closest('[data-open-folder]');
      if (folder) {
        event.preventDefault();
        void openDataFolder(folder);
        return;
      }

      const reset = event.target.closest('[data-reset]');
      if (reset) {
        event.preventDefault();
        if (savedSettings) {
          fillForm(savedSettings);
          updatePrefixPreview();
          updateGstinHint();
          refreshDirtyState();
        }
      }
    },
    options
  );

  settingsForm.addEventListener(
    'input',
    (event) => {
      if (event.target.matches('[data-uppercase], [data-gstin], [data-prefix]')) {
        const input = event.target;
        const upper = input.value.toUpperCase();
        if (input.value !== upper) input.value = upper;
      }
      if (event.target.matches('[data-gstin]')) updateGstinHint();
      if (event.target.matches('[data-prefix]')) updatePrefixPreview();
      refreshDirtyState();
    },
    options
  );

  settingsForm.addEventListener(
    'change',
    (event) => {
      if (event.target.matches('[data-state]')) updateGstinHint();
      refreshDirtyState();
    },
    options
  );

  settingsForm.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      void saveSettings(ctx);
    },
    options
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveSettings(ctx);
      }
    },
    options
  );
}

export async function render(root, ctx) {
  // Pull the freshest copy so a settings save from another window is reflected.
  if (pageAbort) pageAbort.abort();
  pageAbort = new AbortController();

  const settings = ctx.settings ?? (await window.tiledesk.settings.get());
  const info = ctx.info ?? (await window.tiledesk.app.info());

  root.innerHTML = formMarkup({ ...settings }, info);
  pageRoot = root.querySelector('[data-testid="settings-page"]');
  settingsForm = pageRoot.querySelector('#settings-form');
  saveButton = settingsForm.querySelector('[data-save]');
  saveHint = settingsForm.querySelector('[data-save-hint]');
  savedSettings = { ...settings };
  baseline = collectSettings();
  lastSavedLabel = '';

  updatePrefixPreview();
  updateGstinHint();
  bindEvents(ctx);
}

export function cleanup() {
  if (pageAbort) {
    pageAbort.abort();
    pageAbort = null;
  }
  pageRoot = null;
  settingsForm = null;
  saveButton = null;
  saveHint = null;
  savedSettings = null;
  baseline = null;
}

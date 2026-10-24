import {
  formatDate,
  formatMoney,
  formatQty,
  initials as initialsOf
} from '../../shared/format.js';
import { icon } from './icons.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function money(value, { symbol = false, decimals = 2 } = {}) {
  return formatMoney(value, { symbol, decimals });
}

export function qty(value, decimals = 3) {
  return formatQty(value, decimals);
}

export function dateText(value) {
  return formatDate(value);
}

export function initials(name) {
  return initialsOf(name) || '—';
}

export function pageHead({ eyebrow = '', title, subtitle = '', actions = '', back = null }) {
  return `
    <div class="page-head">
      <div class="page-head-main">
        ${back ? `<button type="button" class="back-link" data-nav="${escapeHtml(back.href)}">${icon('arrowLeft')} ${escapeHtml(back.label)}</button>` : ''}
        ${eyebrow ? `<div class="eyebrow"><span class="dot"></span>${escapeHtml(eyebrow)}</div>` : ''}
        <h1 class="page-title">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="page-subtitle">${subtitle}</p>` : ''}
      </div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ''}
    </div>
  `;
}

const PAYMENT_LABELS = {
  paid: 'Paid',
  partial: 'Part paid',
  unpaid: 'Unpaid',
  void: 'Cancelled'
};

export function paymentChip(status) {
  const key = PAYMENT_LABELS[status] ? status : 'unpaid';
  return `<span class="chip chip-${key}">${PAYMENT_LABELS[key]}</span>`;
}

export function invoiceStatusChip(invoice) {
  if (invoice.status === 'void') return `<span class="chip chip-void">Cancelled</span>`;
  return paymentChip(invoice.paymentStatus);
}

export function avatarTone(name) {
  const tones = ['', 'avatar-green', 'avatar-clay', 'avatar-slate'];
  const text = String(name ?? '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash + text.charCodeAt(index) * (index + 3)) % 997;
  }
  return tones[hash % tones.length];
}

export function swatchTone(name) {
  const tones = ['swatch-grey', 'swatch-ivory', 'swatch-blue', 'swatch-sand', 'swatch-green', 'swatch-rose', 'swatch-dark'];
  const text = String(name ?? '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash + text.charCodeAt(index) * (index + 5)) % 991;
  }
  return tones[hash % tones.length];
}

export function productSwatch(product) {
  return `<span class="tile-swatch ${swatchTone(`${product?.name ?? ''}${product?.size ?? ''}`)}" aria-hidden="true"></span>`;
}

export function customerAvatar(customer, size = '') {
  return `<span class="avatar ${avatarTone(customer?.name)} ${size}">${escapeHtml(initials(customer?.name))}</span>`;
}

export function emptyState({ iconName = 'info', title, text = '', action = '' }) {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon(iconName)}</div>
      <div class="empty-title">${escapeHtml(title)}</div>
      ${text ? `<p class="empty-text">${escapeHtml(text)}</p>` : ''}
      ${action}
    </div>
  `;
}

export function loadingPanel(rows = 5) {
  return `
    <div class="loading-panel card">
      ${Array.from({ length: rows }, () => '<div class="skeleton loading-row"></div>').join('')}
    </div>
  `;
}

export function tableLoading(rows = 6) {
  return `
    <div class="loading-panel">
      ${Array.from({ length: rows }, () => '<div class="skeleton loading-row"></div>').join('')}
    </div>
  `;
}

export function toast(message, type = 'info', { duration = 3800 } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const toastElement = document.createElement('div');
  toastElement.className = `toast${type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : ''}`;
  const iconName = type === 'error' ? 'alert' : type === 'success' ? 'checkCircle' : 'info';
  toastElement.innerHTML = `${icon(iconName)}<span>${escapeHtml(message)}</span>`;
  region.append(toastElement);
  const hide = () => {
    toastElement.classList.add('is-hiding');
    window.setTimeout(() => toastElement.remove(), 220);
  };
  window.setTimeout(hide, duration);
  toastElement.addEventListener('click', hide);
}

function syncModalBody() {
  const hasModal = document.querySelectorAll('.modal-backdrop').length > 0;
  document.body.classList.toggle('modal-open', hasModal);
}

export function openModal({
  title = '',
  eyebrow = '',
  subtitle = '',
  body = '',
  footer = '',
  size = '',
  closeOnBackdrop = true,
  onMount,
  onClose
} = {}) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal${size ? ` ${size}` : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal-head">
        <div>
          ${eyebrow ? `<div class="modal-eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
          <h2 class="modal-title">${escapeHtml(title)}</h2>
          ${subtitle ? `<div class="modal-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        </div>
        <button type="button" class="modal-close" data-modal-close aria-label="Close">${icon('close')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>
  `;
  root.append(backdrop);
  const modal = backdrop.querySelector('.modal');
  const previousFocus = document.activeElement;
  let closed = false;

  const keyHandler = (event) => {
    if (backdrop !== document.querySelector('.modal-backdrop:last-of-type')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key === 'Tab') {
      const focusable = [...modal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', keyHandler);
    backdrop.remove();
    syncModalBody();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
    onClose?.();
  }

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop && closeOnBackdrop) close();
  });
  backdrop.querySelector('[data-modal-close]')?.addEventListener('click', close);
  document.addEventListener('keydown', keyHandler);
  syncModalBody();

  window.requestAnimationFrame(() => {
    const autofocus = modal.querySelector('[data-autofocus]');
    const firstField = modal.querySelector(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button'
    );
    (autofocus ?? firstField ?? modal).focus?.({ preventScroll: true });
  });

  onMount?.(modal, close);

  return { modal, backdrop, close };
}

export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  iconName = danger ? 'alert' : 'info'
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value, close) => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };
    const handle = openModal({
      title,
      size: '',
      body: `
        <div class="modal-icon ${danger ? 'danger' : ''}">${icon(iconName)}</div>
        <p class="muted" style="margin:0;font-size:12px;line-height:1.6;">${escapeHtml(message)}</p>
      `,
      footer: `
        <button type="button" class="btn" data-cancel>${escapeHtml(cancelLabel)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escapeHtml(confirmLabel)}</button>
      `,
      onMount(modal, close) {
        modal.querySelector('[data-cancel]').addEventListener('click', () => finish(false, close));
        modal.querySelector('[data-confirm]').addEventListener('click', () => finish(true, close));
      },
      onClose() {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }
    });
    return handle;
  });
}

export function setButtonLoading(button, loading, label = 'Saving…') {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-loading');
    button.innerHTML = `<span class="spinner"></span><span class="btn-label">${escapeHtml(label)}</span>`;
  } else {
    button.disabled = false;
    button.classList.remove('is-loading');
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

export function showFormError(container, message) {
  const target = container?.querySelector?.('[data-form-error]');
  if (!target) {
    toast(message, 'error');
    return;
  }
  target.textContent = message;
  target.classList.remove('hidden');
  target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function clearFormError(container) {
  const target = container?.querySelector?.('[data-form-error]');
  if (!target) return;
  target.textContent = '';
  target.classList.add('hidden');
}

export function formDataObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export function debounce(callback, delay = 250) {
  let timer = null;
  const debounced = (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
  debounced.cancel = () => window.clearTimeout(timer);
  return debounced;
}

export function parseNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function csvValue(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRows(rows) {
  return rows.map((row) => row.map(csvValue).join(',')).join('\r\n');
}

export async function downloadCsv(suggestedName, rows) {
  const content = `\ufeff${csvRows(rows)}`;
  const result = await window.tiledesk.app.saveCsv({ suggestedName, content });
  if (result?.canceled) return false;
  toast('CSV exported', 'success');
  return true;
}

export function barChart(series, { today = '', labelEvery = 2, emptyText = 'No sales in this period yet.' } = {}) {
  const max = Math.max(...series.map((entry) => Number(entry.total) || 0), 0);
  if (!series.length) {
    return `<div class="chart-plot"><div class="chart-empty">${escapeHtml(emptyText)}</div></div>`;
  }
  const labels = [];
  const bars = series
    .map((entry, index) => {
      const total = Number(entry.total) || 0;
      const height = max > 0 ? Math.max((total / max) * 100, total > 0 ? 3 : 0.8) : 0.8;
      const isToday = entry.date === today;
      const showLabel = index % labelEvery === 0 || index === series.length - 1;
      const date = new Date(`${entry.date}T00:00:00`);
      const label = Number.isNaN(date.getTime())
        ? entry.date
        : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      labels.push(`<span class="chart-label${showLabel ? '' : ' is-empty'}">${escapeHtml(showLabel ? label : '·')}</span>`);
      return `
        <div class="chart-col${isToday ? ' is-today' : ''}">
          <div class="chart-tooltip">${escapeHtml(label)} · ₹${money(total)}<br>${Number(entry.count) || 0} bill${Number(entry.count) === 1 ? '' : 's'}</div>
          <div class="chart-bar${total <= 0 ? ' is-zero' : ''}" style="height:${height.toFixed(2)}%"></div>
        </div>
      `;
    })
    .join('');
  return `<div class="chart-plot">${bars}</div><div class="chart-labels">${labels.join('')}</div>`;
}

export function barShare(value, total) {
  const percentage = total > 0 ? Math.min(Math.max((value / total) * 100, 0), 100) : 0;
  return `<div class="bar-share"><span style="width:${percentage.toFixed(1)}%"></span></div>`;
}

export function pluralise(count, singular, plural = `${singular}s`) {
  return `${count} ${Number(count) === 1 ? singular : plural}`;
}

export function focusWithoutScroll(element) {
  element?.focus?.({ preventScroll: true });
}

export function confirmNavigation(message) {
  return confirmDialog({
    title: 'Leave this bill?',
    message,
    confirmLabel: 'Leave bill',
    cancelLabel: 'Stay',
    danger: true
  });
}

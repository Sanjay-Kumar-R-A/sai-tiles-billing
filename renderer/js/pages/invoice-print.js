import { icon } from '../icons.js';
import { renderPrintDocument } from '../print-document.js';
import { dateText, emptyState, escapeHtml, money, pageHead, toast } from '../ui.js';

let pageAbort = null;

async function printInvoice() {
  try {
    const result = await window.tiledesk.app.printPage();
    if (result?.started === false && result?.failureReason && !/cancel/i.test(result.failureReason)) {
      toast(result.failureReason, 'error');
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function savePdf(invoice) {
  try {
    const result = await window.tiledesk.app.savePdf({ suggestedName: `${invoice.invoiceNo}.pdf` });
    if (!result?.canceled) {
      toast('Invoice saved as PDF', 'success');
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

export async function render(root, ctx) {
  if (pageAbort) pageAbort.abort();
  pageAbort = new AbortController();

  let invoice;
  let settings;
  try {
    [invoice, settings] = await Promise.all([
      window.tiledesk.invoices.get(Number(ctx.params.id)),
      window.tiledesk.settings.get()
    ]);
  } catch (error) {
    root.innerHTML = `
      <div class="page">
        ${pageHead({
          back: { href: '/invoices', label: 'All invoices' },
          eyebrow: 'Print',
          title: 'Invoice could not be prepared'
        })}
        <div class="card">
          ${emptyState({
            iconName: 'alert',
            title: 'Nothing to print',
            text: error.message,
            action: '<button type="button" class="btn btn-primary" data-nav="/invoices">Back to invoices</button>'
          })}
        </div>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="print-view">
      <div class="print-toolbar">
        <div class="print-toolbar-copy">
          <div class="print-toolbar-title">Tax invoice · ${escapeHtml(invoice.invoiceNo)}</div>
          <div class="print-toolbar-sub">
            ${escapeHtml(invoice.customerName)} · ${dateText(invoice.invoiceDate)} · ₹${money(invoice.total)}
            ${invoice.status === 'void' ? ' · Cancelled document' : ''}
          </div>
        </div>
        <div class="print-toolbar-actions">
          <button type="button" class="btn" data-nav="/invoices/${invoice.id}">${icon('arrowLeft')} Back to invoice</button>
          <button type="button" class="btn" data-action="save-pdf">${icon('download')} Save PDF</button>
          <button type="button" class="btn btn-primary" data-action="print">${icon('printer')} Print</button>
        </div>
      </div>
      <div class="print-stage">
        <div class="print-sheet">${renderPrintDocument(invoice, settings)}</div>
      </div>
    </div>
  `;

  root.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('[data-action="print"]')) {
        void printInvoice();
        return;
      }
      if (event.target.closest('[data-action="save-pdf"]')) {
        void savePdf(invoice);
      }
    },
    { signal: pageAbort.signal }
  );

  const auto = ctx.query.auto;
  if (auto === 'print' || auto === 'pdf') {
    window.history.replaceState(null, '', `#${ctx.pathname}`);
    window.setTimeout(() => {
      if (auto === 'pdf') void savePdf(invoice);
      else void printInvoice();
    }, 400);
  }
}

export function cleanup() {
  if (pageAbort) {
    pageAbort.abort();
    pageAbort = null;
  }
}

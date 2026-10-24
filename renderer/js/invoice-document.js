import { amountInWords } from '../../shared/words.js';
import { formatQty } from '../../shared/format.js';
import { brandMark } from './icons.js';
import { escapeHtml, money as formatMoneyValue, dateText, paymentChip } from './ui.js';

export function companyAddressLines(settings) {
  return [
    settings.addressLine1,
    settings.addressLine2,
    [settings.city, settings.state, settings.pincode].filter(Boolean).join(' · ')
  ].filter(Boolean);
}

export function bankDetailLines(settings) {
  const details = [];
  if (settings.bankName) details.push(settings.bankName);
  if (settings.accountName) details.push(`A/c name: ${settings.accountName}`);
  if (settings.accountNumber) details.push(`A/c no: ${settings.accountNumber}`);
  if (settings.ifsc) details.push(`IFSC: ${settings.ifsc}`);
  if (settings.upiId) details.push(`UPI: ${settings.upiId}`);
  return details;
}

export function itemQuantity(item) {
  const main = `${formatQty(item.qty)} ${item.unit === 'sqft' ? 'sq ft' : 'box'}`;
  if (item.sqftPerBox > 0) {
    if (item.unit === 'sqft') {
      return { main, sub: `${formatQty(item.qty / item.sqftPerBox)} boxes · ${formatQty(item.sqftPerBox)} sq ft/box` };
    }
    return { main, sub: `${formatQty(item.qty * item.sqftPerBox)} sq ft · ${formatQty(item.sqftPerBox)} sq ft/box` };
  }
  return { main, sub: '' };
}

export function taxBreakup(invoice) {
  const grouped = new Map();
  for (const item of invoice.items ?? []) {
    const key = `${item.hsn || '—'}|${item.gstRate}`;
    const entry = grouped.get(key) ?? {
      hsn: item.hsn || '—',
      gstRate: item.gstRate,
      taxable: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      total: 0
    };
    entry.taxable += item.taxable;
    entry.cgst += item.cgst;
    entry.sgst += item.sgst;
    entry.igst += item.igst;
    entry.total += item.taxable + item.cgst + item.sgst + item.igst;
    grouped.set(key, entry);
  }
  return [...grouped.values()].map((entry) => ({
    ...entry,
    taxable: Number(entry.taxable.toFixed(2)),
    cgst: Number(entry.cgst.toFixed(2)),
    sgst: Number(entry.sgst.toFixed(2)),
    igst: Number(entry.igst.toFixed(2)),
    total: Number(entry.total.toFixed(2))
  }));
}

export function renderInvoiceDocument(invoice, settings) {
  const isInterState = invoice.igst > 0;
  const billingLines = String(invoice.billingAddress || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join('');
  const shippingLines = String(invoice.shippingAddress || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join('');

  const itemRows = invoice.items
    .map((item) => {
      const quantity = itemQuantity(item);
      return `
        <tr>
          <td>
            <div class="doc-item-name">${escapeHtml(item.name)}</div>
            <div class="doc-item-meta">${[item.sku, item.hsn ? `HSN ${item.hsn}` : '', item.discountPct > 0 ? `${formatQty(item.discountPct)}% discount` : ''].filter(Boolean).map(escapeHtml).join(' · ')}</div>
          </td>
          <td class="num">${escapeHtml(quantity.main)}<div class="doc-item-meta">${escapeHtml(quantity.sub)}</div></td>
          <td class="num">₹${formatMoneyValue(item.rate)}</td>
          <td class="num">${formatQty(item.gstRate)}%</td>
          <td class="num">₹${formatMoneyValue(item.taxable)}</td>
          <td class="num">₹${formatMoneyValue(item.lineTotal)}</td>
        </tr>
      `;
    })
    .join('');

  const roundOffLabel = Number(invoice.roundOff) === 0
    ? ''
    : `<div class="doc-total-row"><span>Round off</span><span>${invoice.roundOff > 0 ? '+' : '−'}₹${formatMoneyValue(Math.abs(invoice.roundOff))}</span></div>`;

  return `
    <div class="document-wrap">
      ${invoice.status === 'void' ? '<div class="void-watermark">CANCELLED</div>' : ''}
      <div class="document-card">
        <div class="doc-head">
          <div class="doc-brand">
            <div class="doc-brand-mark">${brandMark()}</div>
            <div>
              <div class="doc-brand-name">${escapeHtml(settings.showroomName)}</div>
              <div class="doc-brand-meta">${companyAddressLines(settings).map(escapeHtml).join('\n')}${settings.phone ? `\n${escapeHtml(settings.phone)}` : ''}${settings.gstin ? `\nGSTIN ${escapeHtml(settings.gstin)}` : ''}</div>
            </div>
          </div>
          <div class="doc-head-right">
            <div class="doc-type">${invoice.status === 'void' ? 'Cancelled document' : 'Tax invoice'}</div>
            <div class="doc-number">${escapeHtml(invoice.invoiceNo)}</div>
            <div class="doc-date">${dateText(invoice.invoiceDate)} · Due ${dateText(invoice.dueDate)}</div>
            <div style="margin-top:7px;">${paymentChip(invoice.status === 'void' ? 'void' : invoice.paymentStatus)}</div>
          </div>
        </div>

        <div class="doc-info-grid">
          <div>
            <div class="doc-label">Billed to</div>
            <div class="doc-customer-name">${escapeHtml(invoice.customerName)}</div>
            <div class="doc-customer-meta">${[
              escapeHtml(invoice.customerPhone),
              invoice.customerGstin ? `GSTIN ${escapeHtml(invoice.customerGstin)}` : '',
              billingLines
            ].filter(Boolean).join('\n')}</div>
            ${shippingLines ? `<div class="doc-label" style="margin-top:12px;">Shipped to</div><div class="doc-customer-meta">${shippingLines}</div>` : ''}
          </div>
          <div class="doc-meta-list">
            <div class="doc-meta-item"><div class="t">Invoice date</div><div class="v">${dateText(invoice.invoiceDate)}</div></div>
            <div class="doc-meta-item"><div class="t">Due date</div><div class="v">${dateText(invoice.dueDate)}</div></div>
            <div class="doc-meta-item"><div class="t">Place of supply</div><div class="v">${escapeHtml(invoice.placeOfSupply)} (${escapeHtml(invoice.stateCode)})</div></div>
            <div class="doc-meta-item"><div class="t">Tax type</div><div class="v">${isInterState ? 'IGST · Inter-state' : 'CGST + SGST · Intra-state'}</div></div>
          </div>
        </div>

        <div class="doc-items">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th class="num">Quantity</th>
                <th class="num">Rate</th>
                <th class="num">GST</th>
                <th class="num">Taxable</th>
                <th class="num">Amount</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
        </div>

        <div class="doc-totals">
          <div class="doc-total-table">
            <div class="doc-total-row"><span>Subtotal</span><span>₹${formatMoneyValue(invoice.subtotal)}</span></div>
            ${invoice.discountTotal > 0 ? `<div class="doc-total-row"><span>Discount</span><span>−₹${formatMoneyValue(invoice.discountTotal)}</span></div>` : ''}
            <div class="doc-total-row"><span>Taxable value</span><span>₹${formatMoneyValue(invoice.taxableTotal)}</span></div>
            ${isInterState
              ? `<div class="doc-total-row"><span>IGST</span><span>₹${formatMoneyValue(invoice.igst)}</span></div>`
              : `<div class="doc-total-row"><span>CGST</span><span>₹${formatMoneyValue(invoice.cgst)}</span></div>
                 <div class="doc-total-row"><span>SGST</span><span>₹${formatMoneyValue(invoice.sgst)}</span></div>`}
            ${roundOffLabel}
            <div class="doc-total-row grand"><span>Total</span><span>₹${formatMoneyValue(invoice.total)}</span></div>
            <div class="doc-total-row"><span>Received</span><span>₹${formatMoneyValue(invoice.amountPaid)}</span></div>
            <div class="doc-total-row"><span>Balance due</span><span>₹${formatMoneyValue(invoice.balance)}</span></div>
          </div>
        </div>

        <div class="doc-note">
          <strong style="color:var(--ink-soft);">${escapeHtml(amountInWords(invoice.total))}</strong>
          ${invoice.notes ? `<div style="margin-top:8px;">${escapeHtml(invoice.notes)}</div>` : ''}
          ${settings.footerNote ? `<div style="margin-top:8px;">${escapeHtml(settings.footerNote)}</div>` : ''}
        </div>
        <div class="doc-signature">
          <span>For ${escapeHtml(settings.showroomName)}</span>
          <strong>Authorised signatory</strong>
        </div>
      </div>
    </div>
  `;
}

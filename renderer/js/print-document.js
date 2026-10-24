import { amountInWords } from '../../shared/words.js';
import { formatQty } from '../../shared/format.js';
import { brandMark } from './icons.js';
import { escapeHtml, money, dateText } from './ui.js';
import { bankDetailLines, companyAddressLines, taxBreakup } from './invoice-document.js';

function addressHtml(value) {
  const lines = String(value || '')
    .split('\n')
    .filter(Boolean)
    .map(escapeHtml);
  return lines.length ? lines.join('<br>') : '—';
}

function roundOffText(value) {
  const amount = Math.abs(Number(value));
  return `₹${money(amount)}`;
}

export function renderPrintDocument(invoice, settings) {
  const interState = invoice.igst > 0 || invoice.isInterState;
  const breakup = taxBreakup(invoice);
  const gstin = invoice.customerGstin;

  const itemRows = invoice.items
    .map((item, index) => {
      const unitLabel = item.unit === 'sqft' ? 'sq ft' : 'box';
      const areaNote = item.sqftPerBox > 0
        ? item.unit === 'sqft'
          ? `${formatQty(item.qty / item.sqftPerBox)} boxes`
          : `${formatQty(item.qty * item.sqftPerBox)} sq ft`
        : '';
      const meta = [item.sku, areaNote].filter(Boolean).map(escapeHtml).join(' · ');
      return `
        <tr>
          <td class="c-no">${index + 1}</td>
          <td class="c-desc">
            <div class="pi-item-name">${escapeHtml(item.name)}</div>
            ${meta ? `<div class="pi-item-meta">${meta}</div>` : ''}
          </td>
          <td class="c-hsn">${escapeHtml(item.hsn || '—')}</td>
          <td class="c-qty"><strong>${formatQty(item.qty)}</strong> ${unitLabel}</td>
          <td class="c-rate">${money(item.rate)}</td>
          <td class="c-disc">${item.discountPct > 0 ? `${formatQty(item.discountPct)}%` : '—'}</td>
          <td class="c-taxable">${money(item.taxable)}</td>
          <td class="c-gst">${formatQty(item.gstRate)}%</td>
          ${interState
            ? `<td class="c-igst">${money(item.igst)}</td>`
            : `<td class="c-cgst">${money(item.cgst)}</td><td class="c-sgst">${money(item.sgst)}</td>`}
          <td class="c-amount">${money(item.lineTotal)}</td>
        </tr>
      `;
    })
    .join('');

  const taxRows = breakup
    .map(
      (entry) => `
        <tr>
          <td>${escapeHtml(entry.hsn)}</td>
          <td>${money(entry.taxable)}</td>
          <td>${formatQty(entry.gstRate)}%</td>
          ${interState
            ? `<td>${money(entry.igst)}</td>`
            : `<td>${money(entry.cgst)}</td><td>${money(entry.sgst)}</td>`}
        </tr>
      `
    )
    .join('');

  const bank = bankDetailLines(settings);
  const terms = String(invoice.terms || settings.terms || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join('');

  return `
    <article class="pi">
      ${invoice.status === 'void' ? '<div class="pi-void">CANCELLED</div>' : ''}
      <header class="pi-head">
        <div class="pi-brand">
          <div class="pi-mark">${brandMark()}</div>
          <div class="pi-brand-copy">
            <h1>${escapeHtml(settings.showroomName)}</h1>
            ${settings.legalName && settings.legalName !== settings.showroomName ? `<div class="pi-legal">${escapeHtml(settings.legalName)}</div>` : ''}
            <div class="pi-address">${companyAddressLines(settings).map(escapeHtml).join('<br>')}</div>
            <div class="pi-contact">${[settings.phone, settings.email, settings.website].filter(Boolean).map(escapeHtml).join(' · ')}</div>
            <div class="pi-ids">
              ${settings.gstin ? `<span>GSTIN: <strong>${escapeHtml(settings.gstin)}</strong></span>` : '<span>GSTIN: not provided</span>'}
              <span>State code: ${escapeHtml(settings.stateCode || '')}</span>
              ${settings.pan ? `<span>PAN: ${escapeHtml(settings.pan)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="pi-title-block">
          <div class="pi-doc-kicker">${invoice.status === 'void' ? 'Cancelled document' : 'Original for recipient'}</div>
          <div class="pi-doc-title">TAX INVOICE</div>
          <table class="pi-meta-table">
            <tr><td>Invoice no.</td><td><strong>${escapeHtml(invoice.invoiceNo)}</strong></td></tr>
            <tr><td>Invoice date</td><td>${dateText(invoice.invoiceDate)}</td></tr>
            <tr><td>Due date</td><td>${dateText(invoice.dueDate)}</td></tr>
            <tr><td>Place of supply</td><td>${escapeHtml(invoice.placeOfSupply)} (${escapeHtml(invoice.stateCode)})</td></tr>
          </table>
        </div>
      </header>

      <div class="pi-rule"></div>

      <section class="pi-parties">
        <div class="pi-party">
          <div class="pi-label">Billed to</div>
          <div class="pi-party-name">${escapeHtml(invoice.customerName)}</div>
          <div class="pi-party-lines">
            ${invoice.customerPhone ? `${escapeHtml(invoice.customerPhone)}<br>` : ''}
            ${gstin ? `GSTIN: <strong>${escapeHtml(gstin)}</strong><br>` : 'Unregistered / B2C<br>'}
            ${addressHtml(invoice.billingAddress)}
          </div>
        </div>
        <div class="pi-party">
          <div class="pi-label">Shipped to</div>
          <div class="pi-party-name">${escapeHtml(invoice.customerName)}</div>
          <div class="pi-party-lines">${addressHtml(invoice.shippingAddress || invoice.billingAddress)}</div>
        </div>
        <div class="pi-status">
          <div class="pi-status-row"><span>Payment</span><strong>${invoice.status === 'void' ? 'Cancelled' : invoice.paymentStatus === 'paid' ? 'Paid' : invoice.paymentStatus === 'partial' ? 'Part paid' : 'Unpaid'}</strong></div>
          <div class="pi-status-row"><span>Tax type</span><strong>${interState ? 'IGST · Inter-state' : 'CGST + SGST · Intra-state'}</strong></div>
          <div class="pi-status-row"><span>Reverse charge</span><strong>No</strong></div>
        </div>
      </section>

      <table class="pi-items">
        <thead>
          <tr>
            <th class="c-no">#</th>
            <th class="c-desc">Description of goods</th>
            <th class="c-hsn">HSN/SAC</th>
            <th class="c-qty">Qty</th>
            <th class="c-rate">Rate</th>
            <th class="c-disc">Disc.</th>
            <th class="c-taxable">Taxable</th>
            <th class="c-gst">GST</th>
            ${interState ? '<th class="c-igst">IGST</th>' : '<th class="c-cgst">CGST</th><th class="c-sgst">SGST</th>'}
            <th class="c-amount">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div class="pi-lower">
        <div class="pi-tax-summary">
          <div class="pi-section-title">Tax summary</div>
          <table class="pi-tax">
            <thead>
              <tr>
                <th>HSN/SAC</th>
                <th>Taxable</th>
                <th>Rate</th>
                ${interState ? '<th>IGST</th>' : '<th>CGST</th><th>SGST</th>'}
              </tr>
            </thead>
            <tbody>${taxRows}</tbody>
          </table>
          <div class="pi-tax-total">
            <span>Total tax</span>
            <strong>₹${money(invoice.cgst + invoice.sgst + invoice.igst)}</strong>
          </div>
        </div>
        <div class="pi-totals">
          <div class="pi-total-row"><span>Subtotal</span><span>₹${money(invoice.subtotal)}</span></div>
          ${invoice.discountTotal > 0 ? `<div class="pi-total-row"><span>Discount</span><span>− ₹${money(invoice.discountTotal)}</span></div>` : ''}
          <div class="pi-total-row"><span>Taxable value</span><span>₹${money(invoice.taxableTotal)}</span></div>
          ${interState
            ? `<div class="pi-total-row"><span>IGST</span><span>₹${money(invoice.igst)}</span></div>`
            : `<div class="pi-total-row"><span>CGST</span><span>₹${money(invoice.cgst)}</span></div>
               <div class="pi-total-row"><span>SGST</span><span>₹${money(invoice.sgst)}</span></div>`}
          ${Number(invoice.roundOff) !== 0 ? `<div class="pi-total-row"><span>Round off</span><span>${invoice.roundOff > 0 ? '+' : '−'} ₹${roundOffText(invoice.roundOff)}</span></div>` : ''}
          <div class="pi-total-row pi-grand"><span>Invoice total</span><span>₹${money(invoice.total)}</span></div>
          <div class="pi-total-row pi-paid"><span>Amount received</span><span>₹${money(invoice.amountPaid)}</span></div>
          <div class="pi-total-row pi-balance"><span>Balance due</span><span>₹${money(invoice.balance)}</span></div>
        </div>
      </div>

      <div class="pi-words">
        <span class="pi-label">Amount in words</span>
        <strong>${escapeHtml(amountInWords(invoice.total))}</strong>
      </div>

      <div class="pi-bottom">
        <div class="pi-bank">
          ${bank.length ? `<div class="pi-section-title">Payment details</div><div class="pi-bank-lines">${bank.map(escapeHtml).join('<br>')}</div>` : ''}
          ${invoice.notes ? `<div class="pi-note"><span class="pi-label">Note</span><div>${escapeHtml(invoice.notes)}</div></div>` : ''}
        </div>
        <div class="pi-sign">
          <div class="pi-sign-for">For ${escapeHtml(settings.showroomName)}</div>
          <div class="pi-sign-space"></div>
          <div class="pi-sign-line">Authorised signatory</div>
        </div>
      </div>

      ${terms ? `<div class="pi-terms"><div class="pi-section-title">Terms &amp; conditions</div><div class="pi-terms-text">${terms}</div></div>` : ''}

      <footer class="pi-foot">
        <span>${escapeHtml(settings.footerNote || 'Thank you for your business.')}</span>
        <span>This is a computer-generated tax invoice.</span>
      </footer>
    </article>
  `;
}

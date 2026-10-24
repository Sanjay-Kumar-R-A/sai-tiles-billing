import test from 'node:test';
import assert from 'node:assert/strict';
import { computeInvoice, computeLine, derivedRate } from '../shared/calc.js';
import { amountInWords } from '../shared/words.js';

test('intra-state GST splits tax into CGST and SGST', () => {
  const line = computeLine(
    { qty: 100, rate: 65, discountPct: 10, gstRate: 18, unit: 'sqft', sqftPerBox: 15.5 },
    true
  );
  assert.equal(line.gross, 6500);
  assert.equal(line.discount, 650);
  assert.equal(line.taxable, 5850);
  assert.equal(line.cgst, 526.5);
  assert.equal(line.sgst, 526.5);
  assert.equal(line.igst, 0);
  assert.equal(line.total, 6903);
});

test('inter-state GST applies IGST instead of CGST/SGST', () => {
  const line = computeLine(
    { qty: 10, rate: 100, discountPct: 0, gstRate: 18, unit: 'box', sqftPerBox: 0 },
    false
  );
  assert.equal(line.taxable, 1000);
  assert.equal(line.igst, 180);
  assert.equal(line.cgst, 0);
  assert.equal(line.sgst, 0);
  assert.equal(line.total, 1180);
  assert.equal(line.boxes, 10);
});

test('invoice totals aggregate tax, discount, packing area, and rupee rounding', () => {
  const result = computeInvoice(
    [
      { qty: 31, rate: 62, discountPct: 0, gstRate: 18, unit: 'sqft', sqftPerBox: 15.5 },
      { qty: 2, rate: 600, discountPct: 5, gstRate: 18, unit: 'box', sqftPerBox: 0 }
    ],
    { intraState: true, roundOff: true }
  );

  assert.equal(result.subtotal, 3122);
  assert.equal(result.discountTotal, 60);
  assert.equal(result.taxableTotal, 3062);
  assert.equal(result.cgst, 275.58);
  assert.equal(result.sgst, 275.58);
  assert.equal(result.preRoundTotal, 3613.16);
  assert.equal(result.total, 3613);
  assert.equal(result.roundOff, -0.16);
  assert.equal(result.areaTotal, 31);
  assert.equal(result.boxesTotal, 4);
});

test('without rounding the invoice keeps exact paise', () => {
  const result = computeInvoice(
    [{ qty: 1, rate: 100, discountPct: 0, gstRate: 18, unit: 'sqft', sqftPerBox: 0 }],
    { intraState: true, roundOff: false }
  );
  assert.equal(result.total, 118);
  assert.equal(result.roundOff, 0);
});

test('seller rates convert between square feet and boxes', () => {
  const sqftProduct = { sellUnit: 'sqft', price: 62, sqftPerBox: 15.5 };
  assert.equal(derivedRate(sqftProduct, 'sqft'), 62);
  assert.equal(derivedRate(sqftProduct, 'box'), 961);

  const boxProduct = { sellUnit: 'box', price: 1200, sqftPerBox: 12 };
  assert.equal(derivedRate(boxProduct, 'box'), 1200);
  assert.equal(derivedRate(boxProduct, 'sqft'), 100);
});

test('amount in words uses Indian numbering', () => {
  assert.equal(amountInWords(0), 'Rupees Zero Only');
  assert.equal(amountInWords(1234.5), 'Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only');
  assert.equal(amountInWords(100000), 'Rupees One Lakh Only');
  assert.equal(
    amountInWords(12345678.9),
    'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Paise Only'
  );
});

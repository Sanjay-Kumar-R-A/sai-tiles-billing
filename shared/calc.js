export const GST_RATES = [0, 5, 12, 18, 28];

export const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque'];

export function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

export function round3(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 1000) / 1000;
}

function normaliseLine(line) {
  const qty = Math.max(toNumber(line.qty), 0);
  const rate = Math.max(toNumber(line.rate), 0);
  const discountPct = Math.min(Math.max(toNumber(line.discountPct), 0), 100);
  const gstRate = Math.max(toNumber(line.gstRate), 0);
  const sqftPerBox = Math.max(toNumber(line.sqftPerBox), 0);
  const gross = round2(qty * rate);
  const discount = round2((gross * discountPct) / 100);
  const taxable = round2(gross - discount);
  const tax = round2((taxable * gstRate) / 100);
  const boxes = line.unit === 'sqft' ? (sqftPerBox > 0 ? round3(qty / sqftPerBox) : 0) : round3(qty);
  const areaSqft = line.unit === 'sqft' ? round2(qty) : round2(qty * sqftPerBox);

  return {
    ...line,
    qty,
    rate,
    discountPct,
    gstRate,
    sqftPerBox,
    gross,
    discount,
    taxable,
    tax,
    boxes,
    areaSqft
  };
}

export function computeLine(line, intraState = true) {
  const base = normaliseLine(line);
  const cgst = intraState ? round2(base.tax / 2) : 0;
  const sgst = intraState ? round2(base.tax - cgst) : 0;
  const igst = intraState ? 0 : base.tax;
  const total = round2(base.taxable + cgst + sgst + igst);

  return {
    ...base,
    cgst,
    sgst,
    igst,
    total
  };
}

export function computeInvoice(lines, { intraState = true, roundOff = true } = {}) {
  const computedLines = (lines ?? []).map((line) => computeLine(line, intraState));

  const sums = computedLines.reduce(
    (accumulator, line) => ({
      subtotal: accumulator.subtotal + line.gross,
      discountTotal: accumulator.discountTotal + line.discount,
      taxableTotal: accumulator.taxableTotal + line.taxable,
      cgstTotal: accumulator.cgstTotal + line.cgst,
      sgstTotal: accumulator.sgstTotal + line.sgst,
      igstTotal: accumulator.igstTotal + line.igst,
      areaTotal: accumulator.areaTotal + line.areaSqft,
      boxesTotal: accumulator.boxesTotal + line.boxes
    }),
    {
      subtotal: 0,
      discountTotal: 0,
      taxableTotal: 0,
      cgstTotal: 0,
      sgstTotal: 0,
      igstTotal: 0,
      areaTotal: 0,
      boxesTotal: 0
    }
  );

  const subtotal = round2(sums.subtotal);
  const discountTotal = round2(sums.discountTotal);
  const taxableTotal = round2(sums.taxableTotal);
  const cgst = round2(sums.cgstTotal);
  const sgst = round2(sums.sgstTotal);
  const igst = round2(sums.igstTotal);
  const preRoundTotal = round2(taxableTotal + cgst + sgst + igst);
  const total = roundOff ? Math.round(preRoundTotal) : preRoundTotal;
  const roundOffAmount = round2(total - preRoundTotal);

  return {
    lines: computedLines,
    subtotal,
    discountTotal,
    taxableTotal,
    cgst,
    sgst,
    igst,
    taxTotal: round2(cgst + sgst + igst),
    areaTotal: round2(sums.areaTotal),
    boxesTotal: round3(sums.boxesTotal),
    preRoundTotal,
    roundOff: roundOffAmount,
    total: round2(total)
  };
}

export function derivedRate(product, unit) {
  const price = toNumber(product.price);
  const sqftPerBox = toNumber(product.sqftPerBox);
  const baseUnit = product.sellUnit === 'box' ? 'box' : 'sqft';

  if (unit === baseUnit) return round2(price);
  if (unit === 'sqft') {
    return sqftPerBox > 0 ? round2(price / sqftPerBox) : 0;
  }
  if (unit === 'box') {
    return sqftPerBox > 0 ? round2(price * sqftPerBox) : 0;
  }
  return 0;
}

export function rateForProduct(product, unit) {
  return derivedRate(product, unit);
}

export function isIntraState(placeOfSupply, showroomState) {
  return String(placeOfSupply ?? '').trim().toLowerCase() === String(showroomState ?? '').trim().toLowerCase();
}

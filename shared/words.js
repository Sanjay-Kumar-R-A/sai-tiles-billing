const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen'
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitWords(number) {
  if (number < 20) return ONES[number];
  const tens = Math.floor(number / 10);
  const ones = number % 10;
  return `${TENS[tens]}${ones ? ` ${ONES[ones]}` : ''}`;
}

function threeDigitWords(number) {
  const hundreds = Math.floor(number / 100);
  const rest = number % 100;
  const parts = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigitWords(rest));
  return parts.join(' ');
}

function indianWords(number) {
  if (number === 0) return 'Zero';
  if (number < 0) return `Minus ${indianWords(Math.abs(number))}`;

  const parts = [];
  const crore = Math.floor(number / 10000000);
  const lakh = Math.floor((number % 10000000) / 100000);
  const thousand = Math.floor((number % 100000) / 1000);
  const rest = number % 1000;

  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitWords(thousand)} Thousand`);
  if (rest) parts.push(threeDigitWords(rest));

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function amountInWords(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return '';
  const totalPaise = Math.round(value * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  const rupeeWords = indianWords(rupees);
  if (!paise) return `Rupees ${rupeeWords} Only`;
  return `Rupees ${rupeeWords} and ${twoDigitWords(paise)} Paise Only`;
}

export function numberInWords(amount) {
  const value = Math.max(Math.floor(Number(amount) || 0), 0);
  return indianWords(value);
}

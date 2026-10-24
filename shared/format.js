const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatMoney(value, { decimals = 2, symbol = false } = {}) {
  const number = Number(value) || 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(number);
  return symbol ? `₹${formatted}` : formatted;
}

export function formatCompactMoney(value) {
  const number = Number(value) || 0;
  const absolute = Math.abs(number);
  if (absolute >= 10000000) return `₹${(number / 10000000).toFixed(2)} Cr`;
  if (absolute >= 100000) return `₹${(number / 100000).toFixed(2)} L`;
  if (absolute >= 1000) return `₹${(number / 1000).toFixed(1)}K`;
  return `₹${formatMoney(number, { decimals: 0 })}`;
}

export function formatQty(value, maxDecimals = 3) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: maxDecimals
  }).format(number);
}

export function formatDate(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return String(value);
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`;
}

export function formatLongDate(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function todayISO() {
  return localISO(new Date());
}

export function localISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysISO(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return localISO(date);
}

export function monthStartISO(value = todayISO()) {
  return `${value.slice(0, 7)}-01`;
}

export function financialYearStart(value = todayISO()) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-04-01`;
}

export function daysBetween(from, to = todayISO()) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

export function chunkDateSeries(from, to) {
  const result = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return result;
  while (cursor <= end && result.length < 400) {
    result.push(localISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

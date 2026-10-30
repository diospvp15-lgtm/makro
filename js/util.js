// Datums- und Zahlenhelfer. Datumswerte sind lokale Kalendertage im Format JJJJ-MM-TT.

export function todayStr() {
  return fmtDate(new Date());
}

export function fmtDate(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

// Anzahl Tage von a nach b (b − a), unabhängig von Zeitumstellungen.
export function dayDiff(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function weekday(s) {
  return parseDate(s).getDay();
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

export function labelDate(s, today = todayStr()) {
  const diff = dayDiff(today, s);
  if (diff === 0) return 'Heute';
  if (diff === -1) return 'Gestern';
  if (diff === 1) return 'Morgen';
  const d = parseDate(s);
  return `${WD[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
}

export function shortDate(s) {
  const d = parseDate(s);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

export function longDate(s) {
  const d = parseDate(s);
  return `${WD[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

// Akzeptiert „82,4“, „82.4“, „ 82 “; liefert null bei leerer oder ungültiger Eingabe.
export function parseNum(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/\s/g, '');
  if (s === '') return null;
  // „1.200“ oder „1.200,5“ als Tausendertrennung lesen, sonst Komma als Dezimalzeichen
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

export const fmt0 = (n) => nf0.format(Math.round(n));
export const fmt1 = (n) => nf1.format(n);
export const fmt2 = (n) => nf2.format(n);

export function fmtSigned(n, digits = 1) {
  const s = digits === 0 ? fmt0(Math.abs(n)) : nf1.format(Math.abs(n));
  if (Math.abs(n) < (digits === 0 ? 0.5 : 0.05)) return digits === 0 ? '±0' : '±0,0';
  return (n > 0 ? '+' : '−') + s;
}

// Zahl für Eingabefelder: ohne Tausenderpunkt, Komma als Dezimalzeichen
export function inputNum(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  const f = 10 ** digits;
  return String(Math.round(n * f) / f).replace('.', ',');
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Für die Suche: Kleinschreibung, Umlaute vereinheitlicht.
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

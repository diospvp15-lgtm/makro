// Datenhaltung im Browser (IndexedDB). Der gesamte Zustand liegt im Speicher;
// jede Sammlung wird nach Änderungen einzeln zurückgeschrieben.

const DB_NAME = 'makro';
const STORE = 'kv';
const KEYS = ['settings', 'foods', 'entries', 'days', 'weights', 'checkins'];

export const DEFAULT_SETTINGS = {
  onboarded: false,
  sex: 'm',
  birthYear: null,
  heightCm: null,
  activity: 1.375,
  startExpenditure: null,
  startWeight: null,
  goal: 'lose',
  rateKgPerWeek: 0.5,
  proteinPerKg: 2.0,
  fatShare: 0.3,
  minKcal: 1500,
  checkInWeekday: 1,
};

export const state = {
  settings: { ...DEFAULT_SETTINGS },
  foods: [],      // eigene, gescannte und bereits genutzte Lebensmittel
  entries: [],    // Einträge mit festgeschriebenen Nährwerten
  days: {},       // Datum → 'incomplete' | 'complete'
  weights: {},    // Datum → kg
  checkins: [],   // wöchentliche Ziele, nach Datum sortiert
};

let db;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    const out = fn(s);
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function load() {
  db = await open();
  const values = await Promise.all(KEYS.map((k) => tx('readonly', (s) => s.get(k))));
  KEYS.forEach((k, i) => {
    if (values[i] !== undefined) state[k] = values[i];
  });
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  // Dauerhaften Speicher anfragen, damit der Browser die Daten nicht von selbst räumt.
  try { await navigator.storage?.persist?.(); } catch {}
}

export function save(...keys) {
  return Promise.all(keys.map((k) => tx('readwrite', (s) => s.put(state[k], k))));
}

export function exportData() {
  const data = {};
  KEYS.forEach((k) => (data[k] = state[k]));
  return { app: 'makro', version: 1, exportedAt: new Date().toISOString(), data };
}

export async function importData(json) {
  if (!json || json.app !== 'makro' || !json.data) throw new Error('Das ist keine Sicherung dieser App.');
  for (const k of KEYS) {
    if (json.data[k] !== undefined) state[k] = json.data[k];
  }
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  await save(...KEYS);
}

export async function resetAll() {
  state.settings = { ...DEFAULT_SETTINGS };
  state.foods = [];
  state.entries = [];
  state.days = {};
  state.weights = {};
  state.checkins = [];
  await save(...KEYS);
}

export async function isPersisted() {
  try { return (await navigator.storage?.persisted?.()) ?? null; } catch { return null; }
}

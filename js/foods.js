// Grundlebensmittel und Open-Food-Facts-Anbindung.

import { norm } from './util.js';

// Die Grundliste enthält Richtwerte je 100 g (bei Getränken je 100 ml), von Claude aus
// allgemeinem Nährwertwissen zusammengestellt. Keine Herstellerangaben: Bei abweichender
// Packungsangabe die Packung scannen oder ein eigenes Lebensmittel anlegen.

// [Name, kcal, Eiweiß, Kohlenhydrate, Fett, Portionen als [Bezeichnung, Gramm], Einheit]
const BASIS_RAW = [
  ['Haferflocken', 372, 13.5, 58.7, 7, [['1 EL', 10]]],
  ['Reis, roh', 355, 7, 78, 0.6],
  ['Reis, gekocht', 130, 2.7, 28.2, 0.3],
  ['Nudeln, roh', 357, 12.5, 71, 1.8],
  ['Nudeln, gekocht', 155, 5.8, 31, 0.9],
  ['Couscous, roh', 360, 12, 72, 1.5],
  ['Kartoffeln, gekocht', 75, 2, 16.5, 0.1],
  ['Süßkartoffel, roh', 86, 1.6, 20, 0.1],
  ['Vollkornbrot', 210, 7, 38, 1.5, [['1 Scheibe', 45]]],
  ['Toastbrot', 260, 8, 48, 3.5, [['1 Scheibe', 25]]],
  ['Brötchen (Weizen)', 270, 9, 53, 1.5, [['1 Stück', 60]]],
  ['Weizen-Wrap', 305, 8.5, 50, 7.5, [['1 Stück', 62]]],
  ['Ei', 143, 12.6, 0.7, 9.5, [['1 Stück (M)', 55]]],
  ['Hähnchenbrust, roh', 108, 23.5, 0, 1.3],
  ['Putenbrust, roh', 105, 24, 0, 1],
  ['Rinderhack (ca. 20 % Fett), roh', 254, 17.2, 0, 20],
  ['Lachs, roh', 208, 20, 0, 13.4],
  ['Thunfisch im eigenen Saft, abgetropft', 110, 25.5, 0, 0.8, [['1 Dose', 140]]],
  ['Garnelen, roh', 75, 17, 0, 0.8],
  ['Kochschinken', 110, 20, 1, 3, [['1 Scheibe', 20]]],
  ['Salami', 390, 21, 0.5, 34, [['1 Scheibe', 8]]],
  ['Tofu natur', 125, 13.5, 1.5, 7.3],
  ['Magerquark', 67, 12, 4, 0.2],
  ['Skyr natur', 63, 11, 3.9, 0.2],
  ['Naturjoghurt 3,5 %', 64, 3.8, 4, 3.5],
  ['Hüttenkäse', 98, 12, 2.6, 4.3],
  ['Milch 1,5 %', 47, 3.4, 4.9, 1.5, [['1 Glas', 200]], 'ml'],
  ['Milch 3,5 %', 64, 3.3, 4.8, 3.5, [['1 Glas', 200]], 'ml'],
  ['Gouda', 356, 25, 0, 27.5, [['1 Scheibe', 25]]],
  ['Mozzarella', 245, 18, 1, 19, [['1 Kugel', 125]]],
  ['Feta', 265, 17, 0.7, 21.5],
  ['Frischkäse (Doppelrahmstufe)', 250, 5.5, 3.5, 24],
  ['Whey-Proteinpulver (Durchschnitt)', 390, 78, 6, 6, [['1 Messlöffel', 30]]],
  ['Olivenöl', 884, 0, 0, 100, [['1 EL', 10], ['1 TL', 4]]],
  ['Butter', 741, 0.7, 0.6, 82, [['1 TL', 5]]],
  ['Erdnussbutter', 600, 25, 13, 50, [['1 EL', 15]]],
  ['Mandeln', 600, 22, 6, 52, [['1 Handvoll', 25]]],
  ['Banane', 90, 1.1, 20, 0.2, [['1 Stück (geschält)', 120]]],
  ['Apfel', 54, 0.3, 12, 0.2, [['1 Stück', 150]]],
  ['Orange', 47, 1, 9, 0.2, [['1 Stück (geschält)', 140]]],
  ['Erdbeeren', 32, 0.7, 5.5, 0.4],
  ['Avocado', 160, 2, 2, 14.7, [['1 Stück (ohne Kern)', 140]]],
  ['Brokkoli', 34, 2.8, 4, 0.4],
  ['Tomate', 18, 0.9, 2.7, 0.2, [['1 Stück', 100]]],
  ['Gurke', 14, 0.6, 2.5, 0.1],
  ['Paprika, rot', 31, 1, 4.5, 0.3, [['1 Stück', 150]]],
  ['Blattsalat', 15, 1.3, 1.5, 0.2],
  ['Zwiebel', 40, 1.1, 7.6, 0.1, [['1 Stück', 80]]],
  ['Mais (Dose), abgetropft', 80, 2.9, 14, 1.2],
  ['Erbsen (TK)', 75, 5.5, 10.5, 0.4],
  ['Kichererbsen (Dose), abgetropft', 119, 7, 15, 2.6],
  ['Kidneybohnen (Dose), abgetropft', 100, 7, 13.5, 0.5],
  ['Rote Linsen, roh', 340, 24, 48, 1.5],
  ['Zucker', 400, 0, 100, 0, [['1 TL', 4]]],
  ['Honig', 320, 0.4, 80, 0, [['1 TL', 8]]],
  ['Ketchup', 105, 1.2, 23, 0.1, [['1 EL', 15]]],
  ['Mayonnaise (80 % Fett)', 720, 1, 1.5, 79, [['1 EL', 15]]],
  ['Zartbitterschokolade 70 %', 570, 9, 34, 41, [['1 Rippe', 10]]],
  ['Vollmilchschokolade', 535, 7, 57, 30, [['1 Rippe', 10]]],
  ['Pommes frites', 300, 3.4, 38, 15],
  ['Pizza Margherita (TK)', 240, 10, 28, 10],
  ['Cola', 42, 0, 10.6, 0, [['1 Dose', 330]], 'ml'],
  ['Orangensaft', 44, 0.7, 9.5, 0.2, [['1 Glas', 200]], 'ml'],
  ['Bier (Pils)', 42, 0.5, 3, 0, [['1 Flasche', 500]], 'ml'],
  ['Rotwein', 75, 0, 2.5, 0, [['1 Glas', 200]], 'ml'],
];

// Die ID hängt am Namen, damit gespeicherte Kopien auch nach Änderungen der Liste passen.
export const BASIS = BASIS_RAW.map(([name, kcal, p, c, f, portions = [], unit = 'g']) => ({
  id: 'b:' + norm(name).replace(/[^a-z0-9]+/g, '-'),
  name,
  brand: '',
  per100: { kcal, p, c, f },
  portions: portions.map(([label, g]) => ({ label, g })),
  unit,
  source: 'basis',
}));

const OFF = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_de,generic_name_de,brands,nutriments,serving_quantity,serving_size,quantity';

async function getJson(url, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(res.status >= 500 ? 'Open Food Facts ist gerade überlastet. Bitte gleich noch einmal versuchen.' : `Fehler ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Open Food Facts antwortet nicht. Internetverbindung prüfen.');
    if (e instanceof TypeError) throw new Error('Keine Verbindung zu Open Food Facts.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const num = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export function fromOff(p) {
  const n = p.nutriments || {};
  let kcal = num(n['energy-kcal_100g']);
  if (kcal === null && num(n.energy_100g) !== null) kcal = num(n.energy_100g) / 4.184;
  const name = (p.product_name_de || p.product_name || p.generic_name_de || '').trim();
  const qty = String(p.quantity || '').toLowerCase();
  const unit = /\d\s*(ml|cl|l)\b/.test(qty) ? 'ml' : 'g';
  const portions = [];
  const sq = num(p.serving_quantity);
  if (sq && sq > 0) portions.push({ label: p.serving_size ? String(p.serving_size).trim() : 'Portion', g: sq });
  return {
    name: name || 'Unbenanntes Produkt',
    brand: (p.brands || '').split(',')[0].trim(),
    barcode: p.code,
    per100: {
      kcal: kcal === null ? null : Math.round(kcal),
      p: num(n.proteins_100g) ?? 0,
      c: num(n.carbohydrates_100g) ?? 0,
      f: num(n.fat_100g) ?? 0,
    },
    portions,
    unit,
    source: 'off',
  };
}

// Liefert ein Lebensmittel, null (unbekannt) oder wirft einen Fehler mit verständlicher Meldung.
export async function lookupBarcode(code) {
  const j = await getJson(`${OFF}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  if (!j || j.status !== 1 || !j.product) return null;
  return fromOff(j.product);
}

export async function searchOff(query) {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '25',
    fields: FIELDS,
    lc: 'de',
    cc: 'de',
  });
  const url = `${OFF}/cgi/search.pl?${params}`;
  let j;
  try {
    j = await getJson(url, 15000);
  } catch (e) {
    // Die Suche ist auf wenige Anfragen pro Minute begrenzt; einmal kurz warten und erneut versuchen.
    await new Promise((r) => setTimeout(r, 2500));
    try {
      j = await getJson(url, 15000);
    } catch {
      throw new Error('Die Online-Suche ist gerade nicht erreichbar oder kurz gesperrt (nur wenige Suchen pro Minute). In einer Minute erneut versuchen – der Barcode-Scanner funktioniert unabhängig davon.');
    }
  }
  return (j?.products || []).map(fromOff).filter((f) => f.per100.kcal !== null);
}

export function macrosFor(food, grams) {
  const k = grams / 100;
  const p = food.per100;
  return { kcal: p.kcal * k, p: p.p * k, c: p.c * k, f: p.f * k };
}

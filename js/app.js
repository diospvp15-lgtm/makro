// Oberfläche: Heute, Eintragen, Fortschritt, Einstellungen, Einrichtung und Check-in.

import { state, load, save, exportData, importData, resetAll, isPersisted } from './store.js';
import {
  todayStr, addDays, dayDiff, labelDate, longDate, shortDate, parseNum, fmt0, fmt1, fmtSigned,
  inputNum, uid, esc, norm, WEEKDAYS_LONG,
} from './util.js';
import {
  trendSeries, trendAt, weeklyRate, expenditureSeries, computeTargets, nextCheckIn,
  priorExpenditure,
} from './algo.js';
import { BASIS, lookupBarcode, searchOff, macrosFor } from './foods.js';
import { startScan, stopScan } from './scanner.js';
import { lineChart } from './charts.js';

const MEALS = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'];
const MEALS_SHORT = ['Frühstück', 'Mittag', 'Abend', 'Snacks'];
const ACTIVITY = [
  [1.2, 'Kaum aktiv', 'Bürojob, wenig Bewegung'],
  [1.375, 'Leicht aktiv', 'etwas Alltagsbewegung oder 1–3× Training'],
  [1.55, 'Aktiv', 'viel auf den Beinen oder 3–5× Training'],
  [1.725, 'Sehr aktiv', 'körperliche Arbeit oder tägliches Training'],
];
const RATES = [[0.25, '0,25'], [0.5, '0,5'], [0.75, '0,75'], [1, '1,0']];
const COLORS = { p: 'var(--c-p)', c: 'var(--c-c)', f: 'var(--c-f)' };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ui = { view: 'heute', date: todayStr(), range: 90 };

// ---------- Abgeleitete Werte ----------

function entriesFor(date) {
  return state.entries.filter((e) => e.date === date).sort((a, b) => a.ts - b.ts);
}

function sum(list) {
  return list.reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 });
}

// Tage, die für die Verbrauchsschätzung zählen: Datum → kcal
function intakeMap() {
  const sums = {};
  for (const e of state.entries) sums[e.date] = (sums[e.date] || 0) + e.kcal;
  const out = {};
  for (const [d, k] of Object.entries(sums)) if (state.days[d] !== 'incomplete') out[d] = k;
  for (const [d, s] of Object.entries(state.days)) if (s === 'complete' && out[d] === undefined) out[d] = 0;
  return out;
}

function dayCounted(date) {
  const st = state.days[date];
  if (st) return st === 'complete';
  return state.entries.some((e) => e.date === date);
}

function model() {
  const today = todayStr();
  const intake = intakeMap();
  const tSeries = trendSeries(state.weights);
  const eSeries = expenditureSeries(intake, state.weights, state.settings, today);
  const expenditure = eSeries[eSeries.length - 1].est;
  return {
    today, intake, tSeries, eSeries, expenditure,
    conf: eSeries[eSeries.length - 1].conf,
    trend: trendAt(tSeries, today) ?? state.settings.startWeight,
  };
}

function activeCheckin(date) {
  let found = null;
  for (const c of state.checkins) if (c.date <= date) found = c;
  return found || state.checkins[0] || null;
}

function checkInDue(today = todayStr()) {
  const last = state.checkins[state.checkins.length - 1];
  if (!last) return false;
  return today >= nextCheckIn(last.date, state.settings.checkInWeekday);
}

function makeCheckin(m = model()) {
  const t = computeTargets(m.expenditure, m.trend, state.settings);
  return {
    date: m.today,
    expenditure: Math.round(m.expenditure),
    conf: m.conf,
    trendKg: Math.round(m.trend * 100) / 100,
    goal: state.settings.goal,
    rateKgPerWeek: state.settings.rateKgPerWeek,
    ...t,
  };
}

async function applyCheckin(c) {
  state.checkins = state.checkins.filter((x) => x.date !== c.date);
  state.checkins.push(c);
  state.checkins.sort((a, b) => (a.date < b.date ? -1 : 1));
  await save('checkins');
}

function defaultMeal() {
  const h = new Date().getHours();
  if (h < 11) return 0;
  if (h < 15) return 1;
  if (h < 17) return 3;
  if (h < 22) return 2;
  return 3;
}

// ---------- Lebensmittel ----------

function findFood(id) {
  return state.foods.find((f) => f.id === id) || BASIS.find((f) => f.id === id) || null;
}

function ensureStored(food) {
  let f = food.id ? state.foods.find((x) => x.id === food.id) : null;
  if (!f && food.barcode) f = state.foods.find((x) => x.barcode === food.barcode);
  if (f) return f;
  f = { ...structuredClone(food), id: food.id || uid(), uses: 0, lastUsed: 0, fav: false };
  state.foods.push(f);
  return f;
}

function searchLocal(q) {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  const storedIds = new Set(state.foods.map((f) => f.id));
  const pool = [...state.foods, ...BASIS.filter((b) => !storedIds.has(b.id))];
  const starts = (f) => (norm(f.name).startsWith(tokens[0]) ? 0 : 1);
  return pool
    .filter((f) => {
      const hay = norm(`${f.name} ${f.brand || ''}`);
      return tokens.every((t) => hay.includes(t));
    })
    .sort((a, b) => (b.uses || 0) - (a.uses || 0) || starts(a) - starts(b) || a.name.length - b.name.length)
    .slice(0, 40);
}

function recentFoods() {
  return state.foods.filter((f) => f.lastUsed).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 20);
}

function unitOf(food) {
  return food.unit || 'g';
}

function foodRow(food, attrs, sub) {
  const u = unitOf(food);
  const subText = sub ?? `${food.brand ? esc(food.brand) + ' · ' : ''}${fmt0(food.per100.kcal)} kcal / 100 ${u}`;
  return `<button class="row food-row" ${attrs}>
    <span class="row-main"><span class="row-title">${food.fav ? '<span class="star" aria-label="Favorit">★</span> ' : ''}${esc(food.name)}</span>
    <span class="row-sub">${subText}</span></span>
    <span class="row-end" aria-hidden="true">›</span></button>`;
}

// ---------- Kleine Helfer ----------

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2400);
}

function macroLine(m) {
  return `E ${fmt0(m.p)} g · K ${fmt0(m.c)} g · F ${fmt0(m.f)} g`;
}

function chips(name, options, current) {
  return `<div class="chips" role="radiogroup">${options
    .map(([val, label]) => `<button type="button" class="chip" role="radio" aria-checked="${String(val) === String(current)}" data-${name}="${val}">${label}</button>`)
    .join('')}</div>`;
}

function rateLabel(r) {
  return `${inputNum(r, 2)} kg/Woche`;
}

function goalText(s) {
  if (s.goal === 'maintain') return 'Gewicht halten';
  return `${s.goal === 'lose' ? 'Abnehmen' : 'Zunehmen'}, ${rateLabel(s.rateKgPerWeek)}`;
}

// ---------- Overlay mit Bildschirmstapel ----------

const sheet = {
  stack: [],
  get el() { return $('#sheet'); },
  open(screen) {
    this.stack.forEach((s) => s.cleanup?.());
    this.stack = [screen];
    this.el.hidden = false;
    document.body.classList.add('sheet-open');
    this.render();
  },
  push(screen) {
    this.stack.push(screen);
    this.render();
  },
  pop(n = 1) {
    for (let i = 0; i < n; i++) this.stack.pop()?.cleanup?.();
    if (!this.stack.length) return this.close();
    this.render();
  },
  popTo(screen) {
    while (this.stack.length && this.stack[this.stack.length - 1] !== screen) this.stack.pop()?.cleanup?.();
    if (!this.stack.length) return this.close();
    this.render();
  },
  close() {
    this.stack.forEach((s) => s.cleanup?.());
    this.stack = [];
    this.el.hidden = true;
    this.el.innerHTML = '';
    document.body.classList.remove('sheet-open');
    render();
  },
  render() {
    const s = this.stack[this.stack.length - 1];
    this.el.innerHTML = `<div class="sheet-head">
        <button class="link head-btn" data-back>${this.stack.length > 1 ? '‹ Zurück' : 'Schließen'}</button>
        <h2>${esc(s.title)}</h2><span class="head-btn"></span></div>
      <div class="sheet-body"></div>`;
    $('[data-back]', this.el).onclick = () => this.pop();
    const body = $('.sheet-body', this.el);
    s.render(body);
    body.scrollTop = 0;
  },
};

// ---------- Eintragen ----------

function pickerScreen(ctx) {
  let offResults = null;
  let offState = '';
  let query = ctx.query || '';
  return {
    title: ctx.mode === 'recipe' ? 'Zutat wählen' : 'Eintragen',
    render(body) {
      body.innerHTML = `
        ${ctx.mode === 'log' ? `<div class="meal-chips">${chips('meal', MEALS_SHORT.map((m, i) => [i, m]), ctx.meal)}</div>` : ''}
        <div class="search-row">
          <input type="search" id="q" placeholder="Lebensmittel suchen" value="${esc(query)}" autocomplete="off" enterkeyhint="search" aria-label="Lebensmittel suchen">
          <button class="btn primary scan-btn" id="scan" aria-label="Barcode scannen">${ICON_SCAN}<span>Scannen</span></button>
        </div>
        <div id="results"></div>
        ${ctx.mode === 'log' ? `<div class="quick-actions">
          <button class="btn" id="quick">Nur Kalorien</button>
          <button class="btn" id="newfood">Neues Lebensmittel</button>
          <button class="btn" id="recipe">Rezept</button>
        </div>` : ''}`;
      const results = $('#results', body);
      const q = $('#q', body);

      const draw = () => {
        query = q.value.trim();
        ctx.query = query;
        let html = '';
        if (!query) {
          const favs = state.foods.filter((f) => f.fav);
          const rec = recentFoods();
          if (favs.length) html += `<h3 class="list-head">Favoriten</h3><div class="list">${favs.map((f) => foodRow(f, `data-id="${f.id}"`)).join('')}</div>`;
          if (rec.length) {
            html += `<h3 class="list-head">Zuletzt verwendet</h3><div class="list">${rec
              .map((f) => foodRow(f, `data-id="${f.id}"`, `${f.lastGrams ? `zuletzt ${inputNum(f.lastGrams)} ${unitOf(f)} · ` : ''}${fmt0(f.per100.kcal)} kcal / 100 ${unitOf(f)}`))
              .join('')}</div>`;
          }
          if (!favs.length && !rec.length) html += `<p class="muted empty">Suche ein Lebensmittel oder scanne einen Barcode. Was du einmal einträgst, erscheint hier für den nächsten Mal.</p>`;
        } else {
          const local = searchLocal(query);
          html += local.length
            ? `<div class="list">${local.map((f) => foodRow(f, `data-id="${f.id}"`)).join('')}</div>`
            : `<p class="muted empty">Nichts in deinen Lebensmitteln gefunden.</p>`;
          html += `<h3 class="list-head">Open Food Facts</h3>`;
          if (offState === 'loading') html += `<p class="muted status">Suche läuft …</p>`;
          else if (offState && offState !== 'done') html += `<p class="error">${esc(offState)}</p><button class="btn block" id="offsearch">Erneut versuchen</button>`;
          else if (offResults) {
            html += offResults.length
              ? `<div class="list">${offResults.map((f, i) => foodRow(f, `data-off="${i}"`)).join('')}</div>`
              : `<p class="muted empty">Keine Treffer bei Open Food Facts.</p>`;
          } else html += `<button class="btn block" id="offsearch">„${esc(query)}“ online suchen</button>`;
        }
        results.innerHTML = html;
        $$('[data-id]', results).forEach((b) => (b.onclick = () => sheet.push(amountScreen(ctx, findFood(b.dataset.id)))));
        $$('[data-off]', results).forEach((b) => (b.onclick = () => sheet.push(amountScreen(ctx, offResults[Number(b.dataset.off)]))));
        const os = $('#offsearch', results);
        if (os) os.onclick = runOff;
      };

      const runOff = async () => {
        const term = query;
        offState = 'loading';
        draw();
        try {
          offResults = await searchOff(term);
          offState = 'done';
        } catch (e) {
          offResults = null;
          offState = e.message;
        }
        if (term === query) draw();
      };

      let timer;
      q.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => { offResults = null; offState = ''; draw(); }, 120);
      });
      q.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && q.value.trim()) { e.preventDefault(); query = q.value.trim(); runOff(); q.blur(); }
      });
      $$('[data-meal]', body).forEach((b) => (b.onclick = () => {
        ctx.meal = Number(b.dataset.meal);
        $$('[data-meal]', body).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      }));
      $('#scan', body).onclick = () => sheet.push(scanScreen(ctx));
      if (ctx.mode === 'log') {
        $('#quick', body).onclick = () => sheet.push(quickScreen(ctx));
        $('#newfood', body).onclick = () => sheet.push(foodFormScreen(ctx, { name: query }));
        $('#recipe', body).onclick = () => sheet.push(recipeScreen(ctx));
      }
      draw();
    },
  };
}

function amountScreen(ctx, food, opts = {}) {
  const entry = opts.entry;
  let grams = entry?.grams ?? opts.grams ?? food.lastGrams ?? food.portions?.[0]?.g ?? 100;
  let meal = entry?.meal ?? ctx.meal;
  return {
    title: entry ? 'Eintrag bearbeiten' : ctx.mode === 'recipe' ? 'Menge' : 'Menge',
    render(body) {
      const u = unitOf(food);
      const p = food.per100;
      const src = { basis: 'Richtwert', off: 'Open Food Facts', eigen: 'eigenes Lebensmittel', rezept: 'Rezept' }[food.source] || '';
      const stored = state.foods.find((f) => f.id === food.id);
      const portionChips = [...(food.portions || []).map((pt) => [pt.g, `${esc(pt.label)} · ${inputNum(pt.g)} ${u}`]), [100, `100 ${u}`]];
      body.innerHTML = `
        <div class="food-head">
          <h3>${esc(food.name)}</h3>
          <p class="muted small">${food.brand ? esc(food.brand) + ' · ' : ''}${src}</p>
          <p class="small">Je 100 ${u}: <b>${fmt0(p.kcal)} kcal</b> · E ${fmt1(p.p)} g · K ${fmt1(p.c)} g · F ${fmt1(p.f)} g</p>
        </div>
        ${ctx.mode === 'log' ? `<div class="field"><span class="label">Mahlzeit</span>${chips('meal', MEALS_SHORT.map((m, i) => [i, m]), meal)}</div>` : ''}
        <label class="field">
          <span class="label">Menge</span>
          <span class="input-unit big"><input id="amt" inputmode="decimal" value="${inputNum(grams)}" aria-label="Menge in ${u}"><span>${u}</span></span>
        </label>
        <div class="chips portion-chips">${portionChips.map(([g, l]) => `<button type="button" class="chip" data-g="${g}">${l}</button>`).join('')}</div>
        <div class="result" aria-live="polite">
          <div class="result-kcal"><b id="r-kcal">0</b> kcal</div>
          <div class="result-macros">
            <span><i class="sw" style="--c:${COLORS.p}"></i>Eiweiß <b id="r-p">0</b> g</span>
            <span><i class="sw" style="--c:${COLORS.c}"></i>Kohlenhydrate <b id="r-c">0</b> g</span>
            <span><i class="sw" style="--c:${COLORS.f}"></i>Fett <b id="r-f">0</b> g</span>
          </div>
        </div>
        <p class="error" id="amt-err" hidden></p>
        <button class="btn primary block big" id="ok">${entry ? 'Speichern' : ctx.mode === 'recipe' ? 'Zum Rezept hinzufügen' : 'Hinzufügen'}</button>
        ${entry ? '<button class="btn ghost-danger block" id="del">Eintrag löschen</button>' : ''}
        <div class="row-links">
          ${ctx.mode === 'log' ? `<button class="link" id="fav">${stored?.fav ? '★ Favorit' : '☆ Als Favorit merken'}</button>` : ''}
          ${['eigen', 'off', 'rezept'].includes(food.source) && stored ? '<button class="link" id="editfood">Lebensmittel bearbeiten</button>' : ''}
        </div>`;
      const amt = $('#amt', body);
      const update = () => {
        const g = parseNum(amt.value);
        const m = macrosFor(food, g && g > 0 ? g : 0);
        $('#r-kcal', body).textContent = fmt0(m.kcal);
        $('#r-p', body).textContent = fmt0(m.p);
        $('#r-c', body).textContent = fmt0(m.c);
        $('#r-f', body).textContent = fmt0(m.f);
      };
      amt.addEventListener('input', update);
      amt.addEventListener('focus', () => amt.select());
      amt.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#ok', body).click(); });
      $$('[data-g]', body).forEach((b) => (b.onclick = () => { amt.value = inputNum(Number(b.dataset.g)); update(); }));
      $$('[data-meal]', body).forEach((b) => (b.onclick = () => {
        meal = Number(b.dataset.meal);
        $$('[data-meal]', body).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      }));
      update();

      $('#ok', body).onclick = async () => {
        const g = parseNum(amt.value);
        if (!g || g <= 0) {
          const err = $('#amt-err', body);
          err.textContent = `Bitte eine Menge in ${u} eingeben, zum Beispiel 150.`;
          err.hidden = false;
          amt.focus();
          return;
        }
        grams = g;
        if (ctx.mode === 'recipe') {
          ctx.onPick(food, g);
          return;
        }
        const f = ensureStored(food);
        f.lastUsed = Date.now();
        f.uses = (f.uses || 0) + (entry ? 0 : 1);
        f.lastGrams = g;
        const m = macrosFor(f, g);
        const data = { date: entry?.date ?? ctx.date, meal, foodId: f.id, name: f.name, brand: f.brand || '', grams: g, unit: u, ...m };
        if (entry) Object.assign(entry, data);
        else state.entries.push({ id: uid(), ts: Date.now(), ...data });
        await save('foods', 'entries');
        sheet.close();
        toast(entry ? 'Gespeichert' : `Eingetragen: ${inputNum(g)} ${u} ${f.name}`);
      };
      const del = $('#del', body);
      if (del) del.onclick = async () => {
        state.entries = state.entries.filter((e) => e.id !== entry.id);
        await save('entries');
        sheet.close();
        toast('Eintrag gelöscht');
      };
      const fav = $('#fav', body);
      if (fav) fav.onclick = async () => {
        const f = ensureStored(food);
        f.fav = !f.fav;
        await save('foods');
        fav.textContent = f.fav ? '★ Favorit' : '☆ Als Favorit merken';
      };
      const ef = $('#editfood', body);
      if (ef) ef.onclick = () => {
        if (food.source === 'rezept') sheet.push(recipeScreen(ctx, stored));
        else sheet.push(foodFormScreen(ctx, stored, { editing: true }));
      };
    },
  };
}

function scanScreen(ctx) {
  let busy = false;
  return {
    title: 'Barcode scannen',
    cleanup() { stopScan(); },
    render(body) {
      body.innerHTML = `
        <div class="scan-box"><video id="cam" playsinline muted></video><div class="scan-frame" aria-hidden="true"></div></div>
        <p class="muted small center" id="scan-status">Kamera wird gestartet …</p>
        <form class="search-row" id="manual">
          <input id="code" inputmode="numeric" placeholder="Barcode eintippen" aria-label="Barcode eintippen" autocomplete="off">
          <button class="btn">Suchen</button>
        </form>`;
      const status = $('#scan-status', body);
      const handle = async (code) => {
        if (busy) return;
        busy = true;
        stopScan();
        status.textContent = `Barcode ${code} – suche Produkt …`;
        status.classList.remove('error');
        const local = state.foods.find((f) => f.barcode === code);
        if (local) { sheet.stack.pop(); sheet.push(amountScreen(ctx, local)); return; }
        try {
          const food = await lookupBarcode(code);
          if (food && food.per100.kcal !== null) {
            const stored = ensureStored(food);
            await save('foods');
            sheet.stack.pop();
            sheet.push(amountScreen(ctx, stored));
          } else {
            sheet.stack.pop();
            sheet.push(foodFormScreen(ctx, { barcode: code, name: food?.name === 'Unbenanntes Produkt' ? '' : food?.name || '', brand: food?.brand || '' }, {
              note: food ? 'Für dieses Produkt fehlen die Kalorien bei Open Food Facts. Bitte die Werte von der Packung eintragen.' : 'Produkt nicht gefunden. Trag die Werte von der Packung ein – beim nächsten Scan ist es dann gespeichert.',
            }));
          }
        } catch (e) {
          busy = false;
          status.textContent = e.message;
          status.classList.add('error');
        }
      };
      $('#manual', body).onsubmit = (e) => {
        e.preventDefault();
        const code = $('#code', body).value.replace(/\D/g, '');
        if (code.length >= 8) handle(code);
        else { status.textContent = 'Ein Barcode hat mindestens 8 Ziffern.'; status.classList.add('error'); }
      };
      startScan($('#cam', body), handle)
        .then(() => { if (!busy) status.textContent = 'Barcode in den Rahmen halten.'; })
        .catch((e) => { status.textContent = e.message; status.classList.add('error'); });
    },
  };
}

function quickScreen(ctx, entry) {
  return {
    title: entry ? 'Eintrag bearbeiten' : 'Nur Kalorien',
    render(body) {
      let meal = entry?.meal ?? ctx.meal;
      body.innerHTML = `
        <form id="f" novalidate>
          <div class="field"><span class="label">Mahlzeit</span>${chips('meal', MEALS_SHORT.map((m, i) => [i, m]), meal)}</div>
          <label class="field"><span class="label">Bezeichnung (optional)</span><input name="name" value="${esc(entry?.name || '')}" placeholder="z. B. Döner beim Imbiss"></label>
          <label class="field"><span class="label">Kalorien</span><span class="input-unit big"><input name="kcal" inputmode="decimal" value="${entry ? inputNum(entry.kcal, 0) : ''}" required><span>kcal</span></span></label>
          <div class="grid3">
            <label class="field"><span class="label">Eiweiß</span><span class="input-unit"><input name="p" inputmode="decimal" value="${entry ? inputNum(entry.p) : ''}"><span>g</span></span></label>
            <label class="field"><span class="label">Kohlenh.</span><span class="input-unit"><input name="c" inputmode="decimal" value="${entry ? inputNum(entry.c) : ''}"><span>g</span></span></label>
            <label class="field"><span class="label">Fett</span><span class="input-unit"><input name="f" inputmode="decimal" value="${entry ? inputNum(entry.f) : ''}"><span>g</span></span></label>
          </div>
          <p class="error" id="err" hidden></p>
          <button class="btn primary block big">${entry ? 'Speichern' : 'Hinzufügen'}</button>
          ${entry ? '<button type="button" class="btn ghost-danger block" id="del">Eintrag löschen</button>' : ''}
        </form>`;
      $$('[data-meal]', body).forEach((b) => (b.onclick = () => {
        meal = Number(b.dataset.meal);
        $$('[data-meal]', body).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      }));
      const form = $('#f', body);
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const kcal = parseNum(fd.get('kcal'));
        if (kcal === null || kcal < 0) {
          const err = $('#err', body);
          err.textContent = 'Bitte die Kalorien als Zahl eingeben.';
          err.hidden = false;
          return;
        }
        const data = {
          date: entry?.date ?? ctx.date, meal, foodId: null,
          name: String(fd.get('name') || '').trim() || 'Schnelleintrag', brand: '', grams: null, unit: '',
          kcal, p: parseNum(fd.get('p')) || 0, c: parseNum(fd.get('c')) || 0, f: parseNum(fd.get('f')) || 0,
        };
        if (entry) Object.assign(entry, data);
        else state.entries.push({ id: uid(), ts: Date.now(), ...data });
        await save('entries');
        sheet.close();
        toast(entry ? 'Gespeichert' : `Eingetragen: ${fmt0(kcal)} kcal`);
      };
      const del = $('#del', body);
      if (del) del.onclick = async () => {
        state.entries = state.entries.filter((x) => x.id !== entry.id);
        await save('entries');
        sheet.close();
        toast('Eintrag gelöscht');
      };
    },
  };
}

function foodFormScreen(ctx, food = {}, opts = {}) {
  return {
    title: opts.editing ? 'Lebensmittel bearbeiten' : 'Neues Lebensmittel',
    render(body) {
      const p = food.per100 || {};
      const pt = food.portions?.[0];
      body.innerHTML = `
        ${opts.note ? `<p class="note">${esc(opts.note)}</p>` : ''}
        <form id="f" novalidate>
          <label class="field"><span class="label">Name</span><input name="name" value="${esc(food.name || '')}" required></label>
          <label class="field"><span class="label">Marke (optional)</span><input name="brand" value="${esc(food.brand || '')}"></label>
          <div class="field"><span class="label">Angaben je</span>${chips('unit', [['g', '100 g'], ['ml', '100 ml']], food.unit || 'g')}</div>
          <label class="field"><span class="label">Kalorien</span><span class="input-unit big"><input name="kcal" inputmode="decimal" value="${inputNum(p.kcal, 0)}"><span>kcal</span></span></label>
          <div class="grid3">
            <label class="field"><span class="label">Eiweiß</span><span class="input-unit"><input name="p" inputmode="decimal" value="${inputNum(p.p)}"><span>g</span></span></label>
            <label class="field"><span class="label">Kohlenh.</span><span class="input-unit"><input name="c" inputmode="decimal" value="${inputNum(p.c)}"><span>g</span></span></label>
            <label class="field"><span class="label">Fett</span><span class="input-unit"><input name="f" inputmode="decimal" value="${inputNum(p.f)}"><span>g</span></span></label>
          </div>
          <div class="grid2">
            <label class="field"><span class="label">Portion (optional)</span><input name="plabel" value="${esc(pt?.label || '')}" placeholder="z. B. 1 Becher"></label>
            <label class="field"><span class="label">Portionsgröße</span><span class="input-unit"><input name="pg" inputmode="decimal" value="${inputNum(pt?.g)}"><span class="unit-lbl">${food.unit || 'g'}</span></span></label>
          </div>
          <label class="field"><span class="label">Barcode (optional)</span><input name="barcode" inputmode="numeric" value="${esc(food.barcode || '')}"></label>
          <p class="error" id="err" hidden></p>
          <p class="note" id="warn" hidden></p>
          <button class="btn primary block big">${opts.editing ? 'Speichern' : 'Speichern und weiter'}</button>
          ${opts.editing ? '<button type="button" class="btn ghost-danger block" id="del">Lebensmittel löschen</button>' : ''}
        </form>`;
      let unit = food.unit || 'g';
      $$('[data-unit]', body).forEach((b) => (b.onclick = () => {
        unit = b.dataset.unit;
        $$('[data-unit]', body).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        $('.unit-lbl', body).textContent = unit;
      }));
      const form = $('#f', body);
      let warned = false;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const err = $('#err', body);
        const name = String(fd.get('name') || '').trim();
        const kcal = parseNum(fd.get('kcal'));
        const pp = parseNum(fd.get('p')) || 0, cc = parseNum(fd.get('c')) || 0, ff = parseNum(fd.get('f')) || 0;
        if (!name) { err.textContent = 'Bitte einen Namen eingeben.'; err.hidden = false; return; }
        if (kcal === null || kcal < 0) { err.textContent = 'Bitte die Kalorien je 100 g eingeben.'; err.hidden = false; return; }
        err.hidden = true;
        const calc = pp * 4 + cc * 4 + ff * 9;
        if (!warned && calc > 0 && Math.abs(calc - kcal) > Math.max(40, kcal * 0.25)) {
          warned = true;
          const w = $('#warn', body);
          w.textContent = `Aus den Makros ergeben sich etwa ${fmt0(calc)} kcal statt ${fmt0(kcal)}. Bitte kurz prüfen – erneut tippen speichert trotzdem.`;
          w.hidden = false;
          return;
        }
        const pg = parseNum(fd.get('pg'));
        const plabel = String(fd.get('plabel') || '').trim();
        const data = {
          name, brand: String(fd.get('brand') || '').trim(), barcode: String(fd.get('barcode') || '').replace(/\D/g, '') || undefined,
          unit, per100: { kcal, p: pp, c: cc, f: ff },
          portions: pg && pg > 0 ? [{ label: plabel || 'Portion', g: pg }] : [],
        };
        let saved;
        if (opts.editing) {
          Object.assign(food, data);
          saved = food;
        } else {
          saved = { id: uid(), source: 'eigen', uses: 0, lastUsed: 0, fav: false, ...data };
          state.foods.push(saved);
        }
        await save('foods');
        sheet.stack.pop();
        if (opts.editing) {
          // vorherigen Mengen-Bildschirm mit aktualisierten Werten ersetzen
          sheet.stack.pop();
          sheet.push(amountScreen(ctx, saved));
        } else sheet.push(amountScreen(ctx, saved));
        toast('Lebensmittel gespeichert');
      };
      const del = $('#del', body);
      if (del) del.onclick = async () => {
        if (!confirm(`„${food.name}“ löschen? Bisherige Einträge bleiben erhalten.`)) return;
        state.foods = state.foods.filter((f) => f.id !== food.id);
        await save('foods');
        sheet.pop(2);
        toast('Lebensmittel gelöscht');
      };
    },
  };
}

function recipeScreen(ctx, recipe) {
  const draft = {
    name: recipe?.name || '',
    items: structuredClone(recipe?.ingredients || []),
    totalG: recipe?.totalG ?? null,
    servings: recipe?.servings ?? 1,
  };
  const screen = {
    title: recipe ? 'Rezept bearbeiten' : 'Neues Rezept',
    render(body) {
      const raw = draft.items.reduce((a, it) => a + it.grams, 0);
      const tot = sum(draft.items.map((it) => macrosFor(it, it.grams)));
      body.innerHTML = `
        <form id="f" novalidate>
          <label class="field"><span class="label">Name</span><input name="name" value="${esc(draft.name)}" placeholder="z. B. Chili con Carne"></label>
          <h3 class="list-head">Zutaten</h3>
          <div class="list">${draft.items.length ? draft.items.map((it, i) => `
            <div class="row"><span class="row-main"><span class="row-title">${esc(it.name)}</span>
            <span class="row-sub">${inputNum(it.grams)} ${it.unit || 'g'} · ${fmt0(macrosFor(it, it.grams).kcal)} kcal</span></span>
            <button type="button" class="icon-btn" data-rm="${i}" aria-label="${esc(it.name)} entfernen">✕</button></div>`).join('') : '<p class="muted empty">Noch keine Zutaten.</p>'}</div>
          <button type="button" class="btn block" id="add">+ Zutat hinzufügen</button>
          <div class="grid2">
            <label class="field"><span class="label">Gewicht fertig (optional)</span><span class="input-unit"><input name="total" inputmode="decimal" value="${inputNum(draft.totalG)}" placeholder="${inputNum(raw)}"><span>g</span></span></label>
            <label class="field"><span class="label">Portionen</span><input name="serv" inputmode="numeric" value="${draft.servings}"></label>
          </div>
          <p class="muted small">Gesamt: ${fmt0(tot.kcal)} kcal · ${macroLine(tot)}. Wenn du das fertige Gericht wiegst, wird pro Gramm genau gerechnet.</p>
          <p class="error" id="err" hidden></p>
          <button class="btn primary block big">Rezept speichern</button>
        </form>`;
      const form = $('#f', body);
      const keep = () => {
        const fd = new FormData(form);
        draft.name = String(fd.get('name') || '');
        draft.totalG = parseNum(fd.get('total'));
        draft.servings = Math.max(1, Math.round(parseNum(fd.get('serv')) || 1));
      };
      $$('[data-rm]', body).forEach((b) => (b.onclick = () => { keep(); draft.items.splice(Number(b.dataset.rm), 1); screen.render(body); }));
      $('#add', body).onclick = () => {
        keep();
        sheet.push(pickerScreen({
          mode: 'recipe',
          onPick(food, grams) {
            draft.items.push({ foodId: food.id, name: food.name, unit: unitOf(food), grams, per100: { ...food.per100 } });
            sheet.popTo(screen);
          },
        }));
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        keep();
        const err = $('#err', body);
        if (!draft.name.trim()) { err.textContent = 'Bitte dem Rezept einen Namen geben.'; err.hidden = false; return; }
        if (!draft.items.length) { err.textContent = 'Bitte mindestens eine Zutat hinzufügen.'; err.hidden = false; return; }
        const rawG = draft.items.reduce((a, it) => a + it.grams, 0);
        const total = draft.totalG && draft.totalG > 0 ? draft.totalG : rawG;
        const t = sum(draft.items.map((it) => macrosFor(it, it.grams)));
        const per100 = { kcal: (t.kcal / total) * 100, p: (t.p / total) * 100, c: (t.c / total) * 100, f: (t.f / total) * 100 };
        const data = {
          name: draft.name.trim(), brand: '', unit: 'g', per100, ingredients: draft.items, totalG: draft.totalG, servings: draft.servings,
          portions: [{ label: draft.servings > 1 ? `1 Portion (1/${draft.servings})` : 'Ganzes Rezept', g: Math.round(total / draft.servings) }],
        };
        let saved;
        if (recipe) { Object.assign(recipe, data); saved = recipe; }
        else { saved = { id: uid(), source: 'rezept', uses: 0, lastUsed: 0, fav: false, ...data }; state.foods.push(saved); }
        await save('foods');
        const idx = sheet.stack.indexOf(screen);
        sheet.stack.splice(idx);
        if (recipe && sheet.stack.length) sheet.stack.pop();
        sheet.push(amountScreen({ ...ctx, mode: 'log' }, saved, { grams: saved.portions[0].g }));
        toast('Rezept gespeichert');
      };
    },
  };
  return screen;
}

function openAdd(meal = ui.date === todayStr() ? defaultMeal() : 0) {
  sheet.open(pickerScreen({ mode: 'log', date: ui.date, meal }));
}

function openEntry(entry) {
  const ctx = { mode: 'log', date: entry.date, meal: entry.meal };
  const food = entry.foodId ? findFood(entry.foodId) : null;
  sheet.open(food ? amountScreen(ctx, food, { entry }) : quickScreen(ctx, entry));
}

// ---------- Check-in ----------

function checkinScreen() {
  return {
    title: 'Check-in',
    render(body) {
      const m = model();
      const c = makeCheckin(m);
      const prev = state.checkins[state.checkins.length - 1];
      const dExp = prev ? c.expenditure - prev.expenditure : null;
      const dKg = prev ? c.trendKg - prev.trendKg : null;
      body.innerHTML = `
        <div class="ci-block">
          <div class="ci-row"><span>Geschätzter Verbrauch</span><b>${fmt0(c.expenditure)} kcal</b></div>
          ${prev ? `<p class="muted small">Letzter Check-in (${shortDate(prev.date)}): ${fmt0(prev.expenditure)} kcal, ${fmtSigned(dExp, 0)} kcal</p>` : ''}
          ${c.conf < 1 ? `<p class="note small">Kalibrierung ${fmt0(c.conf * 100)} %: Die Schätzung stützt sich teilweise noch auf den Startwert. Mit etwa drei Wochen vollständiger Einträge und regelmäßigem Wiegen wird sie genau.</p>` : ''}
        </div>
        <div class="ci-block">
          <div class="ci-row"><span>Trendgewicht</span><b>${fmt1(c.trendKg)} kg</b></div>
          ${prev ? `<p class="muted small">${fmtSigned(dKg)} kg seit dem letzten Check-in</p>` : ''}
        </div>
        <div class="ci-block">
          <div class="ci-row"><span>Dein Ziel</span><b>${goalText(state.settings)}</b></div>
          <button class="link small" id="toset">In den Einstellungen ändern</button>
        </div>
        <div class="ci-targets">
          <p class="label">Neue Tagesziele</p>
          <p class="ci-kcal"><b>${fmt0(c.kcal)}</b> kcal</p>
          <p>Eiweiß ${c.protein} g · Kohlenhydrate ${c.carbs} g · Fett ${c.fat} g</p>
          ${c.floored ? `<p class="note small">Auf deine Untergrenze von ${fmt0(state.settings.minKcal)} kcal angehoben. Das gewünschte Tempo wird damit vermutlich nicht ganz erreicht.</p>` : ''}
        </div>
        <button class="btn primary block big" id="ok">Ziele übernehmen</button>`;
      $('#toset', body).onclick = () => { ui.view = 'einstellungen'; sheet.close(); window.scrollTo(0, 0); };
      $('#ok', body).onclick = async () => {
        await applyCheckin(c);
        sheet.close();
        toast(`Neues Ziel: ${fmt0(c.kcal)} kcal`);
      };
    },
  };
}

// ---------- Ansichten ----------

function render() {
  const view = $('#view');
  const nav = $('#tabbar');
  if (!state.settings.onboarded) {
    nav.hidden = true;
    return renderOnboarding(view);
  }
  nav.hidden = false;
  const tab = ui.view === 'einstellungen' ? 'fortschritt' : ui.view;
  $$('[data-view]', nav).forEach((b) => b.setAttribute('aria-current', b.dataset.view === tab ? 'page' : 'false'));
  if (ui.view === 'heute') renderToday(view);
  else if (ui.view === 'fortschritt') renderProgress(view);
  else renderSettings(view);
}

function renderToday(view) {
  const today = todayStr();
  const date = ui.date;
  const list = entriesFor(date);
  const eaten = sum(list);
  const ci = activeCheckin(date);
  const m = model();
  const kgToday = state.weights[date];
  const rate = weeklyRate(m.tSeries, today);
  const counted = dayCounted(date);
  const due = date === today && checkInDue(today);
  const left = ci ? ci.kcal - eaten.kcal : null;
  const daysSinceExport = state.settings.lastExport ? dayDiff(state.settings.lastExport, today) : null;
  const needsBackup = state.entries.length > 20 && (daysSinceExport === null || daysSinceExport > 14);

  const bar = (val, target, color) => `<span class="bar"><span class="bar-fill" style="width:${target ? Math.min(100, (val / target) * 100) : 0}%;--c:${color}"></span></span>`;

  view.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="prev" aria-label="Vorheriger Tag">‹</button>
      <div class="topbar-title"><h1>${labelDate(date, today)}</h1>${date !== today ? `<button class="link small" id="gotoday">Zu heute</button>` : `<span class="muted small">${longDate(date)}</span>`}</div>
      <button class="icon-btn" id="next" aria-label="Nächster Tag" ${date >= today ? 'disabled' : ''}>›</button>
    </header>
    ${due ? `<button class="banner" id="checkin"><span><b>Check-in fällig</b><br><span class="small">Verbrauch und Ziele für die neue Woche berechnen</span></span><span aria-hidden="true">›</span></button>` : ''}
    <section class="card summary">
      ${ci ? `
        <div class="hero">
          <span class="hero-num">${fmt0(Math.abs(left))}</span>
          <span class="hero-label">${left >= 0 ? 'kcal übrig' : 'kcal über dem Ziel'}</span>
        </div>
        <div class="kcal-line"><span>${fmt0(eaten.kcal)} von ${fmt0(ci.kcal)} kcal</span></div>
        ${bar(eaten.kcal, ci.kcal, 'var(--ink)')}
        <div class="macros">
          ${[['Eiweiß', eaten.p, ci.protein, COLORS.p], ['Kohlenhydrate', eaten.c, ci.carbs, COLORS.c], ['Fett', eaten.f, ci.fat, COLORS.f]]
            .map(([l, v, t, c]) => `<div class="macro"><div class="macro-top"><span>${l}</span><span><b>${fmt0(v)}</b> / ${fmt0(t)} g</span></div>${bar(v, t, c)}</div>`).join('')}
        </div>` : '<p class="muted">Noch kein Ziel berechnet.</p>'}
    </section>
    <section class="card weight-card">
      <form id="wform" class="weight-form">
        <label for="w" class="label">Gewicht ${date === today ? 'heute' : 'an diesem Tag'}</label>
        <span class="input-unit"><input id="w" inputmode="decimal" placeholder="—" value="${kgToday ? inputNum(kgToday, 2) : ''}" aria-label="Gewicht in kg"><span>kg</span></span>
        <button class="btn ${kgToday ? '' : 'primary'}">${kgToday ? 'Ändern' : 'Speichern'}</button>
      </form>
      <p class="muted small">${m.tSeries.length ? `Trend ${fmt1(m.trend)} kg${rate !== null ? ` · ${fmtSigned(rate)} kg/Woche` : ''}` : 'Am besten morgens nach dem Toilettengang wiegen, vor dem Essen.'}</p>
    </section>
    ${MEALS.map((name, i) => {
      const items = list.filter((e) => e.meal === i);
      const s = sum(items);
      const yItems = items.length ? [] : entriesFor(addDays(date, -1)).filter((e) => e.meal === i);
      return `<section class="card meal">
        <div class="meal-head"><h2>${name}</h2><span class="muted">${items.length ? `${fmt0(s.kcal)} kcal` : ''}</span>
          <button class="icon-btn add-btn" data-add="${i}" aria-label="${name} eintragen">＋</button></div>
        ${items.length ? `<div class="list">${items.map((e) => `<button class="row" data-entry="${e.id}">
            <span class="row-main"><span class="row-title">${esc(e.name)}</span>
            <span class="row-sub">${e.grams ? `${inputNum(e.grams)} ${e.unit} · ` : ''}${e.grams || e.p + e.c + e.f > 0 ? macroLine(e) : 'nur Kalorien'}</span></span>
            <span class="row-kcal">${fmt0(e.kcal)}</span></button>`).join('')}</div>` : ''}
        ${yItems.length ? `<button class="link small copy-btn" data-copy="${i}">Wie gestern übernehmen (${yItems.length} ${yItems.length === 1 ? 'Eintrag' : 'Einträge'}, ${fmt0(sum(yItems).kcal)} kcal)</button>` : ''}
      </section>`;
    }).join('')}
    <section class="card day-status">
      <label class="switch-row">
        <span><b>Tag vollständig eingetragen</b><br><span class="muted small">Nur vollständige Tage fließen in die Verbrauchsberechnung ein.</span></span>
        <input type="checkbox" id="complete" role="switch" ${counted ? 'checked' : ''}>
      </label>
    </section>
    ${needsBackup ? `<button class="banner subtle" id="backup"><span><b>Sicherung empfohlen</b><br><span class="small">${daysSinceExport === null ? 'Du hast noch keine Sicherungsdatei erstellt.' : `Letzte Sicherung vor ${daysSinceExport} Tagen.`}</span></span><span aria-hidden="true">›</span></button>` : ''}
  `;

  $('#prev', view).onclick = () => { ui.date = addDays(date, -1); render(); };
  $('#next', view).onclick = () => { if (date < today) { ui.date = addDays(date, 1); render(); } };
  const gt = $('#gotoday', view);
  if (gt) gt.onclick = () => { ui.date = today; render(); };
  const cb = $('#checkin', view);
  if (cb) cb.onclick = () => sheet.open(checkinScreen());
  const bb = $('#backup', view);
  if (bb) bb.onclick = () => { ui.view = 'einstellungen'; render(); };

  $('#wform', view).onsubmit = async (e) => {
    e.preventDefault();
    const raw = $('#w', view).value;
    const kg = parseNum(raw);
    if (raw.trim() === '' && state.weights[date] !== undefined) {
      delete state.weights[date];
      await save('weights');
      toast('Gewicht entfernt');
      return render();
    }
    if (kg === null || kg < 25 || kg > 350) { toast('Bitte das Gewicht in kg eingeben, z. B. 82,4'); return; }
    state.weights[date] = kg;
    await save('weights');
    $('#w', view).blur();
    toast(`Gewicht gespeichert: ${inputNum(kg, 2)} kg`);
    render();
  };
  $$('[data-add]', view).forEach((b) => (b.onclick = () => openAdd(Number(b.dataset.add))));
  $$('[data-entry]', view).forEach((b) => (b.onclick = () => openEntry(state.entries.find((x) => x.id === b.dataset.entry))));
  $$('[data-copy]', view).forEach((b) => (b.onclick = async () => {
    const i = Number(b.dataset.copy);
    const src = entriesFor(addDays(date, -1)).filter((e) => e.meal === i);
    for (const e of src) state.entries.push({ ...e, id: uid(), ts: Date.now(), date });
    await save('entries');
    toast(`${src.length} ${src.length === 1 ? 'Eintrag' : 'Einträge'} übernommen`);
    render();
  }));
  $('#complete', view).onchange = async (e) => {
    const hasEntries = list.length > 0;
    const on = e.target.checked;
    // Standard (ohne Markierung): Tage mit Einträgen zählen, leere nicht
    if (on === hasEntries) delete state.days[date];
    else state.days[date] = on ? 'complete' : 'incomplete';
    await save('days');
    toast(on ? 'Tag zählt für die Berechnung' : 'Tag zählt nicht für die Berechnung');
  };
}

function renderProgress(view) {
  const m = model();
  const today = m.today;
  const start = ui.range ? addDays(today, -ui.range) : '0000-00-00';
  const tPts = m.tSeries.filter((p) => p.date >= start);
  const rate = weeklyRate(m.tSeries, today);
  const t7 = trendAt(m.tSeries, addDays(today, -7));
  let n7 = 0, k7 = 0;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, -i);
    if (m.intake[d] !== undefined) { n7++; k7 += m.intake[d]; }
  }
  const avg7 = n7 ? k7 / n7 : null;
  const due = checkInDue(today);

  view.innerHTML = `
    <header class="topbar plain"><h1>Fortschritt</h1>
      <button class="icon-btn" id="opensettings" aria-label="Einstellungen">${ICON_GEAR}</button></header>
    ${due ? `<button class="banner" id="checkin"><span><b>Check-in fällig</b><br><span class="small">Verbrauch und Ziele für die neue Woche berechnen</span></span><span aria-hidden="true">›</span></button>` : ''}
    <section class="tiles">
      <div class="tile"><span class="label">Trendgewicht</span><span class="tile-val">${m.tSeries.length ? `${fmt1(m.trend)} kg` : '—'}</span>
        <span class="muted small">${t7 !== null && m.tSeries.length ? `${fmtSigned(m.trend - t7)} kg in 7 Tagen` : 'noch keine Messwerte'}</span></div>
      <div class="tile"><span class="label">Tempo</span><span class="tile-val">${rate !== null ? `${fmtSigned(rate)} kg` : '—'}</span>
        <span class="muted small">pro Woche, letzte 3 Wochen</span></div>
      <div class="tile"><span class="label">Verbrauch</span><span class="tile-val">${fmt0(m.expenditure)} kcal</span>
        <span class="muted small">${m.conf >= 1 ? 'aus deinen Daten' : `Kalibrierung ${fmt0(m.conf * 100)} %`}</span></div>
      <div class="tile"><span class="label">Gegessen</span><span class="tile-val">${avg7 !== null ? `${fmt0(avg7)} kcal` : '—'}</span>
        <span class="muted small">Ø der letzten 7 Tage (${n7} von 7 erfasst)</span></div>
    </section>
    <div class="range">${chips('range', [[30, '1 Monat'], [90, '3 Monate'], [365, '1 Jahr'], [0, 'Alles']], ui.range)}</div>
    <section class="card">
      <h2>Gewicht</h2>
      <div id="wchart"></div>
      <details class="table-details"><summary>Alle Messwerte</summary>
        <table class="data"><thead><tr><th>Datum</th><th>Waage</th><th>Trend</th><th></th></tr></thead><tbody>
        ${m.tSeries.filter((p) => p.measured).reverse().map((p) => `<tr><td>${longDate(p.date)}</td><td>${inputNum(p.kg, 2)}</td><td>${fmt1(p.trend)}</td>
          <td><button class="icon-btn small" data-delw="${p.date}" aria-label="Messwert ${longDate(p.date)} löschen">✕</button></td></tr>`).join('')}
        </tbody></table></details>
    </section>
    <section class="card">
      <h2>Verbrauch und Essen</h2>
      <div id="echart"></div>
    </section>
    <section class="card">
      <h2>Check-ins</h2>
      ${state.checkins.length ? `<table class="data"><thead><tr><th>Datum</th><th>Verbrauch</th><th>Ziel</th><th>E/K/F</th></tr></thead><tbody>
        ${[...state.checkins].reverse().map((c) => `<tr><td>${shortDate(c.date)}</td><td>${fmt0(c.expenditure)}</td><td>${fmt0(c.kcal)}</td><td>${c.protein}/${c.carbs}/${c.fat}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Noch keine Check-ins.</p>'}
      ${!due ? `<p class="muted small">Nächster Check-in: ${state.checkins.length ? `${WEEKDAYS_LONG[state.settings.checkInWeekday]}, ${shortDate(nextCheckIn(state.checkins[state.checkins.length - 1].date, state.settings.checkInWeekday))}` : '—'}</p>` : ''}
    </section>`;

  const cb = $('#checkin', view);
  if (cb) cb.onclick = () => sheet.open(checkinScreen());
  $('#opensettings', view).onclick = () => { ui.view = 'einstellungen'; render(); window.scrollTo(0, 0); };
  $$('[data-range]', view).forEach((b) => (b.onclick = () => { ui.range = Number(b.dataset.range); render(); }));
  $$('[data-delw]', view).forEach((b) => (b.onclick = async () => {
    if (!confirm(`Messwert vom ${longDate(b.dataset.delw)} löschen?`)) return;
    delete state.weights[b.dataset.delw];
    await save('weights');
    render();
  }));

  lineChart($('#wchart', view), {
    series: [
      { name: 'Waage', kind: 'dots', color: 'var(--muted-mark)', points: tPts.filter((p) => p.measured).map((p) => ({ date: p.date, y: p.kg })) },
      { name: 'Trend', kind: 'line', color: 'var(--s1)', endLabel: true, points: tPts.map((p) => ({ date: p.date, y: p.trend })) },
    ],
    fmtY: (v) => inputNum(v, 1),
    unit: ' kg',
  });

  const ePts = m.eSeries.filter((p) => p.date >= start);
  const avgPts = [];
  for (const p of ePts) {
    let n = 0, k = 0;
    for (let i = 1; i <= 7; i++) {
      const d = addDays(p.date, -i);
      if (m.intake[d] !== undefined) { n++; k += m.intake[d]; }
    }
    if (n >= 3) avgPts.push({ date: p.date, y: k / n });
  }
  lineChart($('#echart', view), {
    series: [
      { name: 'Verbrauch', kind: 'line', color: 'var(--s1)', endLabel: true, points: ePts.map((p) => ({ date: p.date, y: p.est })) },
      { name: 'Gegessen (Ø 7 Tage)', kind: 'line', color: 'var(--s2)', points: avgPts },
    ],
    fmtY: (v) => fmt0(v),
    unit: ' kcal',
  });
}

function renderSettings(view) {
  const s = state.settings;
  view.innerHTML = `
    <header class="topbar plain"><button class="link head-back" id="back">‹ Fortschritt</button><h1>Einstellungen</h1><span class="head-back"></span></header>
    <section class="card">
      <h2>Ziel</h2>
      ${chips('goal', [['lose', 'Abnehmen'], ['maintain', 'Halten'], ['gain', 'Zunehmen']], s.goal)}
      ${s.goal !== 'maintain' ? `<div class="field"><span class="label">Tempo (kg pro Woche)</span>${chips('rate', RATES, s.rateKgPerWeek)}</div>` : ''}
      <p class="muted small">Änderungen am Ziel gelten sofort: Die Tagesziele werden mit deinem aktuellen Verbrauch neu berechnet.</p>
    </section>
    <section class="card">
      <h2>Makros</h2>
      <div class="field"><span class="label">Eiweiß pro kg Körpergewicht</span>${chips('protein', [[1.6, '1,6 g'], [2, '2,0 g'], [2.4, '2,4 g']], s.proteinPerKg)}</div>
      <div class="field"><span class="label">Fettanteil der Kalorien</span>${chips('fat', [[0.25, '25 %'], [0.3, '30 %'], [0.35, '35 %']], s.fatShare)}</div>
      <label class="field"><span class="label">Kalorien-Untergrenze</span><span class="input-unit"><input id="minkcal" inputmode="numeric" value="${inputNum(s.minKcal, 0)}"><span>kcal</span></span></label>
    </section>
    <section class="card">
      <h2>Check-in</h2>
      <label class="field"><span class="label">Wochentag</span>
        <select id="wd">${WEEKDAYS_LONG.map((d, i) => `<option value="${i}" ${i === s.checkInWeekday ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <button class="btn block" id="recalc">Ziele jetzt neu berechnen</button>
    </section>
    <section class="card">
      <h2>Profil für die Startschätzung</h2>
      <p class="muted small">Wird nur genutzt, solange noch zu wenige eigene Daten vorliegen.</p>
      <div class="field"><span class="label">Geschlecht</span>${chips('sex', [['m', 'Männlich'], ['w', 'Weiblich']], s.sex)}</div>
      <div class="grid2">
        <label class="field"><span class="label">Geburtsjahr</span><input id="by" inputmode="numeric" value="${s.birthYear || ''}"></label>
        <label class="field"><span class="label">Größe</span><span class="input-unit"><input id="hc" inputmode="numeric" value="${s.heightCm || ''}"><span>cm</span></span></label>
      </div>
      <label class="field"><span class="label">Aktivität</span><select id="act">${ACTIVITY.map(([v, l, d]) => `<option value="${v}" ${v === s.activity ? 'selected' : ''}>${l} – ${d}</option>`).join('')}</select></label>
      <label class="field"><span class="label">Bekannter Startverbrauch (optional)</span><span class="input-unit"><input id="se" inputmode="numeric" value="${s.startExpenditure || ''}" placeholder="${fmt0(priorExpenditure({ ...s, startExpenditure: null }, s.startWeight, todayStr()))}"><span>kcal</span></span></label>
    </section>
    <section class="card">
      <h2>Daten sichern</h2>
      <p class="muted small">Deine Daten liegen nur auf diesem Gerät. Erstelle regelmäßig eine Sicherungsdatei und lege sie z. B. in iCloud Drive ab.${s.lastExport ? ` Letzte Sicherung: ${longDate(s.lastExport)}.` : ''}</p>
      <p class="muted small" id="persist"></p>
      <button class="btn primary block" id="export">Sicherung erstellen</button>
      <label class="btn block file-btn">Sicherung wiederherstellen<input type="file" id="import" accept="application/json,.json" hidden></label>
      <button class="btn ghost-danger block" id="reset">Alle Daten löschen</button>
    </section>
    <section class="card about">
      <h2>So rechnet die App</h2>
      <p class="small">Das Trendgewicht glättet Tagesschwankungen. Der Verbrauch ergibt sich laufend aus dem, was du an vollständigen Tagen gegessen hast, und wie sich dein Gewicht dabei verändert (1 kg ≈ 7.700 kcal). Einzelne Ausreißer auf der Waage und Tage ohne vollständige Einträge fallen dabei kaum ins Gewicht. Einmal pro Woche werden daraus Kalorien und Makros für dein Ziel berechnet.</p>
      <p class="small muted">Produktdaten: <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (ODbL). Grundlebensmittel sind Richtwerte. Kein medizinischer Rat.</p>
    </section>`;

  $('#back', view).onclick = () => { ui.view = 'fortschritt'; render(); window.scrollTo(0, 0); };
  const autoTargets = async () => {
    await save('settings');
    if (state.checkins.length) {
      const c = makeCheckin();
      await applyCheckin(c);
      toast(`Neues Ziel: ${fmt0(c.kcal)} kcal`);
    }
    render();
  };
  $$('[data-goal]', view).forEach((b) => (b.onclick = () => { s.goal = b.dataset.goal; autoTargets(); }));
  $$('[data-rate]', view).forEach((b) => (b.onclick = () => { s.rateKgPerWeek = Number(b.dataset.rate); autoTargets(); }));
  $$('[data-protein]', view).forEach((b) => (b.onclick = () => { s.proteinPerKg = Number(b.dataset.protein); autoTargets(); }));
  $$('[data-fat]', view).forEach((b) => (b.onclick = () => { s.fatShare = Number(b.dataset.fat); autoTargets(); }));
  $$('[data-sex]', view).forEach((b) => (b.onclick = async () => { s.sex = b.dataset.sex; await save('settings'); render(); }));
  $('#minkcal', view).onchange = (e) => { const v = parseNum(e.target.value); if (v !== null && v >= 800) { s.minKcal = Math.round(v); autoTargets(); } else { toast('Bitte mindestens 800 kcal angeben'); render(); } };
  $('#wd', view).onchange = async (e) => { s.checkInWeekday = Number(e.target.value); await save('settings'); toast('Check-in-Tag gespeichert'); };
  $('#recalc', view).onclick = async () => { const c = makeCheckin(); await applyCheckin(c); toast(`Neues Ziel: ${fmt0(c.kcal)} kcal`); };
  const num = (id, key, lo, hi) => ($(id, view).onchange = async (e) => {
    const v = parseNum(e.target.value);
    if (e.target.value.trim() === '') s[key] = null;
    else if (v === null || v < lo || v > hi) { toast('Ungültiger Wert'); return render(); }
    else s[key] = Math.round(v);
    await save('settings');
    toast('Gespeichert');
  });
  num('#by', 'birthYear', 1920, 2015);
  num('#hc', 'heightCm', 120, 230);
  num('#se', 'startExpenditure', 1000, 6000);
  $('#act', view).onchange = async (e) => { s.activity = Number(e.target.value); await save('settings'); toast('Gespeichert'); };

  isPersisted().then((p) => {
    const el = $('#persist', view);
    if (el && p !== null) el.textContent = p ? 'Der Browser hält die Daten dauerhaft vor.' : 'Der Browser könnte die Daten bei Speichermangel löschen – umso wichtiger ist die Sicherungsdatei. Auf dem iPhone die App über den Home-Bildschirm öffnen.';
  });

  $('#export', view).onclick = async () => {
    const json = JSON.stringify(exportData(), null, 1);
    const name = `makro-sicherung-${todayStr()}.json`;
    const file = new File([json], name, { type: 'application/json' });
    let done = false;
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Makro-Sicherung' });
        done = true;
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
    if (!done) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    s.lastExport = todayStr();
    await save('settings');
    toast('Sicherung erstellt');
    render();
  };
  $('#import', view).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (!confirm('Alle aktuellen Daten durch die Sicherung ersetzen?')) return;
      await importData(json);
      toast('Sicherung wiederhergestellt');
      ui.date = todayStr();
      render();
    } catch (err) {
      toast(err.message.startsWith('Das ist') ? err.message : 'Die Datei konnte nicht gelesen werden.');
    }
  };
  $('#reset', view).onclick = async () => {
    if (!confirm('Wirklich alle Daten löschen? Das lässt sich nur mit einer Sicherungsdatei rückgängig machen.')) return;
    if (!confirm('Letzte Bestätigung: alles löschen?')) return;
    await resetAll();
    ui.view = 'heute';
    render();
  };
}

function renderOnboarding(view) {
  const s = state.settings;
  view.innerHTML = `
    <header class="topbar plain"><h1>Willkommen</h1></header>
    <p class="intro">Ein paar Angaben für die Startschätzung. Danach lernt die App deinen echten Verbrauch aus deinen Einträgen und deinem Gewicht.</p>
    <form id="ob" class="card" novalidate>
      <label class="field"><span class="label">Gewicht heute</span><span class="input-unit big"><input name="kg" inputmode="decimal" placeholder="z. B. 82,4" required><span>kg</span></span></label>
      <div class="grid2">
        <label class="field"><span class="label">Größe</span><span class="input-unit"><input name="hc" inputmode="numeric" placeholder="180"><span>cm</span></span></label>
        <label class="field"><span class="label">Geburtsjahr</span><input name="by" inputmode="numeric" placeholder="1998"></label>
      </div>
      <div class="field"><span class="label">Geschlecht (für die Formel)</span>${chips('sex', [['m', 'Männlich'], ['w', 'Weiblich']], s.sex)}</div>
      <label class="field"><span class="label">Aktivität</span><select name="act">${ACTIVITY.map(([v, l, d]) => `<option value="${v}" ${v === s.activity ? 'selected' : ''}>${l} – ${d}</option>`).join('')}</select></label>
      <div class="field"><span class="label">Ziel</span>${chips('goal', [['lose', 'Abnehmen'], ['maintain', 'Halten'], ['gain', 'Zunehmen']], s.goal)}</div>
      <div class="field" id="ratefield"><span class="label">Tempo (kg pro Woche)</span>${chips('rate', RATES, s.rateKgPerWeek)}</div>
      <label class="field"><span class="label">Bekannter Verbrauch (optional)</span><span class="input-unit"><input name="se" inputmode="numeric" placeholder="z. B. letzter Wert aus MacroFactor"><span>kcal</span></span></label>
      <p class="error" id="err" hidden></p>
      <button class="btn primary block big">Los geht's</button>
    </form>
    <p class="center"><label class="link file-link">Ich habe eine Sicherungsdatei<input type="file" id="import" accept="application/json,.json" hidden></label></p>`;
  const pick = (name, key, conv = (v) => v) => $$(`[data-${name}]`, view).forEach((b) => (b.onclick = () => {
    s[key] = conv(b.dataset[name]);
    $$(`[data-${name}]`, view).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    if (name === 'goal') $('#ratefield', view).hidden = s.goal === 'maintain';
  }));
  pick('sex', 'sex');
  pick('goal', 'goal');
  pick('rate', 'rateKgPerWeek', Number);
  $('#ob', view).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const kg = parseNum(fd.get('kg'));
    const err = $('#err', view);
    if (kg === null || kg < 25 || kg > 350) { err.textContent = 'Bitte dein heutiges Gewicht in kg eingeben, z. B. 82,4.'; err.hidden = false; return; }
    const hc = parseNum(fd.get('hc')), by = parseNum(fd.get('by')), se = parseNum(fd.get('se'));
    s.heightCm = hc && hc > 120 && hc < 230 ? Math.round(hc) : null;
    s.birthYear = by && by > 1920 && by < 2015 ? Math.round(by) : null;
    s.startExpenditure = se && se >= 1000 && se <= 6000 ? Math.round(se) : null;
    s.activity = Number(fd.get('act'));
    s.startWeight = kg;
    s.onboarded = true;
    const today = todayStr();
    state.weights[today] = kg;
    await save('settings', 'weights');
    await applyCheckin(makeCheckin());
    ui.view = 'heute';
    ui.date = today;
    render();
    window.scrollTo(0, 0);
    toast('Startziele berechnet');
  };
  $('#import', view).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importData(JSON.parse(await file.text()));
      toast('Sicherung wiederhergestellt');
      render();
    } catch (err) {
      toast(err.message.startsWith('Das ist') ? err.message : 'Die Datei konnte nicht gelesen werden.');
    }
  };
}

const ICON_GEAR = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const ICON_SCAN = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 8v8M10 8v8M13 8v8M16 8v8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

// ---------- Start ----------

async function init() {
  await load();
  $$('#tabbar [data-view]').forEach((b) => (b.onclick = () => {
    ui.view = b.dataset.view;
    if (ui.view === 'heute') ui.date = todayStr();
    render();
    window.scrollTo(0, 0);
  }));
  $('#addtab').onclick = () => {
    if (ui.view !== 'heute') { ui.view = 'heute'; ui.date = todayStr(); render(); }
    openAdd();
  };
  render();
  // Neuer Tag, während die App offen war
  // Nur neu zeichnen, wenn inzwischen ein neuer Tag begonnen hat – sonst gingen Eingaben verloren.
  let shownDay = todayStr();
  document.addEventListener('visibilitychange', () => {
    const now = todayStr();
    if (document.visibilityState !== 'visible' || now === shownDay) return;
    if (ui.date === shownDay) ui.date = now;
    shownDay = now;
    if (!document.body.classList.contains('sheet-open')) render();
  });
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (ui.view === 'fortschritt' && Math.abs(window.innerWidth - lastW) > 30) { lastW = window.innerWidth; render(); }
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init().catch((e) => {
  $('#view').innerHTML = `<p class="error">Die App konnte nicht starten: ${esc(e.message)}</p>`;
});

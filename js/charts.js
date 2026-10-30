// Schlanke SVG-Liniendiagramme mit Fadenkreuz und Tooltip. Keine externe Bibliothek.

import { dayDiff, addDays, shortDate, longDate, esc } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const PAD = { top: 12, right: 52, bottom: 26, left: 40 };

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

/**
 * series: [{ name, color, kind: 'line' | 'dots', points: [{ date, y }], endLabel?: bool }]
 * fmtY: Zahl → Text für Achse und Tooltip
 */
export function lineChart(container, { series, fmtY, height = 200, unit = '' }) {
  container.innerHTML = '';
  container.classList.add('chart');
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) {
    container.innerHTML = '<p class="muted small chart-empty">Noch zu wenige Daten für ein Diagramm.</p>';
    return;
  }

  if (series.length > 1) {
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = series
      .map((s) => `<span class="legend-item"><i class="key key-${s.kind}" style="--c:${s.color}"></i>${esc(s.name)}</span>`)
      .join('');
    container.appendChild(legend);
  }

  const wrap = document.createElement('div');
  wrap.className = 'chart-plot';
  container.appendChild(wrap);
  const width = Math.max(260, wrap.clientWidth || container.clientWidth || 320);

  const dates = all.map((p) => p.date).sort();
  const d0 = dates[0];
  const days = Math.max(1, dayDiff(d0, dates[dates.length - 1]));
  let yMin = Math.min(...all.map((p) => p.y));
  let yMax = Math.max(...all.map((p) => p.y));
  const padY = (yMax - yMin) * 0.12 || Math.abs(yMax) * 0.02 || 1;
  const ticks = niceTicks(yMin - padY, yMax + padY);
  yMin = ticks[0];
  yMax = ticks[ticks.length - 1];

  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const x = (date) => PAD.left + (dayDiff(d0, date) / days) * iw;
  const y = (v) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': series.map((s) => s.name).join(' und ') });
  wrap.appendChild(svg);

  for (const t of ticks) {
    el('line', { x1: PAD.left, x2: width - PAD.right, y1: y(t), y2: y(t), class: 'grid' }, svg);
    const lbl = el('text', { x: PAD.left - 6, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' }, svg);
    lbl.textContent = fmtY(t);
  }
  const xTickCount = Math.min(width < 400 ? 3 : 4, days);
  for (let i = 0; i <= xTickCount; i++) {
    const date = addDays(d0, Math.round((days * i) / xTickCount));
    const lbl = el('text', { x: x(date), y: height - 6, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === xTickCount ? 'end' : 'middle' }, svg);
    lbl.textContent = shortDate(date);
  }

  for (const s of series) {
    if (s.kind === 'line' && s.points.length > 1) {
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
      el('path', { d, class: 'line', style: `stroke:${s.color}` }, svg);
    }
    if (s.kind === 'dots') {
      for (const p of s.points) el('circle', { cx: x(p.date), cy: y(p.y), r: 4, class: 'dot', style: `fill:${s.color}` }, svg);
    }
  }
  // Wert am Ende der Hauptlinie direkt beschriften
  const main = series.find((s) => s.endLabel) || series.find((s) => s.kind === 'line');
  if (main?.points.length) {
    const last = main.points[main.points.length - 1];
    el('circle', { cx: x(last.date), cy: y(last.y), r: 4, class: 'dot', style: `fill:${main.color}` }, svg);
    const t = el('text', { x: x(last.date) + 8, y: y(last.y) + 4, class: 'end-label' }, svg);
    t.textContent = fmtY(last.y);
  }

  // Hover-/Touch-Ebene
  const cross = el('line', { y1: PAD.top, y2: PAD.top + ih, class: 'cross', visibility: 'hidden' }, svg);
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  wrap.appendChild(tip);
  const hit = el('rect', { x: PAD.left, y: 0, width: iw, height, fill: 'transparent' }, svg);

  const byDate = new Map();
  for (const s of series) for (const p of s.points) {
    if (!byDate.has(p.date)) byDate.set(p.date, {});
    byDate.get(p.date)[s.name] = p.y;
  }
  const hoverDates = [...byDate.keys()].sort();

  function show(evt) {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * width;
    const di = Math.round(((px - PAD.left) / iw) * days);
    const target = addDays(d0, Math.max(0, Math.min(days, di)));
    let best = hoverDates[0];
    for (const d of hoverDates) if (Math.abs(dayDiff(d, target)) < Math.abs(dayDiff(best, target))) best = d;
    const cx = x(best);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    const vals = byDate.get(best);
    tip.innerHTML = `<div class="tip-date">${longDate(best)}</div>` + series
      .filter((s) => vals[s.name] !== undefined)
      .map((s) => `<div class="tip-row"><i class="key key-${s.kind}" style="--c:${s.color}"></i>${esc(s.name)} <b>${fmtY(vals[s.name])}${unit}</b></div>`)
      .join('');
    tip.hidden = false;
    const left = (cx / width) * rect.width;
    tip.style.left = `${Math.min(Math.max(left, 70), rect.width - 70)}px`;
  }
  function hide() {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  }
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

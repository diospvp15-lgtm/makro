// Rechenkern: Trendgewicht, geschätzter Verbrauch und Kalorien-/Makroziele.
// Reine Funktionen ohne Speicherzugriff. Die genaue Formel von MacroFactor ist nicht
// öffentlich; das hier ist eine eigene Umsetzung des gleichen Energiebilanz-Prinzips.

import { addDays, dayDiff, weekday, clamp } from './util.js';

export const KCAL_PER_KG = 7700;
const TREND_ALPHA = 0.1;   // Glättung des Trendgewichts pro Tag

// weights: { 'JJJJ-MM-TT': kg } → Tagesreihe mit linear aufgefüllten Lücken und Trend
export function trendSeries(weights) {
  const dates = Object.keys(weights).sort();
  if (!dates.length) return [];
  const out = [];
  // Start mit dem Mittel der ersten Woche, damit der Trend nicht am ersten Ausreißer hängt
  const firstWeek = dates.filter((d) => dayDiff(dates[0], d) < 7).map((d) => weights[d]);
  let trend = firstWeek.reduce((a, b) => a + b, 0) / firstWeek.length;
  out.push({ date: dates[0], kg: trend, measured: true, trend });
  for (let i = 1; i < dates.length; i++) {
    const prevDate = dates[i - 1];
    const prevKg = weights[prevDate];
    const kg = weights[dates[i]];
    const gap = dayDiff(prevDate, dates[i]);
    for (let d = 1; d <= gap; d++) {
      const v = prevKg + ((kg - prevKg) * d) / gap;
      trend += TREND_ALPHA * (v - trend);
      out.push({ date: addDays(prevDate, d), kg: v, measured: d === gap, trend });
    }
  }
  return out;
}

// Trendwert an einem Datum; nach dem letzten Messtag gilt der letzte Trend weiter.
export function trendAt(series, date) {
  if (!series.length || date < series[0].date) return null;
  const last = series[series.length - 1];
  if (date >= last.date) return last.trend;
  const idx = dayDiff(series[0].date, date);
  return series[idx]?.trend ?? null;
}

// Gewichtsänderung pro Woche aus der Steigung des Trends über die letzten `days` Tage.
export function weeklyRate(series, endDate, days = 21) {
  const pts = series.filter((p) => p.date <= endDate && dayDiff(p.date, endDate) < days);
  if (pts.length < 7) return null;
  return slope(pts.map((p) => [dayDiff(pts[0].date, p.date), p.trend])) * 7;
}

function slope(xy) {
  const n = xy.length;
  let sx = 0, sy = 0;
  for (const [x, y] of xy) { sx += x; sy += y; }
  const mx = sx / n, my = sy / n;
  let num = 0, den = 0;
  for (const [x, y] of xy) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

export function ageFrom(settings, today) {
  if (!settings.birthYear) return null;
  return Number(today.slice(0, 4)) - settings.birthYear;
}

// Startschätzung ohne eigene Daten: bekannter Wert oder Mifflin-St-Jeor × Aktivität.
export function priorExpenditure(settings, kg, today) {
  if (settings.startExpenditure) return settings.startExpenditure;
  if (!kg) return 2200;
  const age = ageFrom(settings, today);
  let bmr;
  if (settings.heightCm && age) {
    bmr = 10 * kg + 6.25 * settings.heightCm - 5 * age + (settings.sex === 'w' ? -161 : 5);
  } else {
    bmr = 22 * kg;
  }
  return Math.round(bmr * (settings.activity || 1.375));
}

// Verbrauchsschätzung mit einem Kalman-Filter über zwei Größen: „wahres“ Gewicht ohne
// Wasserschwankungen und täglicher Verbrauch. Jeden Morgen korrigiert der Waagenwert die
// Schätzung; über den Tag verschiebt das gegessene Essen minus Verbrauch das Gewicht.
// Tage ohne vollständige Einträge zählen mit großer Unsicherheit, verfälschen also nichts.
export const KALMAN = {
  weightSd: 0.8,      // tägliche Schwankung der Waage durch Wasser, Salz, Darminhalt (kg)
  intakeSd: 150,      // Ungenauigkeit beim Eintragen an vollständigen Tagen (kcal)
  unknownSd: 800,     // Unsicherheit an Tagen ohne vollständige Einträge (kcal)
  driftSd: 15,        // wie stark sich der Verbrauch von Tag zu Tag ändern darf (kcal)
  priorSd: 400,       // Unsicherheit der Startschätzung per Formel (kcal)
  knownPriorSd: 200,  // Unsicherheit eines selbst angegebenen Startwerts (kcal)
  calibratedSd: 120,  // ab dieser Restunsicherheit gilt die Schätzung als kalibriert (kcal)
};

export function expenditureSeries(intake, weights, settings, until, opt = KALMAN) {
  const wDates = Object.keys(weights).filter((d) => d <= until).sort();
  const firstKg = wDates.length ? weights[wDates[0]] : settings.startWeight;
  const prior = priorExpenditure(settings, firstKg, until);
  const sd0 = settings.startExpenditure ? opt.knownPriorSd : opt.priorSd;
  const confOf = (sdE) => clamp((sd0 - Math.sqrt(sdE)) / (sd0 - opt.calibratedSd), 0, 1);
  if (!wDates.length) return [{ date: until, est: prior, conf: 0, sd: sd0 }];

  const iDates = Object.keys(intake).filter((d) => d < until).sort();
  const first = iDates.length && iDates[0] < wDates[0] ? iDates[0] : wDates[0];
  // Zustand [m, E] und Kovarianz [[pmm, pme], [pme, pee]]
  let m = firstKg, E = prior;
  let pmm = opt.weightSd ** 2, pme = 0, pee = sd0 ** 2;
  const R = opt.weightSd ** 2;
  const out = [];
  const recent = [];
  for (let d = first; d <= until; d = addDays(d, 1)) {
    // Morgens: Waagenwert verarbeiten
    if (weights[d] !== undefined) {
      const S = pmm + R;
      const km = pmm / S, ke = pme / S;
      const y = weights[d] - m;
      m += km * y;
      E += ke * y;
      const npmm = (1 - km) * pmm;
      const npme = (1 - km) * pme;
      const npee = pee - ke * pme;
      pmm = npmm; pme = npme; pee = npee;
    }
    out.push({ date: d, est: E, sd: Math.sqrt(pee), conf: confOf(pee) });
    if (d === until) break;
    // Über den Tag: Essen minus Verbrauch
    let I, sdI;
    if (intake[d] !== undefined) {
      I = intake[d];
      sdI = opt.intakeSd;
      recent.push(I);
      if (recent.length > 14) recent.shift();
    } else {
      I = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : E;
      sdI = opt.unknownSd;
    }
    const k = 1 / KCAL_PER_KG;
    m += (I - E) * k;
    // P' = F P Fᵀ + Q mit F = [[1, −k], [0, 1]]
    const npmm = pmm - 2 * k * pme + k * k * pee + (sdI * k) ** 2;
    const npme = pme - k * pee;
    const npee = pee + opt.driftSd ** 2;
    pmm = npmm; pme = npme; pee = npee;
  }
  return out;
}

// Kalibrierungsgrad der aktuellen Schätzung (0–1).
export function calibration(intake, weights, date, settings) {
  const s = expenditureSeries(intake, weights, settings, date);
  return s[s.length - 1].conf;
}

export function signedRate(settings) {
  const r = Math.abs(settings.rateKgPerWeek || 0);
  if (settings.goal === 'lose') return -r;
  if (settings.goal === 'gain') return r;
  return 0;
}

export function computeTargets(expenditure, trendKg, settings) {
  let kcal = expenditure + (signedRate(settings) * KCAL_PER_KG) / 7;
  let floored = false;
  if (settings.minKcal && kcal < settings.minKcal) { kcal = settings.minKcal; floored = true; }
  kcal = Math.round(kcal / 10) * 10;
  const protein = Math.round((settings.proteinPerKg || 2) * trendKg);
  let fat = Math.round((kcal * (settings.fatShare || 0.3)) / 9);
  let carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
  if (carbs < 0) {
    carbs = 0;
    fat = Math.max(0, Math.round((kcal - protein * 4) / 9));
  }
  return { kcal, protein, fat, carbs, floored };
}

// Nächster Check-in-Termin nach dem letzten Check-in am gewünschten Wochentag.
export function nextCheckIn(lastDate, wd) {
  let d = addDays(lastDate, 1);
  while (weekday(d) !== wd) d = addDays(d, 1);
  return d;
}

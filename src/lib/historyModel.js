/**
 * Reported history — ONE canonical shape for Yahoo-fetched and hand-typed
 * statements. Nothing here is ever back-cast: a value is either reported (or
 * typed) or it is null and renders as NA.
 *
 * History = {
 *   source: 'yahoo' | 'manual',
 *   label:  string,                         // e.g. "RELIANCE.NS · Yahoo Finance"
 *   annual:    { dates: string[], lines: { [key]: (number|null)[] } },   // oldest → newest
 *   quarterly: { dates: string[], lines: { [key]: (number|null)[] } } | null,   // Yahoo only
 *   statements: object | null,              // full Yahoo IS/BS/CF lines for the 3-Statement
 *                                           // "Past" view (see lib/history.js), already converted
 * }
 *
 * Every money value is ALREADY in the company's valuation currency and money
 * unit when stored (the Yahoo import converts at the confirmed FX rate), so
 * readers never convert. Signs: every line is stored as the natural positive
 * magnitude of what its label says (capex, dividends, interest expense, tax,
 * D&A are positive outflows/expenses); only genuinely signed lines (PBT, NI,
 * EBITDA, CFO, equity) can be negative.
 */

export const HISTORY_MAX_YEARS = 10;

/** The core lines of the typed history grid (and of history.annual.lines). */
export const HISTORY_LINES = [
  { key: 'revenue', label: 'Revenue', group: 'is' },
  { key: 'cogs', label: 'Cost of goods sold', group: 'is' },
  { key: 'ebitda', label: 'EBITDA', group: 'is' },
  { key: 'da', label: 'Depreciation & amortisation', group: 'is' },
  { key: 'interest', label: 'Interest expense', group: 'is' },
  { key: 'pbt', label: 'Profit before tax', group: 'is' },
  { key: 'tax', label: 'Tax expense', group: 'is' },
  { key: 'ni', label: 'Net income', group: 'is' },
  { key: 'cash', label: 'Cash & equivalents', group: 'bs' },
  { key: 'receivables', label: 'Receivables', group: 'bs' },
  { key: 'inventory', label: 'Inventory', group: 'bs' },
  { key: 'ppe', label: 'Net PP&E', group: 'bs' },
  { key: 'totalAssets', label: 'Total assets', group: 'bs' },
  { key: 'payables', label: 'Payables', group: 'bs' },
  { key: 'currentLiabilities', label: 'Current liabilities', group: 'bs' },
  { key: 'totalDebt', label: 'Total debt', group: 'bs' },
  { key: 'equity', label: "Shareholders' equity", group: 'bs' },
  { key: 'cfo', label: 'Cash from operations', group: 'cf' },
  { key: 'capex', label: 'Capital expenditure', group: 'cf' },
  { key: 'dividends', label: 'Dividends paid', group: 'cf' },
];
export const HISTORY_KEYS = HISTORY_LINES.map((l) => l.key);
export const HISTORY_GROUPS = [
  { id: 'is', label: 'Income statement' },
  { id: 'bs', label: 'Balance sheet' },
  { id: 'cf', label: 'Cash flow' },
];

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** An empty manual history with `years` columns ending in `lastFyEnd` (ISO date). */
export function blankManualHistory(years, lastFyEnd) {
  const end = new Date(lastFyEnd);
  const dates = Array.from({ length: years }, (_, i) => {
    const d = new Date(Date.UTC(end.getUTCFullYear() - (years - 1 - i), end.getUTCMonth(), end.getUTCDate()));
    return d.toISOString().slice(0, 10);
  });
  return {
    source: 'manual',
    label: 'Entered by hand',
    annual: { dates, lines: Object.fromEntries(HISTORY_KEYS.map((k) => [k, dates.map(() => null)])) },
    quarterly: null,
    statements: null,
  };
}

/** True when the history carries at least one reported number. */
export function hasHistory(h) {
  if (!h?.annual?.dates?.length) return false;
  return HISTORY_KEYS.some((k) => (h.annual.lines[k] || []).some((v) => num(v) !== null));
}

/** A line as numbers (NaN for missing), aligned with h.annual.dates. */
export function historyLine(h, key, period = 'annual') {
  const blk = h?.[period];
  if (!blk) return [];
  return (blk.lines[key] || blk.dates.map(() => null)).map((v) => {
    const x = num(v);
    return x === null ? NaN : x;
  });
}

/** Fiscal-year label for a period-end date: "FY26" for non-December year ends, "2025" for December. */
export function fyLabel(date) {
  const [y, m] = String(date).split('-').map(Number);
  if (!y) return String(date);
  return m === 12 ? String(y) : `FY${String(y).slice(-2)}`;
}

/**
 * Historical reference shown beside the forecast inputs (never auto-filled
 * into them): growth, margins and cost ratios computed from what was reported.
 * Every value is NaN where a line is missing.
 */
export function historyReference(h) {
  if (!hasHistory(h)) return null;
  const dates = h.annual.dates;
  const rev = historyLine(h, 'revenue');
  const eb = historyLine(h, 'ebitda');
  const da = historyLine(h, 'da');
  const cx = historyLine(h, 'capex');
  const rec = historyLine(h, 'receivables');
  const inv = historyLine(h, 'inventory');
  const pay = historyLine(h, 'payables');
  const pct = (n, d) => (Number.isFinite(n) && Number.isFinite(d) && d !== 0 ? (n / d) * 100 : NaN);
  const rows = dates.map((date, i) => ({
    date,
    label: fyLabel(date),
    growth: i > 0 ? pct(rev[i] - rev[i - 1], rev[i - 1]) : NaN,
    ebitdaMargin: pct(eb[i], rev[i]),
    daPct: pct(da[i], rev[i]),
    capexPct: pct(cx[i], rev[i]),
    // trade working capital only — the lines the grid actually carries
    tradeNwcPct: pct(rec[i] + inv[i] - pay[i], rev[i]),
  }));
  const valid = rev.map((v, i) => [v, i]).filter(([v]) => Number.isFinite(v) && v > 0);
  let cagr = NaN;
  if (valid.length >= 2) {
    const [v0, i0] = valid[0];
    const [v1, i1] = valid[valid.length - 1];
    cagr = ((v1 / v0) ** (1 / (i1 - i0)) - 1) * 100;
  }
  return { rows, cagr, cagrYears: valid.length >= 2 ? valid[valid.length - 1][1] - valid[0][1] : 0, label: h.label };
}

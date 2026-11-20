/**
 * DCF on the user's twelve DCF templates (DCF_<FCFF|FCFE|DDM>_<GordonGrowth |
 * ExitEVEBITDA | ExitPE>_<CAPM|BuildUp>.xlsx). One engine; the settings pick
 * the combination:
 *
 *   cash flow       'fcff' (discounted at WACC) · 'fcfe' · 'ddm' (at Ke)
 *   terminal value  'gordon' (perpetual growth) · 'exit' (EV/EBITDA for FCFF,
 *                   P/E for FCFE and DDM)
 *   cost of equity  'capm' · 'buildup'
 *
 * Layout of the templates, generalised to N historical years (1–10, template
 * 3) and M forecast years (1–10, template 5):
 *   Historicals   — the company page (same input lines as the comps pages);
 *   Assumptions   — historical ratios for reference + per-year drivers;
 *   Forecast      — P&L, working capital, capex and debt schedule, the cash-flow
 *                   build (FCFF or FCFE; DDM uses dividends);
 *   Cost of equity, WACC (FCFF only) and the valuation sheet with its 5 × 5
 *   sensitivity grid.
 *
 * Every figure follows the template's formulas, including how Excel reads a
 * blank cell (0 in arithmetic). Cell values are numbers, 'n.a.', '' (an
 * IFERROR blank) or 'NM'. Rates are fractions inside the engine; the stored
 * inputs keep percentages as the app shows them (6.5 = 6.5 %).
 *
 * Conventions the templates state: end-of-year discounting (year t at t
 * years, the valuation as at the end of the last historical year); forecast
 * interest = opening debt × rate (no circularity); tax = MAX(0, PBT) × rate;
 * exceptional items are not forecast; associates and NCI are not forecast
 * (forecast PAT is treated as attributable to owners).
 */
import { blankPage, computePage, MIN_YEARS, MAX_YEARS } from './companyPage.js';

export const CF_KINDS = [
  { value: 'fcff', label: 'FCFF', long: 'Free Cash Flow to Firm', note: 'NOPAT + D&A − Capex − Increase in NWC, discounted at WACC → Enterprise Value → less net debt and NCI → Equity Value.' },
  { value: 'fcfe', label: 'FCFE', long: 'Free Cash Flow to Equity', note: 'PAT + D&A − Capex − Increase in NWC + Net Borrowing, discounted at the cost of equity → Equity Value.' },
  { value: 'ddm', label: 'DDM', long: 'Dividend Discount Model', note: 'Dividends (PAT × payout), discounted at the cost of equity → Equity Value.' },
];
export const TV_KINDS = [
  { value: 'gordon', label: 'Gordon Growth', note: 'Final-year cash flow × (1 + g) ÷ (discount rate − g); NM if the discount rate ≤ g.' },
  { value: 'exit', label: 'Exit Multiple', note: 'Final-year EBITDA × exit EV/EBITDA (FCFF) or final-year PAT × exit P/E (FCFE, DDM).' },
];
export const COE_KINDS = [
  { value: 'capm', label: 'CAPM', note: 'Ke = risk-free rate + beta × equity risk premium.' },
  { value: 'buildup', label: 'Build-Up', note: 'Ke = risk-free rate + equity risk premium + size + industry + company-specific + country premia.' },
];

/** Exit multiple of a combination: EV/EBITDA for FCFF, P/E otherwise. */
export const exitMultipleName = (cf) => (cf === 'fcff' ? 'EV / EBITDA' : 'P / E');

/** The template file a combination corresponds to. */
export function templateName(s) {
  const cf = s.cf === 'fcfe' ? 'FCFE' : s.cf === 'ddm' ? 'DDM' : 'FCFF';
  const tv = s.tv === 'exit' ? (s.cf === 'fcff' || !s.cf ? 'ExitEVEBITDA' : 'ExitPE') : 'GordonGrowth';
  const coe = s.coe === 'buildup' ? 'BuildUp' : 'CAPM';
  return `DCF_${cf}_${tv}_${coe}`;
}

/**
 * Forecast drivers (the Assumptions sheet, rows 7–26 of the template). fmt:
 * pct (entered in %, e.g. 12 = 12 %), days, money. `example` and `note` are
 * the template's columns K and L.
 */
export const DRIVERS = [
  { section: 'P&L DRIVERS', row: 6 },
  { key: 'gRev', row: 7, label: 'Revenue growth', fmt: 'pct', example: '12.0%', note: 'YoY growth' },
  { key: 'materials', row: 8, label: 'Cost of materials (% of revenue)', fmt: 'pct', example: '58.0%' },
  { key: 'employee', row: 9, label: 'Employee expenses (% of revenue)', fmt: 'pct', example: '10.0%' },
  { key: 'otherExp', row: 10, label: 'Other expenses (% of revenue)', fmt: 'pct', example: '14.5%' },
  { key: 'da', row: 11, label: 'Depreciation & amortisation (% of revenue)', fmt: 'pct', example: '3.6%' },
  { key: 'otherInc', row: 12, label: 'Other income (% of revenue)', fmt: 'pct', example: '1.1%', note: 'Used for PAT (FCFE, DDM); excluded from FCFF' },
  { key: 'tax', row: 13, label: 'Effective tax rate (% of PBT)', fmt: 'pct', example: '25.2%', note: 'Also applied to EBIT for FCFF taxes' },
  { section: 'INVESTMENT & WORKING CAPITAL', row: 15 },
  { key: 'capex', row: 16, label: 'Capex (% of revenue)', fmt: 'pct', example: '7.0%', note: 'Enter as positive %' },
  { key: 'invDays', row: 17, label: 'Inventory days (on cost of materials)', fmt: 'days', example: '90', note: 'Closing balance basis, 365 days' },
  { key: 'recDays', row: 18, label: 'Receivable days (on revenue)', fmt: 'days', example: '50' },
  { key: 'payDays', row: 19, label: 'Payable days (on cost of materials)', fmt: 'days', example: '75' },
  { key: 'oca', row: 20, label: 'Other current assets (% of revenue)', fmt: 'pct', example: '3.2%' },
  { key: 'ocl', row: 21, label: 'Other current liabilities (% of revenue)', fmt: 'pct', example: '7.7%' },
  { section: 'FINANCING & DIVIDENDS', row: 23 },
  { key: 'netBorrow', row: 24, label: 'Net borrowing / (repayment)', fmt: 'money', example: '(100.0)', note: 'Negative = repayment; include lease principal repaid' },
  { key: 'intRate', row: 25, label: 'Interest rate on opening debt', fmt: 'pct', example: '8.5%', note: 'Historical = finance costs / prior-year closing borrowings' },
  { key: 'payout', row: 26, label: 'Dividend payout (% of PAT)', fmt: 'pct', example: '12.0%', note: 'Drives DDM' },
];
export const DRIVER_KEYS = DRIVERS.filter((d) => d.key).map((d) => d.key);

/* ------------------------------------------------------------ blanks */

export const DEFAULT_STEPS = { rateStep: 0.5, gStep: 0.5, multStep: 1 };

/**
 * The structural choices start blank — the user picks them on the Settings
 * step (the template's own values are shown as hints). Only the sensitivity
 * step sizes are pre-filled (the template's examples), as display settings.
 */
export const blankDcfSettings = () => ({
  cf: null, tv: null, coe: null,          // 'fcff' | 'fcfe' | 'ddm' · 'gordon' | 'exit' · 'capm' | 'buildup'
  histYears: null,                        // 1–10, template 3
  fcstYears: null,                        // 1–10, template 5
  labels: null,                           // { hist: [], fcst: [] }
  valDate: '',
  lease: null,                            // include lease liabilities in net debt (1 / 0; template 1)
  growth: null,                           // terminal growth, %
  exitMultiple: null,                     // x
  rateStep: DEFAULT_STEPS.rateStep,       // sensitivity steps: discount rate (% pts),
  gStep: DEFAULT_STEPS.gStep,             //   terminal growth (% pts),
  multStep: DEFAULT_STEPS.multStep,       //   exit multiple (turns)
});

export const blankDcfT = () => ({
  settings: blankDcfSettings(),
  company: { ticker: '', price: null, shares: null, page: blankPage() },
  drivers: Object.fromEntries(DRIVER_KEYS.map((k) => [k, []])),   // per forecast year, first year first
  capm: { rf: null, beta: null, erp: null, betaMode: 'direct', peerBeta: null, targetDe: null, taxRate: null, peers: [] },
  buildup: { rf: null, erp: null, size: null, industry: null, specific: null, country: null },
  wacc: { kd: null, taxRate: null, targetWd: null },
});

/* ------------------------------------------------------------ helpers */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const z = (v) => (isNum(v) ? v : 0);
const pc = (v) => z(v) / 100;
export const clampN = (n, def) => Math.min(MAX_YEARS, Math.max(MIN_YEARS, Number.isInteger(n) ? n : def));

/** The label `k` years after `label` when it ends in a year number ("FY26" → "FY28E"-style keeps its suffix). */
function shiftLabel(label, k) {
  const m = /^(.*?)(\d+)(\D*)$/.exec(String(label ?? '').trim());
  if (!m) return null;
  const w = m[2].length;
  const y = Number(m[2]) + k;
  const num = w <= 2 ? String(((y % 100) + 100) % 100).padStart(w, '0') : y >= 0 ? String(y) : null;
  return num === null ? null : `${m[1]}${num}${m[3]}`;
}

/** Default labels: historical FYyy ending the year before Year 1, forecasts FYyyE from Year 1. */
export function defaultDcfLabels(n, m, startYear) {
  const y1 = Number.isInteger(startYear) ? startYear : null;
  const yy = (y) => String(y).slice(-2);
  const hist = Array.from({ length: n }, (_, i) => (y1 === null ? (i === n - 1 ? 'Latest FY' : `FY -${n - 1 - i}`) : `FY${yy(y1 - n + i)}`));
  const fcst = Array.from({ length: m }, (_, i) => (y1 === null ? `Year ${i + 1}` : `FY${yy(y1 + i)}E`));
  return { hist, fcst };
}

/**
 * Labels for n historical and m forecast years from stored labels. Historical
 * labels are kept latest-last (added years continue the numbering
 * backwards); forecast labels first-first (added years continue forwards).
 * A blank label reads as its default; `keepBlank` (the label editor) keeps a
 * label the user has just cleared blank, so it can be retyped from scratch.
 */
export function dcfLabels(stored, n, m, startYear, { keepBlank = false } = {}) {
  const d = defaultDcfLabels(n, m, startYear);
  const sh = Array.isArray(stored?.hist) ? stored.hist.slice(-n) : [];
  const sf = Array.isArray(stored?.fcst) ? stored.fcst.slice(0, m) : [];
  const padH = n - sh.length;
  const hist = [...Array.from({ length: padH }, (_, i) => (sh.length ? shiftLabel(sh[0], -(padH - i)) : null) || d.hist[i]), ...sh];
  const fcst = [...sf, ...Array.from({ length: m - sf.length }, (_, i) => (sf.length ? shiftLabel(sf[sf.length - 1], i + 1) : null) || d.fcst[sf.length + i])];
  const clean = (arr, def) => arr.map((x, i) => (String(x ?? '').trim() ? x : keepBlank && x === '' ? '' : def[i]));
  return { hist: clean(hist, d.hist), fcst: clean(fcst, d.fcst) };
}

/** A driver row's value for forecast year j (blank = 0, as the template's empty cell). */
const drv = (drivers, key, j) => (Array.isArray(drivers?.[key]) ? drivers[key][j] : null);

/**
 * The drivers a cash flow's value depends on: the operating drivers, plus
 * other income, net borrowing and the interest rate for the equity cash flows
 * (through PAT and the debt schedule) and the payout for the DDM.
 */
export function valueDrivers(cf) {
  const ops = ['gRev', 'materials', 'employee', 'otherExp', 'da', 'tax', 'capex', 'invDays', 'recDays', 'payDays', 'oca', 'ocl'];
  if (cf === 'fcfe') return [...ops, 'otherInc', 'netBorrow', 'intRate'];
  if (cf === 'ddm') return [...ops, 'otherInc', 'netBorrow', 'intRate', 'payout'];
  return ops;
}

/* ------------------------------------------------------------ beta */

/** Hamada: βu = βL ÷ (1 + (1 − t) × D/E); D/E and t in %. */
export const unlever = (bl, dePct, taxPct) => (isNum(bl) && isNum(dePct) && isNum(taxPct) ? bl / (1 + (1 - taxPct / 100) * (dePct / 100)) : NaN);

/** Peer beta list: each peer unlevered at its own D/E and tax rate; mean and median of the complete rows. */
export function betaPeers(capm) {
  const rows = (capm?.peers || []).map((p) => ({ ...p, bu: unlever(p.beta, p.de, p.taxRate) }));
  const v = rows.map((r) => r.bu).filter(isNum).sort((x, y) => x - y);
  const mean = v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
  const median = v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN;
  return { rows, mean, median, n: v.length };
}

/* ------------------------------------------------------------ engine */

export function computeDcfT(a) {
  const d = a.dcf || blankDcfT();
  const s = { ...blankDcfSettings(), ...(d.settings || {}) };
  const cf = ['fcfe', 'ddm'].includes(s.cf) ? s.cf : 'fcff';
  const tv = s.tv === 'exit' ? 'exit' : 'gordon';
  const coeKind = s.coe === 'buildup' ? 'buildup' : 'capm';
  const n = clampN(s.histYears, 3);
  const m = clampN(s.fcstYears, 5);
  const labels = dcfLabels(s.labels, n, m, a.settings?.period?.startYear);
  const toggle = s.lease === 0 ? 0 : 1;
  const co = d.company || {};
  const price = co.price, shares = co.shares;
  const H = computePage(co.page, { n, toggle, ytd: false }).v;   // Historicals (fiscal-year columns 0…n−1)
  const h = (key, i) => H[key][i];
  const L = n - 1;                                                // latest historical year

  /* ---- Assumptions: historical ratios for reference ---- */
  // IFERROR(x / y, "") → '' where y is 0 or blank
  const r1 = (fn) => Array.from({ length: n }, (_, i) => { const x = fn(i); return isNum(x) ? x : ''; });
  const q = (a1, b1) => (z(b1) === 0 ? NaN : z(a1) / z(b1));
  const ref = {};
  ref.gRev = r1((i) => (i === 0 ? NaN : q(h('rev', i), h('rev', i - 1)) - 1));
  ref.gRev[0] = 'n.a.';
  ref.materials = r1((i) => q(h('materials', i), h('rev', i)));
  ref.employee = r1((i) => q(h('employee', i), h('rev', i)));
  ref.otherExp = r1((i) => q(h('otherExp', i), h('rev', i)));
  ref.da = r1((i) => q(h('da', i), h('rev', i)));
  ref.otherInc = r1((i) => q(h('otherInc', i), h('rev', i)));
  ref.tax = r1((i) => q(h('tax', i), h('pbt', i)));
  ref.capex = r1((i) => q(-z(h('capex', i)), h('rev', i)));
  ref.invDays = r1((i) => q(h('inventories', i), h('materials', i)) * 365);
  ref.recDays = r1((i) => q(h('receivables', i), h('rev', i)) * 365);
  ref.payDays = r1((i) => q(h('payables', i), h('materials', i)) * 365);
  ref.oca = r1((i) => q(h('otherCa', i), h('rev', i)));
  ref.ocl = r1((i) => q(h('otherCl', i), h('rev', i)));
  ref.netBorrow = r1((i) => z(h('borrowNet', i)));
  ref.intRate = Array.from({ length: n }, (_, i) => {
    if (i === 0) return 'n.a.';
    const x = q(h('finance', i), z(h('ltBorrow', i - 1)) + z(h('stBorrow', i - 1)));
    return isNum(x) ? x : '';
  });
  ref.payout = r1((i) => q(-z(h('divPaid', i)), h('patOwners', i)));

  /* ---- drivers (fractions / days / money) ---- */
  const D = {};
  for (const dd of DRIVERS.filter((x) => x.key)) {
    D[dd.key] = Array.from({ length: m }, (_, j) => (dd.fmt === 'pct' ? pc(drv(d.drivers, dd.key, j)) : z(drv(d.drivers, dd.key, j))));
  }
  // forecast years (0-based) where a driver the value depends on is blank — it counts as 0, as in the template
  const blankYears = Array.from({ length: m }, (_, j) => j).filter((j) => valueDrivers(cf).some((k) => !isNum(drv(d.drivers, k, j))));

  /* ---- Forecast sheet: columns 0…n−1 historical, n…n+m−1 forecast ---- */
  const T = n + m;
  const col = (fnH, fnF) => Array.from({ length: T }, (_, i) => (i < n ? fnH(i) : fnF(i - n, i)));
  const F = {};
  F.rev = new Array(T);
  for (let i = 0; i < T; i++) F.rev[i] = i < n ? z(h('rev', i)) : F.rev[i - 1] * (1 + D.gRev[i - n]);
  // IFERROR(rev / prior rev − 1, 0)
  F.growth = F.rev.map((r, i) => (i === 0 ? 'n.a.' : F.rev[i - 1] === 0 ? 0 : r / F.rev[i - 1] - 1));
  F.materials = col((i) => z(h('materials', i)), (j, i) => F.rev[i] * D.materials[j]);
  F.employee = col((i) => z(h('employee', i)), (j, i) => F.rev[i] * D.employee[j]);
  F.otherExp = col((i) => z(h('otherExp', i)), (j, i) => F.rev[i] * D.otherExp[j]);
  F.opex = F.materials.map((x, i) => x + F.employee[i] + F.otherExp[i]);
  F.ebitda = F.rev.map((r, i) => r - F.opex[i]);
  F.margin = F.rev.map((r, i) => (r === 0 ? 0 : F.ebitda[i] / r));
  F.da = col((i) => z(h('da', i)), (j, i) => F.rev[i] * D.da[j]);
  F.ebit = F.ebitda.map((e, i) => e - F.da[i]);
  F.otherInc = col((i) => z(h('otherInc', i)), (j, i) => F.rev[i] * D.otherInc[j]);
  /* debt schedule (needed for forecast interest) */
  F.closeDebt = new Array(T);
  F.openDebt = new Array(T);
  F.netBorrow = col((i) => z(h('borrowNet', i)), (j) => D.netBorrow[j]);
  F.intRate = col((i) => (i === 0 ? 'n.a.' : ref.intRate[i]), (j) => D.intRate[j]);
  for (let i = 0; i < T; i++) {
    F.openDebt[i] = i === 0 ? 'n.a.' : F.closeDebt[i - 1];
    F.closeDebt[i] = i < n ? z(h('ltBorrow', i)) + z(h('stBorrow', i)) : F.openDebt[i] + F.netBorrow[i];
  }
  F.finance = col((i) => z(h('finance', i)), (j, i) => F.openDebt[i] * F.intRate[i]);
  F.exceptional = col((i) => z(h('exceptional', i)), () => null);
  F.pbt = col((i) => h('pbt', i), (j, i) => F.ebit[i] + F.otherInc[i] - F.finance[i]);
  F.tax = col((i) => z(h('tax', i)), (j, i) => Math.max(0, F.pbt[i]) * D.tax[j]);
  F.pat = col((i) => h('patOwners', i), (j, i) => F.pbt[i] - F.tax[i]);
  F.eps = col((i) => h('eps', i), (j, i) => (z(shares) === 0 ? 0 : F.pat[i] / shares));
  F.dividends = col((i) => -z(h('divPaid', i)), (j, i) => Math.max(0, F.pat[i]) * D.payout[j]);
  F.dps = col((i) => (z(h('shares', i)) === 0 ? 0 : F.dividends[i] / h('shares', i)), (j, i) => (z(shares) === 0 ? 0 : F.dividends[i] / shares));
  /* working capital */
  F.inv = col((i) => z(h('inventories', i)), (j, i) => (F.materials[i] * D.invDays[j]) / 365);
  F.rec = col((i) => z(h('receivables', i)), (j, i) => (F.rev[i] * D.recDays[j]) / 365);
  F.oca = col((i) => z(h('otherCa', i)), (j, i) => F.rev[i] * D.oca[j]);
  F.pay = col((i) => z(h('payables', i)), (j, i) => (F.materials[i] * D.payDays[j]) / 365);
  F.ocl = col((i) => z(h('otherCl', i)), (j, i) => F.rev[i] * D.ocl[j]);
  F.nwc = F.inv.map((x, i) => x + F.rec[i] + F.oca[i] - F.pay[i] - F.ocl[i]);
  F.dNwc = F.nwc.map((x, i) => (i === 0 ? 'n.a.' : x - F.nwc[i - 1]));
  F.capex = col((i) => -z(h('capex', i)), (j, i) => F.rev[i] * D.capex[j]);

  /* ---- cash flows (forecast years) ---- */
  const fi = (j) => n + j;
  const years = Array.from({ length: m }, (_, j) => j);
  const flows = {};
  if (cf === 'fcff') {
    flows.ebit = years.map((j) => F.ebit[fi(j)]);
    flows.taxEbit = years.map((j) => Math.max(0, F.ebit[fi(j)]) * D.tax[j]);
    flows.nopat = years.map((j) => flows.ebit[j] - flows.taxEbit[j]);
    flows.da = years.map((j) => F.da[fi(j)]);
    flows.capex = years.map((j) => F.capex[fi(j)]);
    flows.dNwc = years.map((j) => F.dNwc[fi(j)]);
    flows.cash = years.map((j) => flows.nopat[j] + flows.da[j] - flows.capex[j] - flows.dNwc[j]);
  } else if (cf === 'fcfe') {
    flows.pat = years.map((j) => F.pat[fi(j)]);
    flows.da = years.map((j) => F.da[fi(j)]);
    flows.capex = years.map((j) => F.capex[fi(j)]);
    flows.dNwc = years.map((j) => F.dNwc[fi(j)]);
    flows.netBorrow = years.map((j) => F.netBorrow[fi(j)]);
    flows.cash = years.map((j) => flows.pat[j] + flows.da[j] - flows.capex[j] - flows.dNwc[j] + flows.netBorrow[j]);
  } else {
    flows.pat = years.map((j) => F.pat[fi(j)]);
    flows.payout = years.map((j) => D.payout[j]);
    flows.cash = years.map((j) => F.dividends[fi(j)]);
    flows.dps = years.map((j) => F.dps[fi(j)]);
  }

  /* ---- cost of equity ---- */
  const cp = d.capm || {};
  const bp = betaPeers(cp);
  const relevered = z(cp.peerBeta) * (1 + (1 - pc(cp.taxRate)) * pc(cp.targetDe));
  const beta = cp.betaMode === 'hamada' ? relevered : z(cp.beta);
  const bu = d.buildup || {};
  const coe = coeKind === 'capm'
    ? { kind: 'capm', rf: pc(cp.rf), beta, erp: pc(cp.erp), relevered, peers: bp, ke: pc(cp.rf) + beta * pc(cp.erp) }
    : { kind: 'buildup', rf: pc(bu.rf), erp: pc(bu.erp), size: pc(bu.size), industry: pc(bu.industry), specific: pc(bu.specific), country: pc(bu.country) };
  if (coeKind === 'buildup') coe.ke = coe.rf + coe.erp + coe.size + coe.industry + coe.specific + coe.country;

  /* ---- WACC and the net-debt bridge (latest historical balance sheet) ---- */
  const borrowings = z(h('ltBorrow', L)) + z(h('stBorrow', L));
  const leases = (z(h('leaseNc', L)) + z(h('leaseCur', L))) * toggle;
  const cashLike = z(h('cash', L)) + z(h('otherBank', L)) + z(h('curInvest', L));
  const bridge = { borrowings, leases, cash: cashLike, netDebt: borrowings + leases - cashLike, nci: z(h('nci', L)) };
  let wacc = null;
  if (cf === 'fcff') {
    const w = d.wacc || {};
    const kd = pc(w.kd), t = pc(w.taxRate), wd = pc(w.targetWd);
    const mve = z(price) * z(shares);
    const debtRef = borrowings + leases;
    wacc = {
      ke: coe.ke, kd, taxRate: t, kdAfter: kd * (1 - t), mve, debtRef,
      currentWd: mve + debtRef === 0 ? 0 : debtRef / (mve + debtRef),
      targetWd: wd, targetWe: 1 - wd,
    };
    wacc.wacc = wacc.targetWe * coe.ke + wd * wacc.kdAfter;
  }
  const rate = cf === 'fcff' ? wacc.wacc : coe.ke;

  /* ---- valuation ---- */
  const df = years.map((j) => 1 / (1 + rate) ** (j + 1));
  const pv = years.map((j) => flows.cash[j] * df[j]);
  const sumPv = pv.reduce((x, y) => x + y, 0);
  const lastCash = flows.cash[m - 1];
  const g = pc(s.growth);
  const mult = z(s.exitMultiple);
  const lastEbitda = F.ebitda[T - 1], lastPat = F.pat[T - 1];
  const v = { rate, df, pv, sumPv, lastCash };
  if (tv === 'gordon') {
    v.g = g;
    v.nextCash = lastCash * (1 + g);
    v.tv = rate <= g ? 'NM' : v.nextCash / (rate - g);
  } else {
    v.metric = cf === 'fcff' ? lastEbitda : lastPat;
    v.multiple = mult;
    v.tv = v.metric * mult;
  }
  v.pvTv = isNum(v.tv) ? v.tv * df[m - 1] : 'NM';
  if (cf === 'fcff') {
    v.ev = isNum(v.pvTv) ? sumPv + v.pvTv : 'NM';
    v.netDebt = bridge.netDebt;
    v.nci = bridge.nci;
    v.equity = isNum(v.ev) ? v.ev - v.netDebt - v.nci : 'NM';
  } else {
    v.equity = isNum(v.pvTv) ? sumPv + v.pvTv : 'NM';
  }
  v.shares = shares ?? null;
  v.perShare = isNum(v.equity) && z(shares) > 0 ? v.equity / shares : 'NM';
  v.price = price ?? null;
  v.upside = isNum(v.perShare) && z(price) > 0 ? v.perShare / price - 1 : 'NM';
  v.tvShare = isNum(v.pvTv) && sumPv + v.pvTv !== 0 ? v.pvTv / (sumPv + v.pvTv) : 'NM';
  if (tv === 'gordon') {
    const base = cf === 'fcff' ? lastEbitda : lastPat;
    v.implied = isNum(v.tv) && base !== 0 ? v.tv / base : 'NM';          // implied exit EV/EBITDA or P/E
  } else {
    v.implied = v.tv + lastCash !== 0 ? (v.tv * rate - lastCash) / (v.tv + lastCash) : 'NM';   // implied perpetual growth
  }

  /* ---- sensitivity: value per share, rate (rows) × g or multiple (columns) ---- */
  const rateStep = pc(isNum(s.rateStep) ? s.rateStep : DEFAULT_STEPS.rateStep);
  const tvStep = tv === 'gordon' ? pc(isNum(s.gStep) ? s.gStep : DEFAULT_STEPS.gStep) : (isNum(s.multStep) ? s.multStep : DEFAULT_STEPS.multStep);
  const ks = [-2, -1, 0, 1, 2];
  const rows = ks.map((k) => rate + k * rateStep);
  const cols = ks.map((k) => (tv === 'gordon' ? g : mult) + k * tvStep);
  const less = cf === 'fcff' ? bridge.netDebt + bridge.nci : 0;
  const grid = rows.map((r) => cols.map((c) => {
    if (z(shares) <= 0) return 'NM';
    if (tv === 'gordon' && r <= c) return 'NM';
    const sp = years.reduce((acc, j) => acc + flows.cash[j] / (1 + r) ** (j + 1), 0);
    const tvv = tv === 'gordon' ? (lastCash * (1 + c)) / (r - c) : (cf === 'fcff' ? lastEbitda : lastPat) * c;
    const out = (sp + tvv / (1 + r) ** m - less) / shares;
    return isNum(out) ? out : 'NM';
  }));

  return {
    settings: s, cf, tv, coeKind, n, m, labels, toggle, price, shares,
    hist: H, ref, drivers: D, blankYears, F, flows, coe, wacc, bridge, valuation: v,
    sens: { rows, cols, grid, rateStep, tvStep },
    template: templateName({ cf, tv, coe: coeKind }),
  };
}

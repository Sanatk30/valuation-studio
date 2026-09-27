/**
 * Recalculate a DCF workbook (the template layout) with HyperFormula and
 * compare every computed cell with the engine (dcfTemplate.js): the
 * Historicals totals, the Assumptions reference ratios, every Forecast line
 * (historical and forecast columns, the FCFF / FCFE build), the valuation
 * sheet (cash flows, discount factors, present values, terminal value, the
 * equity bridge, value per share, the cross-check and the 5 × 5 sensitivity
 * grid), the cost of equity, the beta-peer list and the WACC sheet.
 */
import { buildWorkbook } from '../../src/lib/excel/exportExcel.js';
import { colL } from '../../src/lib/excel/xlsxUtil.js';
import { computeDcfT, DRIVERS } from '../../src/lib/engine/dcfTemplate.js';
import { IS_LINES, BS_LINES, CF_LINES } from '../../src/lib/engine/companyPage.js';
import { CURRENCIES } from '../../src/lib/format.js';
import { recalc } from './recalc.mjs';
import { same } from './templateChecks.mjs';

const FROWS = {
  rev: 7, growth: 8, materials: 9, employee: 10, otherExp: 11, opex: 12, ebitda: 13, margin: 14, da: 15, ebit: 16,
  otherInc: 17, finance: 18, pbt: 20, tax: 21, pat: 22, eps: 23, dividends: 24, dps: 25,
  inv: 28, rec: 29, oca: 30, pay: 31, ocl: 32, nwc: 33, dNwc: 34, capex: 37, openDebt: 38, netBorrow: 39, closeDebt: 40, intRate: 41,
};

export function checkDcfWorkbook(a, opts = {}) {
  const tag = `dcf${opts.tag ? ` [${opts.tag}]` : ''}`;
  const st = { checks: 0, failures: 0, fails: [] };
  const ok = (cond, msg) => { st.checks++; if (!cond) { st.failures++; if (st.fails.length < 25) st.fails.push(`${tag}: ${msg}`); } };
  const cmp = (eng, sheet, addr, what) => {
    const cell = X.get(sheet, addr);
    ok(same(eng, cell), `${sheet}!${addr} ${what}: engine ${JSON.stringify(eng)} vs sheet ${JSON.stringify(cell)}`);
  };

  const wb = buildWorkbook(a, 'dcf', opts);
  const X = recalc(wb);
  const r = computeDcfT(a);
  const errs = X.errors();
  ok(errs.length === 0, `no error cells (${errs.slice(0, 3).map((e) => `${e.sheet}!${e.addr} ${e.err} ${e.formula}`).join(' | ')})`);
  const { n, m, cf, tv } = r;
  const H = (i) => colL(2 + i);
  const Fc = (j) => colL(2 + n + j);
  const V = (j) => colL(3 + j);

  /* Historicals: every calculated line */
  for (const line of [...IS_LINES, ...BS_LINES, ...CF_LINES]) {
    if (line.head || line.input || line.key === 'totalIncome') continue;
    const row = line.row >= 10 ? line.row - 1 : line.row;
    for (let i = 0; i < n; i++) cmp(r.hist[line.key][i], 'Historicals', `${H(i)}${row}`, line.label);
  }
  /* Assumptions: historical reference ratios */
  for (const d of DRIVERS.filter((x) => x.key)) for (let i = 0; i < n; i++) cmp(r.ref[d.key][i], 'Assumptions', `${H(i)}${d.row}`, `ref ${d.key}`);
  /* Forecast: every line, every column */
  for (const [key, row] of Object.entries(FROWS)) {
    for (let k = 0; k < n + m; k++) cmp(r.F[key][k], 'Forecast', `${k < n ? H(k) : Fc(k - n)}${row}`, `F.${key}[${k}]`);
  }
  /* valuation sheet */
  const S = wb.worksheets.find((w) => / - (Gordon Growth|Exit Multiple)$/.test(w.name)).name;
  const v = r.valuation;
  const row = (label) => { const x = X.row(S, label); ok(x > 0, `${S}: row "${label}"`); return x; };
  cmp(v.rate, S, 'B4', 'discount rate');
  const cashLabel = cf === 'fcff' ? 'Free Cash Flow to Firm' : cf === 'fcfe' ? 'Free Cash Flow to Equity' : 'Dividends';
  const rc = row(cashLabel), rdf = row('Discount factor'), rpv = row('Present value');
  for (let j = 0; j < m; j++) {
    cmp(r.flows.cash[j], S, `${V(j)}${rc}`, `cash[${j}]`);
    cmp(v.df[j], S, `${V(j)}${rdf}`, `df[${j}]`);
    cmp(v.pv[j], S, `${V(j)}${rpv}`, `pv[${j}]`);
  }
  const b = (label, eng) => cmp(eng, S, `B${row(label)}`, label);
  b('Sum of PV of forecast cash flows', v.sumPv);
  b('Terminal value', v.tv);
  b('PV of terminal value', v.pvTv);
  if (cf === 'fcff') { b('Enterprise Value', v.ev); b('(−) Net debt / (net cash)', v.netDebt); b('(−) Non-controlling interest', v.nci); }
  b('Equity Value', v.equity);
  b('Upside / (Downside)', v.upside);
  b('Terminal value as % of total value', v.tvShare);
  b(`Value per Share (${CURRENCIES[a.settings?.currency]?.symbol || ''})`, v.perShare);
  const implied = ['Implied exit EV / EBITDA', 'Implied exit P / E', 'Implied perpetual growth rate'].map((l) => X.row(S, l)).find((x) => x > 0);
  ok(implied > 0, 'cross-check row');
  cmp(v.implied, S, `B${implied}`, 'cross-check');
  // sensitivity grid: the header row is the one whose B cell starts "Rate ↓"
  let hr = -1;
  for (let i = 1; i < 120; i++) if (/^Rate ↓/.test(String(X.get(S, `B${i}`) || ''))) { hr = i; break; }
  ok(hr > 0, 'sensitivity grid');
  for (let i = 0; i < 5; i++) {
    cmp(r.sens.rows[i], S, `B${hr + 1 + i}`, `grid rate ${i}`);
    cmp(r.sens.cols[i], S, `${V(i)}${hr}`, `grid column ${i}`);
    for (let c = 0; c < 5; c++) cmp(r.sens.grid[i][c], S, `${V(c)}${hr + 1 + i}`, `grid ${i},${c}`);
  }
  /* cost of equity, beta peers, WACC */
  if (r.coeKind === 'capm') {
    const K = 'Cost of Equity (CAPM)';
    cmp(r.coe.ke, K, 'B9', 'Ke'); cmp(r.coe.beta, K, 'B6', 'beta'); cmp(r.coe.relevered, K, 'B16', 're-levered beta');
    const peers = r.coe.peers.rows;
    peers.forEach((p, i) => cmp(Number.isFinite(p.bu) ? p.bu : '', K, `I${14 + i}`, `peer βu ${p.name}`));
    if (peers.length) {
      cmp(Number.isFinite(r.coe.peers.mean) ? r.coe.peers.mean : 'NM', K, `I${14 + peers.length}`, 'peer βu mean');
      cmp(Number.isFinite(r.coe.peers.median) ? r.coe.peers.median : 'NM', K, `I${15 + peers.length}`, 'peer βu median');
    }
  } else cmp(r.coe.ke, 'Cost of Equity (Build-Up)', 'B12', 'Ke');
  if (cf === 'fcff') {
    const w = r.wacc;
    cmp(w.wacc, 'WACC', 'B20', 'WACC'); cmp(w.kdAfter, 'WACC', 'B11', 'after-tax Kd'); cmp(w.currentWd, 'WACC', 'B16', 'current D/(D+E)');
    cmp(w.mve, 'WACC', 'B14', 'market value of equity'); cmp(w.debtRef, 'WACC', 'B15', 'debt incl. leases');
    cmp(r.bridge.netDebt, 'WACC', 'B27', 'net debt'); cmp(r.bridge.nci, 'WACC', 'B28', 'NCI');
  } else ok(!X.sheets.includes('WACC'), 'no WACC sheet for an equity DCF');
  ok(X.row('Inputs', tv === 'gordon' ? 'Terminal (perpetual) growth rate' : `Exit ${cf === 'fcff' ? 'EV / EBITDA' : 'P / E'} multiple`) > 0, 'terminal input row');
  return { ...st, wb, X };
}

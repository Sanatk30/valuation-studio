/**
 * Recalculate an LBO workbook (the template layout) with HyperFormula and
 * compare every computed cell with the engine (lboTemplate.js): the
 * Historicals totals, the Assumptions reference ratios, the Inputs entry
 * block and debt table, Sources & Uses, every LBO Model line (operating
 * model, free cash flow, cash and debt schedule, credit statistics), the
 * Returns sheet (exit waterfall, cash flows, MOIC, IRR via Excel's IRR, the
 * value creation bridge, summary), the four sensitivity tables with their
 * headers and check, and all five Sensitivity Engine blocks.
 */
import { buildWorkbook } from '../../src/lib/excel/exportExcel.js';
import { colL } from '../../src/lib/excel/xlsxUtil.js';
import { computeLboT, LBO_DRIVERS } from '../../src/lib/engine/lboTemplate.js';
import { IS_LINES, BS_LINES, CF_LINES } from '../../src/lib/engine/companyPage.js';
import { recalc } from './recalc.mjs';
import { same } from './templateChecks.mjs';

/** LBO Model rows, laid out independently of the writer (template rows). */
export function lboRows() {
  // the revised templates: one layout for every repayment structure (revolver rows, lease payments, balloon at maturity)
  const R = {
    F: { rev: 7, growth: 8, materials: 9, employee: 10, otherExp: 11, ebitda: 12, margin: 13, da: 14, ebit: 15, inv: 26, rec: 27, oca: 28, pay: 29, ocl: 30, nwc: 31, dNwc: 32, capex: 33 },
    S: {
      intA: 16, intB: 17, intMezz: 18, intRcf: 19, pik: 20, feeAmort: 21, pbt: 22, tax: 23, ni: 24, leasePay: 41, fcf: 42,
      cashOpen: 45, mand: 47, cashAfter: 48, rcfDraw: 49, rcfRepay: 50, minCash: 51, avail: 52, sweep: 53, cashClose: 54,
      rOpen: 56, rClose: 59, rUndrawn: 60,
      aOpen: 62, aMand: 63, aSweep: 64, aClose: 65, bOpen: 67, bMand: 68, bSweep: 69, bClose: 70, mOpen: 72, mPik: 73, mClose: 74,
    },
  };
  R.C = { totalDebt: 76, leases: 77, netDebt: 78, debtEbitda: 79, ndEbitda: 80 };
  R.H = { intCover: 81, seniorRepaid: 82, shortfall: 83, headroom: 84 };
  R.last = 84;
  R.stride = 84;                                   // Sensitivity Engine: one block every 84 rows, as the revised template
  return R;
}

export function checkLboWorkbook(a, opts = {}) {
  const tag = `lbo${opts.tag ? ` [${opts.tag}]` : ''}`;
  const st = { checks: 0, failures: 0, fails: [] };
  const ok = (cond, msg) => { st.checks++; if (!cond) { st.failures++; if (st.fails.length < 25) st.fails.push(`${tag}: ${msg}`); } };
  const cmp = (eng, sheet, addr, what) => {
    const cell = X.get(sheet, addr);
    ok(same(eng, cell), `${sheet}!${addr} ${what}: engine ${JSON.stringify(eng)} vs sheet ${JSON.stringify(cell)}`);
  };

  const wb = buildWorkbook(a, 'lbo');
  const X = recalc(wb);
  const r = computeLboT(a);
  const errs = X.errors();
  ok(errs.length === 0, `no error cells (${errs.slice(0, 3).map((e) => `${e.sheet}!${e.addr} ${e.err} ${e.formula}`).join(' | ')})`);
  const { n, m, repay } = r;
  const R = lboRows();
  const col = (k) => colL(2 + k);                 // 0…n−1 actual, n…n+m−1 hold
  const E0 = col(n - 1), XL = col(n + m - 1);
  const dl = n + m - 8;
  const IN = (row) => row + dl;                   // Inputs rows below the period labels shift

  /* Historicals and Assumptions */
  for (const line of [...IS_LINES, ...BS_LINES, ...CF_LINES]) {
    if (line.head || line.input || line.key === 'totalIncome') continue;
    const row = line.row >= 10 ? line.row - 1 : line.row;
    for (let i = 0; i < n; i++) cmp(r.hist[line.key][i], 'Historicals', `${col(i)}${row}`, line.label);
  }
  for (const d of LBO_DRIVERS.filter((x) => x.key)) for (let i = 0; i < n; i++) cmp(r.ref[d.key][i], 'Assumptions', `${col(i)}${d.row}`, `ref ${d.key}`);

  /* Inputs */
  const e = r.entry;
  [[19, e.ebitda], [21, e.ev], [24, e.borrowings], [25, e.leases], [26, e.cash], [27, e.nci], [28, e.equityPrice], [31, e.txnFees]]
    .forEach(([row, v]) => cmp(v, 'Inputs', `B${IN(row)}`, `entry row ${row}`));
  cmp(e.cashWarn, 'Inputs', `F${IN(29)}`, 'cash warning');
  ['senA', 'senB', 'mezz'].forEach((k, i) => {
    cmp(r.tranches[k].amount, 'Inputs', `C${IN(35 + i)}`, `${k} amount`);
    cmp(r.tranches[k].fee, 'Inputs', `I${IN(35 + i)}`, `${k} fee`);
  });
  cmp(r.totalDebt.x, 'Inputs', `B${IN(38)}`, 'total x');
  cmp(r.totalDebt.amount, 'Inputs', `C${IN(38)}`, 'total debt');
  cmp(r.totalDebt.fee, 'Inputs', `I${IN(38)}`, 'total fees');
  cmp(r.mezzWarn, 'Inputs', `F${IN(39)}`, 'mezzanine tenor warning');

  /* Sources & Uses */
  const su = r.su;
  for (let i = 0; i < 4; i++) cmp(su.uses[i], 'Sources & Uses', `B${5 + i}`, `use ${i}`);
  cmp(su.totalUses, 'Sources & Uses', 'B10', 'total uses');
  for (let i = 0; i < 5; i++) cmp(su.sources[i], 'Sources & Uses', `G${5 + i}`, `source ${i}`);
  cmp(su.totalSources, 'Sources & Uses', 'G10', 'total sources');
  [0, 1, 2, 3].forEach((i) => { cmp(su.usesPct[i], 'Sources & Uses', `C${5 + i}`, `use % ${i}`); cmp(su.usesX[i], 'Sources & Uses', `D${5 + i}`, `use x ${i}`); });
  cmp(su.usesPct[4], 'Sources & Uses', 'C10', 'uses % total'); cmp(su.usesX[4], 'Sources & Uses', 'D10', 'uses x total');
  for (let i = 0; i < 6; i++) { cmp(su.sourcesPct[i], 'Sources & Uses', `H${5 + i}`, `source % ${i}`); cmp(su.sourcesX[i], 'Sources & Uses', `I${5 + i}`, `source x ${i}`); }
  cmp(su.check, 'Sources & Uses', 'B12', 'check');
  cmp(su.equityFlag, 'Sources & Uses', 'B13', 'equity flag');
  const sts = su.stats;
  [sts.entryMultiple, sts.debtEbitda, sts.seniorEbitda, sts.equityPct, sts.debtPct].forEach((v, i) => cmp(v, 'Sources & Uses', `B${16 + i}`, `stat ${i}`));

  /* LBO Model and each Sensitivity Engine block */
  const model = (sheet, run, off, engine) => {
    const at = (row) => row + off;
    for (const [key, row] of Object.entries(R.F)) {
      for (let k = engine ? n - 1 : 0; k < n + m; k++) {
        if (engine && k === n - 1 && n > 1 && (key === 'growth' || key === 'dNwc')) continue;   // the engine's entry column refers to a blank column
        cmp(run.F[key][k], sheet, `${col(k)}${at(row)}`, `F.${key}[${k}]`);
      }
    }
    for (const [key, row] of Object.entries(R.S)) {
      for (let j = 0; j < m; j++) {
        const v = key === 'mand' ? run.S.aMand[j] + run.S.bMand[j] : run.S[key][j];
        cmp(v, sheet, `${col(n + j)}${at(row)}`, `S.${key}[${j}]`);
      }
    }
    cmp(r.entry.cashAfter, sheet, `${E0}${at(R.S.cashClose)}`, 'cash at entry');
    cmp(r.tranches.senA.amount, sheet, `${E0}${at(R.S.aClose)}`, 'Senior A at entry');
    cmp(r.tranches.senB.amount, sheet, `${E0}${at(R.S.bClose)}`, 'Senior B at entry');
    cmp(r.tranches.mezz.amount, sheet, `${E0}${at(R.S.mClose)}`, 'Mezzanine at entry');
    for (const [key, row] of Object.entries(R.C)) for (let k = 0; k <= m; k++) cmp(run.C[key][k], sheet, `${col(n - 1 + k)}${at(row)}`, `C.${key}[${k}]`);
    for (const [key, row] of Object.entries(R.H)) for (let j = 0; j < m; j++) cmp(run.C[key][j], sheet, `${col(n + j)}${at(row)}`, `C.${key}[${j}]`);
  };
  model('LBO Model', r, 0, false);
  r.sens.runs.forEach((run, i) => {
    const base = 4 + i * R.stride;
    cmp(r.sens.cases[i].shift, 'Sensitivity Engine', `B${base}`, `case ${i + 1} shift`);
    model('Sensitivity Engine', run, 1 + i * R.stride, true);
  });

  /* Returns */
  const w = r.exit;
  [w.ebitda, w.multiple, w.ev, w.senA, w.senB, w.mezz, w.rcf, w.leases, w.nci, w.cash, w.equity].forEach((v, i) => cmp(v, 'Returns', `B${5 + i}`, `waterfall ${i}`));
  r.flows.forEach((v, j) => cmp(v, 'Returns', `${colL(2 + j)}20`, `flow ${j}`));
  cmp(r.moic, 'Returns', 'B24', 'MOIC');
  cmp(r.irr, 'Returns', 'B25', 'IRR (Excel IRR vs closed form)');
  cmp(r.bridge.entry, 'Returns', 'B29', 'bridge entry');
  r.bridge.parts.forEach((v, i) => { cmp(v, 'Returns', `B${30 + i}`, `bridge ${i}`); cmp(r.bridge.pct[i], 'Returns', `C${30 + i}`, `bridge % ${i}`); });
  cmp(r.bridge.exit, 'Returns', 'B34', 'bridge exit');
  cmp(r.bridge.check, 'Returns', 'B36', 'bridge check');
  const sm = r.summary;
  [sm.entryEv, sm.exitEv, sm.ebitdaCagr, sm.ndEbitdaEntry, sm.ndEbitdaExit].forEach((v, i) => cmp(v, 'Returns', `B${40 + i}`, `summary ${i}`));

  /* Sensitivity */
  const sn = r.sens;
  const C = (i) => colL(3 + i);
  for (const top of [5, 15]) {
    sn.cases.forEach((c, i) => { cmp(c.shift, 'Sensitivity', `${C(i)}${top}`, `shift ${i}`); cmp(c.ebitdaCagr, 'Sensitivity', `${C(i)}${top + 1}`, `CAGR ${i}`); });
    sn.exitRows.forEach((x, ri) => cmp(x, 'Sensitivity', `B${top + 2 + ri}`, `exit row ${ri}`));
  }
  for (const top of [25, 34]) {
    sn.exitRows.forEach((x, i) => cmp(x, 'Sensitivity', `${C(i)}${top}`, `exit col ${i}`));
    sn.entryRows.forEach((x, ri) => cmp(x, 'Sensitivity', `B${top + 1 + ri}`, `entry row ${ri}`));
  }
  for (let ri = 0; ri < 5; ri++) for (let i = 0; i < 5; i++) {
    cmp(sn.growthIrr[ri][i], 'Sensitivity', `${C(i)}${7 + ri}`, `T1 [${ri},${i}]`);
    cmp(sn.growthMoic[ri][i], 'Sensitivity', `${C(i)}${17 + ri}`, `T2 [${ri},${i}]`);
    cmp(sn.multIrr[ri][i], 'Sensitivity', `${C(i)}${26 + ri}`, `T3 [${ri},${i}]`);
    cmp(sn.multMoic[ri][i], 'Sensitivity', `${C(i)}${35 + ri}`, `T4 [${ri},${i}]`);
  }
  cmp(sn.engineCheck, 'Sensitivity', 'E42', 'engine check');
  /* centre cells equal the base case */
  ok(same(r.irr, X.get('Sensitivity', 'E9')) && same(r.irr, X.get('Sensitivity', 'E28')), 'IRR tables: centre = base-case IRR');
  ok(same(r.moic, X.get('Sensitivity', 'E19')) && same(r.moic, X.get('Sensitivity', 'E37')), 'MOIC tables: centre = base-case MOIC');

  return { ...st, wb, X, r };
}

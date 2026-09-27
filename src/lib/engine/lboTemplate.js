/**
 * LBO on the user's three LBO templates (LBO_Mandatory_Repayment_Only,
 * LBO_Mandatory_Plus_CashSweep, LBO_CashSweep_Only). One engine; the settings
 * pick how Senior A and Senior B are repaid:
 *
 *   'mandatory'  scheduled amortisation only; excess cash builds up and is
 *                added to the equity value at exit
 *   'both'       scheduled amortisation, then excess cash above the minimum
 *                balance swept (× sweep %) — Senior A first, then Senior B
 *   'sweep'      no scheduled amortisation; the sweep only
 *
 * Mezzanine is a bullet repaid at exit, with cash and PIK interest.
 * Generalised to N historical years (1–10, template 3) and an M-year hold
 * (1–10, template 5): entry at the end of the latest actual year, exit at the
 * end of forecast year M.
 *
 * Every figure follows the template's formulas, including how Excel reads a
 * blank cell (0). Cell values are numbers, 'n.a.', '' (an IFERROR blank),
 * 'NM', 'OK' / 'SHORTFALL' / 'CHECK'. Rates are fractions inside the engine;
 * the stored inputs keep percentages as the app shows them (9 = 9 %).
 */
import { blankPage, computePage } from './companyPage.js';
import { clampN, dcfLabels } from './dcfTemplate.js';

export const REPAY_KINDS = [
  { value: 'mandatory', label: 'Mandatory repayment only', file: 'LBO_Mandatory_Repayment_Only', note: 'Senior A and Senior B pay only scheduled (mandatory) amortisation. Any excess cash accumulates on the balance sheet and is added to equity value at exit. Mezzanine is a bullet repaid at exit.' },
  { value: 'both', label: 'Mandatory repayment + cash sweep', file: 'LBO_Mandatory_Plus_CashSweep', note: 'Senior A and Senior B pay scheduled (mandatory) amortisation. Excess cash above the minimum balance is then swept – Senior A first, then Senior B. Mezzanine is a bullet repaid at exit.' },
  { value: 'sweep', label: 'Cash sweep only', file: 'LBO_CashSweep_Only', note: 'No scheduled amortisation. Excess cash above the minimum balance is swept to prepay Senior A first, then Senior B. Mezzanine is a bullet repaid at exit.' },
];
export const repayKind = (v) => REPAY_KINDS.find((k) => k.value === v) || REPAY_KINDS[1];

/** Operating drivers (the Assumptions sheet, rows 6–20). */
export const LBO_DRIVERS = [
  { section: 'P&L DRIVERS', row: 6 },
  { key: 'gRev', row: 7, label: 'Revenue growth', fmt: 'pct', example: '12.0%', note: 'YoY growth' },
  { key: 'materials', row: 8, label: 'Cost of materials (% of revenue)', fmt: 'pct', example: '58.0%' },
  { key: 'employee', row: 9, label: 'Employee expenses (% of revenue)', fmt: 'pct', example: '10.0%' },
  { key: 'otherExp', row: 10, label: 'Other expenses (% of revenue)', fmt: 'pct', example: '14.5%' },
  { key: 'da', row: 11, label: 'Depreciation & amortisation (% of revenue)', fmt: 'pct', example: '3.6%' },
  { key: 'tax', row: 12, label: 'Effective tax rate (% of PBT)', fmt: 'pct', example: '25.2%', note: 'Applied to PBT after LBO interest' },
  { section: 'INVESTMENT & WORKING CAPITAL', row: 14 },
  { key: 'capex', row: 15, label: 'Capex (% of revenue)', fmt: 'pct', example: '7.0%', note: 'Enter as positive %' },
  { key: 'invDays', row: 16, label: 'Inventory days (on cost of materials)', fmt: 'days', example: '90', note: 'Closing balance basis, 365 days' },
  { key: 'recDays', row: 17, label: 'Receivable days (on revenue)', fmt: 'days', example: '50' },
  { key: 'payDays', row: 18, label: 'Payable days (on cost of materials)', fmt: 'days', example: '75' },
  { key: 'oca', row: 19, label: 'Other current assets (% of revenue)', fmt: 'pct', example: '3.2%' },
  { key: 'ocl', row: 20, label: 'Other current liabilities (% of revenue)', fmt: 'pct', example: '7.7%' },
];
export const LBO_DRIVER_KEYS = LBO_DRIVERS.filter((d) => d.key).map((d) => d.key);

export const TRANCHES = [
  { key: 'senA', label: 'Senior A (Term Loan A)' },
  { key: 'senB', label: 'Senior B (Term Loan B)' },
  { key: 'mezz', label: 'Mezzanine' },
];

export const DEFAULT_LBO_STEPS = { exitStep: 1, entryStep: 1, growthStep: 2 };

/**
 * The structural choices start blank (picked on the Settings step); only the
 * sensitivity step sizes are pre-filled with the template's examples.
 */
export const blankLboT = () => ({
  settings: {
    repay: null, histYears: null, holdYears: null, labels: null, lease: null,
    exitStep: DEFAULT_LBO_STEPS.exitStep, entryStep: DEFAULT_LBO_STEPS.entryStep, growthStep: DEFAULT_LBO_STEPS.growthStep,
  },
  company: { page: blankPage() },
  drivers: Object.fromEntries(LBO_DRIVER_KEYS.map((k) => [k, []])),
  deal: { entryMultiple: null, cashUsed: null, txnFeePct: null, exitMultiple: null },
  debt: {
    senA: { x: null, rate: null, amort: null, tenor: null, feePct: null },
    senB: { x: null, rate: null, amort: null, tenor: null, feePct: null },
    mezz: { x: null, rate: null, pik: null, tenor: null, feePct: null },
  },
  cash: { sweepPct: null, minCash: null },
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const z = (v) => (isNum(v) ? v : 0);
const pc = (v) => z(v) / 100;
/** IFERROR(a / b, fallback) with Excel's blank-as-0. */
const q = (a, b, fallback) => (z(b) === 0 ? fallback : z(a) / z(b));

/**
 * One run of the LBO Model sheet (also what each Sensitivity Engine block
 * repeats, with every forecast year's growth shifted by `shift`).
 * Columns 0…n−1 historical (n−1 = entry, Year 0), n…n+m−1 the hold.
 */
function runModel(ctx, shift) {
  const { n, m, H, D, entry, tr, repay, sweepPct, minCash } = ctx;
  const T = n + m;
  const h = (k, i) => H[k][i];
  const F = {};
  const col = (fh, ff) => Array.from({ length: T }, (_, i) => (i < n ? fh(i) : ff(i - n, i)));
  F.rev = new Array(T);
  for (let i = 0; i < T; i++) F.rev[i] = i < n ? z(h('rev', i)) : F.rev[i - 1] * (1 + D.gRev[i - n] + shift);
  F.growth = F.rev.map((r, i) => (i === 0 ? 'n.a.' : F.rev[i - 1] === 0 ? 0 : r / F.rev[i - 1] - 1));
  F.materials = col((i) => z(h('materials', i)), (j, i) => F.rev[i] * D.materials[j]);
  F.employee = col((i) => z(h('employee', i)), (j, i) => F.rev[i] * D.employee[j]);
  F.otherExp = col((i) => z(h('otherExp', i)), (j, i) => F.rev[i] * D.otherExp[j]);
  F.ebitda = F.rev.map((r, i) => r - F.materials[i] - F.employee[i] - F.otherExp[i]);
  F.margin = F.rev.map((r, i) => (r === 0 ? 0 : F.ebitda[i] / r));
  F.da = col((i) => z(h('da', i)), (j, i) => F.rev[i] * D.da[j]);
  F.ebit = F.ebitda.map((e, i) => e - F.da[i]);
  /* working capital & capex */
  F.inv = col((i) => z(h('inventories', i)), (j, i) => (F.materials[i] * D.invDays[j]) / 365);
  F.rec = col((i) => z(h('receivables', i)), (j, i) => (F.rev[i] * D.recDays[j]) / 365);
  F.oca = col((i) => z(h('otherCa', i)), (j, i) => F.rev[i] * D.oca[j]);
  F.pay = col((i) => z(h('payables', i)), (j, i) => (F.materials[i] * D.payDays[j]) / 365);
  F.ocl = col((i) => z(h('otherCl', i)), (j, i) => F.rev[i] * D.ocl[j]);
  F.nwc = F.inv.map((x, i) => x + F.rec[i] + F.oca[i] - F.pay[i] - F.ocl[i]);
  F.dNwc = F.nwc.map((x, i) => (i === 0 ? 'n.a.' : x - F.nwc[i - 1]));
  F.capex = col((i) => -z(h('capex', i)), (j, i) => F.rev[i] * D.capex[j]);

  /* hold years: interest, tax, FCF, cash & debt (arrays of length m) */
  const Y = Array.from({ length: m }, (_, j) => j);
  const at = (j) => n + j;
  const S = {
    intA: [], intB: [], intMezz: [], pik: [], feeAmort: [], pbt: [], tax: [], ni: [],
    fcf: [], cashOpen: [], mand: [], minCash: [], avail: [], sweep: [], cashClose: [],
    aOpen: [], aMand: [], aSweep: [], aClose: [], bOpen: [], bMand: [], bSweep: [], bClose: [],
    mOpen: [], mPik: [], mClose: [],
  };
  let cash = entry.cashAfter, a = tr.senA.amount, b = tr.senB.amount, mz = tr.mezz.amount;
  for (const j of Y) {
    const t = j + 1;
    S.aOpen[j] = a; S.bOpen[j] = b; S.mOpen[j] = mz; S.cashOpen[j] = cash;
    S.intA[j] = a * tr.senA.rate;
    S.intB[j] = b * tr.senB.rate;
    S.intMezz[j] = mz * tr.mezz.rate;
    S.pik[j] = mz * tr.mezz.pik;
    // IFERROR(IF(t <= tenor, fee / tenor, 0), 0) per tranche
    S.feeAmort[j] = TRANCHES.reduce((s, k) => s + (t <= tr[k.key].tenor ? q(tr[k.key].fee, tr[k.key].tenor, 0) : 0), 0);
    S.pbt[j] = F.ebit[at(j)] - S.intA[j] - S.intB[j] - S.intMezz[j] - S.pik[j] - S.feeAmort[j];
    S.tax[j] = Math.max(0, S.pbt[j]) * D.tax[j];
    S.ni[j] = S.pbt[j] - S.tax[j];
    S.fcf[j] = S.ni[j] + F.da[at(j)] + S.pik[j] + S.feeAmort[j] - F.capex[at(j)] - F.dNwc[at(j)];
    S.aMand[j] = repay === 'sweep' ? 0 : Math.min(a, tr.senA.amount * tr.senA.amort);
    S.bMand[j] = repay === 'sweep' ? 0 : Math.min(b, tr.senB.amount * tr.senB.amort);
    S.mand[j] = S.aMand[j] + S.bMand[j];
    if (repay === 'mandatory') {
      S.aSweep[j] = 0; S.bSweep[j] = 0; S.sweep[j] = 0;
      S.cashClose[j] = cash + S.fcf[j] - S.mand[j];
    } else {
      S.minCash[j] = minCash;
      S.avail[j] = Math.max(0, cash + S.fcf[j] - S.mand[j] - minCash) * sweepPct;
      S.aSweep[j] = Math.min(S.avail[j], a - S.aMand[j]);
      S.bSweep[j] = Math.min(S.avail[j] - S.aSweep[j], b - S.bMand[j]);
      S.sweep[j] = S.aSweep[j] + S.bSweep[j];
      S.cashClose[j] = cash + S.fcf[j] - S.mand[j] - S.sweep[j];
    }
    S.aClose[j] = a - S.aMand[j] - S.aSweep[j];
    S.bClose[j] = b - S.bMand[j] - S.bSweep[j];
    S.mPik[j] = S.pik[j];
    S.mClose[j] = mz + S.pik[j];
    cash = S.cashClose[j]; a = S.aClose[j]; b = S.bClose[j]; mz = S.mClose[j];
  }
  /* credit statistics: index 0 = entry (Year 0), then the hold years */
  const E0 = F.ebitda[n - 1];
  const debt0 = tr.senA.amount + tr.senB.amount + tr.mezz.amount;
  const C = {
    totalDebt: [debt0, ...Y.map((j) => S.aClose[j] + S.bClose[j] + S.mClose[j])],
    leases: [entry.leases, ...Y.map(() => entry.leases)],
  };
  const cashCol = [entry.cashAfter, ...S.cashClose];
  C.netDebt = C.totalDebt.map((d, k) => d + C.leases[k] - cashCol[k]);
  const ebitdaCol = [E0, ...Y.map((j) => F.ebitda[at(j)])];
  C.debtEbitda = C.totalDebt.map((d, k) => q(d, ebitdaCol[k], 0));
  C.ndEbitda = C.netDebt.map((d, k) => q(d, ebitdaCol[k], 0));
  C.intCover = Y.map((j) => q(F.ebitda[at(j)], S.intA[j] + S.intB[j] + S.intMezz[j], 0));
  C.seniorRepaid = Y.map((j) => (tr.senA.amount + tr.senB.amount === 0 ? 0 : 1 - (S.aClose[j] + S.bClose[j]) / (tr.senA.amount + tr.senB.amount)));
  C.shortfall = Y.map((j) => (S.cashClose[j] < -0.001 ? 'SHORTFALL' : 'OK'));
  return { F, S, C };
}

export function computeLboT(a) {
  const d = a.lbo || blankLboT();
  const s = { ...blankLboT().settings, ...(d.settings || {}) };
  const repay = ['mandatory', 'both', 'sweep'].includes(s.repay) ? s.repay : 'both';
  const n = clampN(s.histYears, 3);
  const m = clampN(s.holdYears, 5);
  const labels = dcfLabels(s.labels, n, m, a.settings?.period?.startYear);
  const toggle = s.lease === 0 ? 0 : 1;
  const H = computePage(d.company?.page, { n, toggle, ytd: false }).v;
  const L = n - 1;
  const h = (k, i) => H[k][i];

  /* Assumptions: historical reference ratios (IFERROR(…, "") → '') */
  const r1 = (fn) => Array.from({ length: n }, (_, i) => { const x = fn(i); return isNum(x) ? x : ''; });
  const qq = (x, y) => (z(y) === 0 ? NaN : z(x) / z(y));
  const ref = {
    gRev: r1((i) => (i === 0 ? NaN : qq(h('rev', i), h('rev', i - 1)) - 1)),
    materials: r1((i) => qq(h('materials', i), h('rev', i))),
    employee: r1((i) => qq(h('employee', i), h('rev', i))),
    otherExp: r1((i) => qq(h('otherExp', i), h('rev', i))),
    da: r1((i) => qq(h('da', i), h('rev', i))),
    tax: r1((i) => qq(h('tax', i), h('pbt', i))),
    capex: r1((i) => qq(-z(h('capex', i)), h('rev', i))),
    invDays: r1((i) => qq(h('inventories', i), h('materials', i)) * 365),
    recDays: r1((i) => qq(h('receivables', i), h('rev', i)) * 365),
    payDays: r1((i) => qq(h('payables', i), h('materials', i)) * 365),
    oca: r1((i) => qq(h('otherCa', i), h('rev', i))),
    ocl: r1((i) => qq(h('otherCl', i), h('rev', i))),
  };
  ref.gRev[0] = 'n.a.';

  const D = {};
  for (const dd of LBO_DRIVERS.filter((x) => x.key)) {
    D[dd.key] = Array.from({ length: m }, (_, j) => {
      const v = Array.isArray(d.drivers?.[dd.key]) ? d.drivers[dd.key][j] : null;
      return dd.fmt === 'pct' ? pc(v) : z(v);
    });
  }

  /* entry valuation (Inputs rows 19–31) */
  const deal = d.deal || {};
  const ebitda0 = z(h('rev', L)) - z(h('materials', L)) - z(h('employee', L)) - z(h('otherExp', L));
  const entryMult = z(deal.entryMultiple);
  const ev = ebitda0 * entryMult;
  const borrowings = z(h('ltBorrow', L)) + z(h('stBorrow', L));
  const leases = (z(h('leaseNc', L)) + z(h('leaseCur', L))) * toggle;
  const cashExisting = z(h('cash', L)) + z(h('otherBank', L)) + z(h('curInvest', L));
  const nci = z(h('nci', L));
  const cashUsed = z(deal.cashUsed);
  const txnFeePct = pc(deal.txnFeePct);
  const entry = {
    ebitda: ebitda0, multiple: entryMult, ev, borrowings, leases, cash: cashExisting, nci,
    equityPrice: ev - borrowings - leases + cashExisting - nci,
    cashUsed, cashWarn: cashUsed > cashExisting ? '⚠ exceeds existing cash' : '',
    txnFeePct, txnFees: ev * txnFeePct,
    cashAfter: cashExisting - cashUsed,
  };

  /* debt financing (Inputs rows 34–38) */
  const db = d.debt || {};
  const tr = {};
  for (const t of TRANCHES) {
    const x = db[t.key] || {};
    const amount = z(x.x) * ebitda0;
    tr[t.key] = {
      x: z(x.x), amount, rate: pc(x.rate), pik: t.key === 'mezz' ? pc(x.pik) : 0,
      amort: t.key === 'mezz' ? 0 : pc(x.amort), tenor: z(x.tenor), feePct: pc(x.feePct), fee: amount * pc(x.feePct),
    };
  }
  const totalDebt = { x: tr.senA.x + tr.senB.x + tr.mezz.x, amount: tr.senA.amount + tr.senB.amount + tr.mezz.amount, fee: tr.senA.fee + tr.senB.fee + tr.mezz.fee };

  /* sources & uses */
  const uses = [entry.equityPrice, borrowings, entry.txnFees, totalDebt.fee];
  const totalUses = uses.reduce((x, y) => x + y, 0);
  const sponsor = totalUses - (tr.senA.amount + tr.senB.amount + tr.mezz.amount + cashUsed);
  const sources = [tr.senA.amount, tr.senB.amount, tr.mezz.amount, cashUsed, sponsor];
  const totalSources = sources.reduce((x, y) => x + y, 0);
  const share = (v, tot) => (tot === 0 ? 0 : v / tot);
  const su = {
    uses, totalUses, sources, totalSources, sponsor,
    usesPct: [...uses, totalUses].map((v) => share(v, totalUses)),
    usesX: [...uses, totalUses].map((v) => q(v, ebitda0, 0)),
    sourcesPct: [...sources, totalSources].map((v) => share(v, totalSources)),
    sourcesX: [...sources, totalSources].map((v) => q(v, ebitda0, 0)),
    check: Math.round((totalSources - totalUses) * 10) / 10,
    equityFlag: sponsor < 0 ? 'CHECK' : 'OK',
    stats: {
      entryMultiple: entryMult, debtEbitda: totalDebt.x, seniorEbitda: tr.senA.x + tr.senB.x,
      equityPct: share(sponsor, totalSources),
      debtPct: (tr.senA.amount + tr.senB.amount + tr.mezz.amount + sponsor) === 0 ? 0 : (tr.senA.amount + tr.senB.amount + tr.mezz.amount) / (tr.senA.amount + tr.senB.amount + tr.mezz.amount + sponsor),
    },
  };

  /* the model */
  const cashM = d.cash || {};
  const ctx = { n, m, H, D, entry, tr, repay, sweepPct: pc(cashM.sweepPct), minCash: z(cashM.minCash) };
  const base = runModel(ctx, 0);
  const { F, S, C } = base;

  /* returns */
  const T = n + m;
  const exitMult = z(deal.exitMultiple);
  const exitEbitda = F.ebitda[T - 1];
  const exitEv = exitEbitda * exitMult;
  const w = {
    ebitda: exitEbitda, multiple: exitMult, ev: exitEv,
    senA: S.aClose[m - 1], senB: S.bClose[m - 1], mezz: S.mClose[m - 1], leases, nci, cash: S.cashClose[m - 1],
  };
  w.equity = exitEv - w.senA - w.senB - w.mezz - w.leases - w.nci + w.cash;
  const flows = [-sponsor, ...Array.from({ length: m - 1 }, () => 0), w.equity];
  const moic = sponsor > 0 ? w.equity / sponsor : 'NM';
  const irr = sponsor > 0 && w.equity > 0 ? (w.equity / sponsor) ** (1 / m) - 1 : 'NM';
  const parts = [
    (exitEbitda - ebitda0) * exitMult,
    ebitda0 * (exitMult - entryMult),
    C.netDebt[0] - C.netDebt[m],
    -(entry.txnFees + totalDebt.fee),
  ];
  const created = parts.reduce((x, y) => x + y, 0);
  const bridge = {
    entry: sponsor, parts, pct: parts.map((p) => (created === 0 ? 0 : p / created)),
    exit: sponsor + created, check: Math.round((sponsor + created - w.equity) * 10) / 10,
  };
  const summary = {
    entryEv: ev, exitEv, ebitdaCagr: cagr(exitEbitda, ebitda0, m),
    ndEbitdaEntry: C.ndEbitda[0], ndEbitdaExit: C.ndEbitda[m],
  };

  /* sensitivity */
  const st = s;
  const exitStep = isNum(st.exitStep) ? st.exitStep : DEFAULT_LBO_STEPS.exitStep;
  const entryStep = isNum(st.entryStep) ? st.entryStep : DEFAULT_LBO_STEPS.entryStep;
  const growthStep = pc(isNum(st.growthStep) ? st.growthStep : DEFAULT_LBO_STEPS.growthStep);
  const ks = [-2, -1, 0, 1, 2];
  const cases = ks.map((k) => {
    const shift = k * growthStep;
    const run = k === 0 ? base : runModel(ctx, shift);
    const e5 = run.F.ebitda[T - 1];
    return { shift, run, exitEbitda: e5, exitNetDebt: run.C.netDebt[m], ebitdaCagr: cagr(e5, run.F.ebitda[n - 1], m) };
  });
  const exitRows = ks.map((k) => exitMult + k * exitStep);
  const entryRows = ks.map((k) => entryMult + k * entryStep);
  const irrOf = (ex, en) => (en <= 0 || ex <= 0 ? 'NM' : fin((ex / en) ** (1 / m) - 1));
  const moicOf = (ex, en) => (en <= 0 ? 'NM' : fin(ex / en));
  const growthIrr = exitRows.map((x) => cases.map((c) => irrOf(x * c.exitEbitda - c.exitNetDebt - nci, sponsor)));
  const growthMoic = exitRows.map((x) => cases.map((c) => moicOf(x * c.exitEbitda - c.exitNetDebt - nci, sponsor)));
  const entryEq = (em) => em * ebitda0 * (1 + txnFeePct) + totalDebt.fee - C.netDebt[0] - nci;
  const exitEq = (xm) => xm * exitEbitda - C.netDebt[m] - nci;
  const multIrr = entryRows.map((em) => exitRows.map((xm) => irrOf(exitEq(xm), entryEq(em))));
  const multMoic = entryRows.map((em) => exitRows.map((xm) => moicOf(exitEq(xm), entryEq(em))));

  return {
    settings: s, repay, n, m, labels, toggle, hist: H, ref, drivers: D,
    entry, tranches: tr, totalDebt, su, F, S, C,
    exit: w, flows, moic, irr, bridge, summary,
    sens: {
      exitRows, entryRows, cases: cases.map(({ shift, ebitdaCagr, exitEbitda: ee, exitNetDebt }) => ({ shift, ebitdaCagr, exitEbitda: ee, exitNetDebt })),
      growthIrr, growthMoic, multIrr, multMoic, steps: { exitStep, entryStep, growthStep },
      engineCheck: Math.round((cases[2].exitNetDebt - C.netDebt[m]) * 10) / 10,
      runs: cases.map((c) => c.run),
    },
    file: repayKind(repay).file,
  };
}

/** IFERROR((to / from)^(1/years) − 1, 0) — Excel's power of a negative base to a fraction is #NUM!. */
function cagr(to, from, years) {
  if (z(from) === 0) return 0;
  const ratio = to / from;
  const x = ratio ** (1 / years) - 1;
  return Number.isFinite(x) ? x : 0;
}
/** A finite number or 'NM' (IFERROR(…, "NM")). */
const fin = (x) => (Number.isFinite(x) ? x : 'NM');

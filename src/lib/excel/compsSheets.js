/**
 * Comparable companies analysis workbook, in the layout of the Rosenbaum &
 * Pearl (Investment Banking, 3E) template — LTM only:
 *
 *   Benchmarking 1    — market valuation, LTM financials, margins, historical growth
 *   Benchmarking 2    — general, returns, leverage, coverage, credit ratings
 *   Comps Analysis    — the tiered LTM trading-multiples output page
 *   Implied Valuation — peer LTM quartiles × the target's LTM metrics → share price
 *   List              — company, ticker, description, equity value, EV, LTM figures
 *   <Target>          — the target's page, linked to the Inputs sheet
 *   <Peer> × n        — one full input page per comparable company
 *
 * Every analysis cell is a live cross-sheet link into a company page, and every
 * company-page cell is a formula off that page's blue inputs.
 *
 * Blank semantics (engine/compsCo.js): a blank CORE line (sales, costs,
 * interest, taxes, D&A, cash flow, balances, share counts, price, tax rate,
 * beta, dates) is written as the text "NA" and every figure built from it
 * reads NA; a blank ADJUSTMENT line (non-recurring items, NCI, preferred,
 * options, convertibles, both stub periods) is written as 0. Totals are
 * explicit sums, never SUM(), so an NA can never be skipped silently.
 */
import {
  put, colL, colN, na, nv, sheetName, styleSheet, fillRow, edge, colRun,
  C_INPUT, C_LINK, C_HDR_FILL, C_HDR_TEXT, C_SECTION_FILL, C_GRID_FILL, C_MUTED,
  C_RULE, C_TAB_ANALYSIS, C_TAB_INPUT,
} from './xlsxUtil.js';
import {
  LIST_COLS, BENCH1_GROUPS, BENCH2_GROUPS, OUTPUT_GROUPS, IMPLIED_ROWS, resolveTiers, targetCompanyPage,
} from '../engine/comps.js';

/* ------------------------------------------------------- company sheet map */

/** Income-statement period columns: FY-2, FY-1, FY0, prior stub, current stub, LTM. */
const IS_COL = ['I', 'J', 'K', 'L', 'M', 'N'];
/** Balance-sheet columns: prior, current. */
const BS_COL = ['S', 'T'];

/** Fixed rows, plus the two variable-length sub-tables at the bottom of column P. */
export function companyLayout(optCount, convCount) {
  const optHdr = 44, optSub = 45, optCols = 46, optStart = 47;
  const optTotal = optStart + optCount;
  const convHdr = optTotal + 2, convSub = convHdr + 1, convCols = convHdr + 2;
  const convStart = convCols + 1;
  const convTotal = convStart + convCount;
  return {
    /* left block (labels in A, values in B..E) */
    title: 1, inputPage: 2, units: 3,
    genHdr: 6, name: 7, ticker: 8, exchange: 9, fyEnd: 10, moodys: 11, sp: 12, beta: 13, taxRate: 14,
    mktHdr: 16, price: 17, pctHigh: 18, high52: 19, low52: 20, dps: 21,
    fdShares: 23, equityValue: 24,
    plusDebt: 26, plusPref: 27, plusNci: 28, lessCash: 29, ev: 30,
    multHdr: 32, multLbl: 33,
    evSales: 34, evEbitda: 35, evEbit: 36, pe: 37, pFcf: 38, fcfYield: 39,
    roiHdr: 41, roic: 42, roe: 43, roa: 44, divYield: 45,
    creditHdr: 47, debtCap: 48, debtEbitda: 49, netDebtEbitda: 50,
    ebitdaInt: 51, ebitdaCapexInt: 52, ebitInt: 53,
    growthHdr: 55, growthCols: 56, histHdr: 57, hist1: 58, hist2: 59,
    /* income statement (labels in G, values in I..N) */
    isHdr: 6, isFyLabel: 8, isDates: 9,
    sales: 10, cogs: 11, grossProfit: 12, sga: 13, otherExp: 14, ebit: 15, interest: 16,
    pretax: 17, taxes: 18, nci: 19, prefDiv: 20, netIncome: 21, effTax: 22,
    wtdShares: 24, dilEps: 25,
    adjHdr: 27, repGross: 28, nrCogs: 29, adjGross: 30, adjGrossM: 31,
    repEbit: 33, nrCogsB: 34, nrOther: 35, adjEbit: 36, adjEbitM: 37,
    ebitdaB: 39, adjEbitda: 40, adjEbitdaM: 41,
    repNi: 43, nrCogsC: 44, nrOtherB: 45, nrNonOp: 46, taxAdj: 47, adjNi: 48, adjNiM: 49,
    adjEps: 51,
    cfHdr: 53, cfo: 54, capex: 55, capexPct: 56, fcf: 57, fcfMargin: 58, fcfPerShare: 59,
    da: 61, daPct: 62,
    /* balance sheet & share count (labels in P, values in Q..T) */
    bsHdr: 6, bsDates: 7,
    bsCash: 8, bsAr: 9, bsInv: 10, bsPrepaid: 11, bsTca: 12,
    bsPpe: 14, bsGoodwill: 15, bsOtherAssets: 16, bsTotalAssets: 17,
    bsAp: 19, bsAccrued: 20, bsOtherCl: 21, bsTcl: 22,
    bsDebt: 24, bsOtherLt: 25, bsTotalLiab: 26,
    bsNci: 28, bsPref: 29, bsEquity: 30, bsTotalLe: 31, bsCheck: 33,
    shHdr: 36, basicShares: 37, plusOptions: 38, lessRepurch: 39,
    netNewOptions: 40, plusConverts: 41, fullyDiluted: 42,
    optHdr, optSub, optCols, optStart, optCount, optTotal,
    convHdr, convSub, convCols, convStart, convCount, convTotal,
  };
}

/** Absolute cross-sheet references the analysis pages link to. */
export function companyRefs(name, L) {
  const q = `'${name.replace(/'/g, "''")}'`;
  const at = (addr) => `${q}!${addr}`;
  return {
    sheet: name,
    name: at(`$E$${L.name}`), ticker: at(`$E$${L.ticker}`), exchange: at(`$E$${L.exchange}`),
    description: at('$P$2'),
    fyEnd: at(`$E$${L.fyEnd}`), moodys: at(`$E$${L.moodys}`), sp: at(`$E$${L.sp}`), beta: at(`$E$${L.beta}`),
    price: at(`$E$${L.price}`), pctOf52wHigh: at(`$E$${L.pctHigh}`),
    fdShares: at(`$E$${L.fdShares}`),
    equityValue: at(`$E$${L.equityValue}`), enterpriseValue: at(`$E$${L.ev}`),
    ltmSales: at(`$N$${L.sales}`), ltmGrossProfit: at(`$N$${L.adjGross}`),
    ltmEbitda: at(`$N$${L.adjEbitda}`), ltmEbit: at(`$N$${L.adjEbit}`), ltmNetIncome: at(`$N$${L.adjNi}`),
    grossMargin: at(`$N$${L.adjGrossM}`), ebitdaMargin: at(`$N$${L.adjEbitdaM}`),
    ebitMargin: at(`$N$${L.adjEbitM}`), netMargin: at(`$N$${L.adjNiM}`),
    gSalesHist1: at(`$B$${L.hist1}`), gSalesHist2: at(`$B$${L.hist2}`),
    gEbitdaHist1: at(`$C$${L.hist1}`), gEpsHist1: at(`$E$${L.hist1}`),
    roic: at(`$E$${L.roic}`), roe: at(`$E$${L.roe}`), roa: at(`$E$${L.roa}`),
    dividendYield: at(`$E$${L.divYield}`),
    debtToTotalCap: at(`$E$${L.debtCap}`), debtToEbitda: at(`$E$${L.debtEbitda}`),
    netDebtToEbitda: at(`$E$${L.netDebtEbitda}`),
    ebitdaToInterest: at(`$E$${L.ebitdaInt}`),
    ebitdaLessCapexToInterest: at(`$E$${L.ebitdaCapexInt}`),
    ebitToInterest: at(`$E$${L.ebitInt}`),
    evSales0: at(`$B$${L.evSales}`), evEbitda0: at(`$B$${L.evEbitda}`), evEbit0: at(`$B$${L.evEbit}`),
    pe0: at(`$B$${L.pe}`), pFcf0: at(`$B$${L.pFcf}`),
  };
}

/* ------------------------------------------------------ company input page */

const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const toNum = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : NaN;
};
const coreV = (v) => nv(toNum(v));
const adjV = (v) => { const x = toNum(v); return fin(x) ? x : 0; };
const dateV = (s) => {
  if (!s) return 'NA';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : 'NA';
};
const IS_ADJ = new Set(['nci', 'prefDiv']);
const BS_ADJ = new Set(['nci', 'preferred']);

/**
 * Write one company's full input page. Returns its refs.
 * opts.links: { key → formula } replaces a blue input with a green link —
 * the target page links its LTM inputs to the Inputs sheet. Keys: the scalar
 * field names (name, ticker, price, beta, …), `is.<line>.<slot>`,
 * `rep.<line>.<slot>` (a reported grossProfit / ebitda / ebit / netIncome),
 * `cf.<line>.<slot>`, `bs.<line>.<col>` and `basicShares`.
 * opts.priceFormula: the page is priced by a formula (a deal's offer price).
 */
export function writeCompanySheet(ws, co, L, F, opts) {
  const { unitNote, subtitle = 'Input Page', links = {}, priceFormula = null } = opts;
  const IN = { color: C_INPUT };                       // blue = type over it
  const LK = { color: C_LINK };
  const w = (col, n) => (ws.getColumn(col).width = n);
  w('A', 34); w('B', 12); w('C', 12); w('D', 11.5); w('E', 14); w('F', 2.2);
  w('G', 32); w('H', 2.2); w('I', 12); w('J', 12); w('K', 12); w('L', 12); w('M', 12); w('N', 13);
  w('O', 2.2); w('P', 34); w('Q', 12.5); w('R', 12); w('S', 13); w('T', 13);

  styleSheet(ws, { freezeRow: 5, tab: C_TAB_INPUT, printTitles: `1:${L.units}` });
  ws.getRow(L.title).height = 22;
  ws.getRow(L.inputPage).height = 15;

  const hdr = (addr, text, span) => {
    const m = addr.match(/^([A-Z]+)(\d+)$/);
    const c0 = colN(m[1]);
    const row = Number(m[2]);
    for (let i = 0; i < span; i++) {
      put(ws, `${colL(c0 + i)}${row}`, i === 0 ? text : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true });
    }
    if (span > 1) ws.mergeCells(`${colL(c0)}${row}:${colL(c0 + span - 1)}${row}`);
    ws.getRow(row).height = 18;
  };
  const lbl = (addr, text, o = {}) => put(ws, addr, text, o);
  const fml = (addr, f, fmt, o = {}) => put(ws, addr, { formula: f }, { fmt, align: 'right', ...o });
  /** An input cell: the link when one is given, else the blue value. */
  const inCell = (addr, key, value, fmt, o = {}) => {
    if (links[key]) return put(ws, addr, { formula: links[key] }, { fmt, ...LK, align: 'right', ...o });
    return put(ws, addr, value, { fmt, ...IN, align: 'right', ...o });
  };

  /* ---------------- header ---------------- */
  put(ws, `A${L.title}`, { formula: `E${L.name}&" ("&E${L.exchange}&":"&E${L.ticker}&")"` }, { bold: true, size: 14 });
  put(ws, `A${L.inputPage}`, subtitle, { italic: true, color: C_MUTED });
  put(ws, `A${L.units}`, unitNote, { italic: true, color: C_MUTED });
  put(ws, 'P1', 'Business Description', { bold: true });
  if (links.description) put(ws, 'P2', { formula: links.description }, { ...LK, wrap: true, wrapTop: true });
  else put(ws, 'P2', co.description || '[to come]', { ...IN, wrap: true, wrapTop: true });
  ws.mergeCells('P2:T4');
  ws.getCell('P2').border = {
    top: { style: 'thin', color: { argb: C_RULE } },
    bottom: { style: 'thin', color: { argb: C_RULE } },
  };

  /* ---------------- general information ---------------- */
  hdr(`A${L.genHdr}`, 'General Information', 5);
  lbl(`A${L.name}`, 'Company Name'); inCell(`E${L.name}`, 'name', co.name || '', null);
  lbl(`A${L.ticker}`, 'Ticker'); inCell(`E${L.ticker}`, 'ticker', co.ticker || '', null);
  lbl(`A${L.exchange}`, 'Stock Exchange'); inCell(`E${L.exchange}`, 'exchange', co.exchange || '', null);
  lbl(`A${L.fyEnd}`, 'Fiscal Year Ending'); inCell(`E${L.fyEnd}`, 'fyEnd', dateV(co.fyEnd), F.date);
  lbl(`A${L.moodys}`, "Moody's Corporate Rating"); inCell(`E${L.moodys}`, 'moodys', co.moodys || '', null);
  lbl(`A${L.sp}`, 'S&P Corporate Rating'); inCell(`E${L.sp}`, 'sp', co.sp || '', null);
  lbl(`A${L.beta}`, 'Predicted Beta'); inCell(`E${L.beta}`, 'beta', coreV(co.beta), F.num3);
  lbl(`A${L.taxRate}`, 'Marginal Tax Rate'); inCell(`E${L.taxRate}`, 'taxRate', fin(toNum(co.taxRate)) ? toNum(co.taxRate) / 100 : 'NA', F.pct);

  /* ---------------- market data & EV bridge ---------------- */
  hdr(`A${L.mktHdr}`, 'Selected Market Data', 5);
  lbl(`A${L.price}`, priceFormula ? 'Offer Price (from the deal terms)' : 'Current Price');
  if (priceFormula) put(ws, `E${L.price}`, { formula: priceFormula }, { fmt: F.price, align: 'right', bold: true });
  else inCell(`E${L.price}`, 'price', coreV(co.price), F.price);
  const PX = `$E$${L.price}`;
  lbl(`A${L.pctHigh}`, '   % of 52-week High', { italic: true });
  fml(`E${L.pctHigh}`, na(`E${L.price}/E${L.high52}`), F.pct, { italic: true });
  lbl(`A${L.high52}`, '52-week High Price'); inCell(`E${L.high52}`, 'high52', coreV(co.high52), F.price);
  lbl(`A${L.low52}`, '52-week Low Price'); inCell(`E${L.low52}`, 'low52', coreV(co.low52), F.price);
  lbl(`A${L.dps}`, 'Dividend Per Share (MRQ)'); inCell(`E${L.dps}`, 'dps', coreV(co.dpsMRQ), F.price);

  lbl(`A${L.fdShares}`, 'Fully Diluted Shares Outstanding');
  fml(`E${L.fdShares}`, `T${L.fullyDiluted}`, F.shares, LK);
  lbl(`A${L.equityValue}`, '   Equity Value', { bold: true });
  fml(`E${L.equityValue}`, na(`E${L.fdShares}*E${L.price}`), F.money, { bold: true, top: true });
  lbl(`A${L.plusDebt}`, 'Plus: Total Debt');
  fml(`E${L.plusDebt}`, `T${L.bsDebt}`, F.money, LK);
  lbl(`A${L.plusPref}`, 'Plus: Preferred Stock');
  fml(`E${L.plusPref}`, `T${L.bsPref}`, F.money, LK);
  lbl(`A${L.plusNci}`, 'Plus: Noncontrolling Interest');
  fml(`E${L.plusNci}`, `T${L.bsNci}`, F.money, LK);
  lbl(`A${L.lessCash}`, 'Less: Cash and Cash Equivalents');
  fml(`E${L.lessCash}`, na(`-T${L.bsCash}`), F.money, LK);
  lbl(`A${L.ev}`, '   Enterprise Value', { bold: true });
  fml(`E${L.ev}`, na(`E${L.equityValue}+E${L.plusDebt}+E${L.plusPref}+E${L.plusNci}+E${L.lessCash}`), F.money, { bold: true, top: true, bottom: 'double' });

  /* ---------------- LTM trading multiples ---------------- */
  hdr(`A${L.multHdr}`, 'LTM Trading Multiples', 5);
  put(ws, `A${L.multLbl}`, { formula: na(`"LTM to "&TEXT(N${L.isDates},"d mmm yyyy")`) }, { italic: true, color: C_MUTED });
  put(ws, `B${L.multLbl}`, 'Multiple', { bold: true, align: 'center', fill: C_SECTION_FILL });
  put(ws, `C${L.multLbl}`, 'Metric', { bold: true, align: 'center', fill: C_SECTION_FILL });
  edge(ws, L.multLbl, colRun(1, 5), 'bottom', 'thin', C_RULE);
  /* Each multiple sits beside its own LTM denominator, so metric and multiple
     can never disagree. A non-positive denominator makes it not-meaningful
     ("NM"); a missing one reads "NA". Both are text, so AVERAGE / MEDIAN /
     QUARTILE on the analysis pages skip them. */
  const multiple = (row, label, baseCell, metricRef, metricFmt) => {
    lbl(`A${row}`, label, { bold: true });
    fml(`C${row}`, metricRef, metricFmt, { italic: true, color: C_LINK });
    fml(`B${row}`, `IF(ISNUMBER(C${row}),IF(C${row}<=0,"NM",${na(`${baseCell}/C${row}`)}),"NA")`, F.x2, { bold: true });
  };
  const EV = `$E$${L.ev}`;
  multiple(L.evSales, 'EV / Sales', EV, `N${L.sales}`, F.money);
  multiple(L.evEbitda, 'EV / EBITDA', EV, `N${L.adjEbitda}`, F.money);
  multiple(L.evEbit, 'EV / EBIT', EV, `N${L.adjEbit}`, F.money);
  multiple(L.pe, 'P / E', PX, `N${L.adjEps}`, F.price);
  multiple(L.pFcf, 'P / FCF', PX, `N${L.fcfPerShare}`, F.price);
  lbl(`A${L.fcfYield}`, 'FCF Yield', { bold: true });
  fml(`C${L.fcfYield}`, `C${L.pFcf}`, F.price, { italic: true, color: C_MUTED });
  fml(`B${L.fcfYield}`, `IF(ISNUMBER(C${L.fcfYield}),IF(C${L.fcfYield}<=0,"NM",${na(`C${L.fcfYield}/${PX}`)}),"NA")`, F.pct, { bold: true });

  /* ---------------- returns ---------------- */
  hdr(`A${L.roiHdr}`, 'LTM Return on Investment Ratios', 5);
  const avg2 = (a, b) => `((${a}+${b})/2)`;
  const ic = (c) => `(${c}${L.bsDebt}-${c}${L.bsCash}+${c}${L.bsEquity})`;
  lbl(`A${L.roic}`, 'Return on Invested Capital');
  fml(`E${L.roic}`, na(`N${L.adjEbit}/${avg2(ic('S'), ic('T'))}`), F.pct);
  lbl(`A${L.roe}`, 'Return on Equity');
  fml(`E${L.roe}`, na(`N${L.adjNi}/${avg2(`S${L.bsEquity}`, `T${L.bsEquity}`)}`), F.pct);
  lbl(`A${L.roa}`, 'Return on Assets');
  fml(`E${L.roa}`, na(`N${L.adjNi}/${avg2(`S${L.bsTotalAssets}`, `T${L.bsTotalAssets}`)}`), F.pct);
  lbl(`A${L.divYield}`, 'Implied Annual Dividend Yield');
  fml(`E${L.divYield}`, na(`(E${L.dps}*4)/E${L.price}`), F.pct);

  /* ---------------- credit statistics ---------------- */
  hdr(`A${L.creditHdr}`, 'LTM Credit Statistics', 5);
  const cs = (row, label, f, fmt) => { lbl(`A${row}`, label); fml(`E${row}`, na(f), fmt); };
  cs(L.debtCap, 'Debt / Total Capitalization', `T${L.bsDebt}/(T${L.bsDebt}+T${L.bsEquity})`, F.pct);
  cs(L.debtEbitda, 'Total Debt / EBITDA', `T${L.bsDebt}/N${L.adjEbitda}`, F.x2);
  cs(L.netDebtEbitda, 'Net Debt / EBITDA', `(T${L.bsDebt}-T${L.bsCash})/N${L.adjEbitda}`, F.x2);
  cs(L.ebitdaInt, 'EBITDA / Interest Expense', `N${L.adjEbitda}/N${L.interest}`, F.x2);
  cs(L.ebitdaCapexInt, '(EBITDA − capex) / Interest Expense', `(N${L.adjEbitda}-N${L.capex})/N${L.interest}`, F.x2);
  cs(L.ebitInt, 'EBIT / Interest Expense', `N${L.adjEbit}/N${L.interest}`, F.x2);

  /* ---------------- historical growth rates ---------------- */
  hdr(`A${L.growthHdr}`, 'Historical Growth Rates (fiscal years)', 5);
  ['Sales', 'EBITDA', 'FCF / sh.', 'EPS'].forEach((t, i) => put(ws, `${colL(2 + i)}${L.growthCols}`, t, { bold: true, align: 'center', fill: C_SECTION_FILL }));
  edge(ws, L.growthCols, colRun(1, 5), 'bottom', 'thin', C_RULE);
  lbl(`A${L.histHdr}`, 'Historical', { bold: true });
  lbl(`A${L.hist1}`, '   1-year');
  lbl(`A${L.hist2}`, '   2-year CAGR');
  [L.sales, L.adjEbitda, L.fcfPerShare, L.adjEps].forEach((srcRow, i) => {
    const c = colL(2 + i);
    fml(`${c}${L.hist1}`, na(`K${srcRow}/J${srcRow}-1`), F.pct);
    fml(`${c}${L.hist2}`, na(`(K${srcRow}/I${srcRow})^(1/2)-1`), F.pct);
  });

  /* ================= reported income statement ================= */
  hdr(`G${L.isHdr}`, 'Reported Income Statement', 8);
  put(ws, `I${L.isFyLabel}`, { formula: na(`"Fiscal Year Ending "&TEXT($E$${L.fyEnd},"d mmmm")`) }, { italic: true, color: C_MUTED });
  put(ws, `L${L.isFyLabel - 1}`, 'Prior', { bold: true, align: 'center' });
  put(ws, `L${L.isFyLabel}`, 'Stub', { bold: true, align: 'center' });
  put(ws, `M${L.isFyLabel - 1}`, 'Current', { bold: true, align: 'center' });
  put(ws, `M${L.isFyLabel}`, 'Stub', { bold: true, align: 'center' });
  put(ws, `N${L.isFyLabel}`, 'LTM', { bold: true, align: 'center' });
  // period ends: three fiscal years off the FY-end input, two stubs off the stub input
  inCell(`M${L.isDates}`, 'stubEnd', dateV(co.stubEnd), F.date, { align: 'center' });
  put(ws, `K${L.isDates}`, { formula: `E${L.fyEnd}` }, { fmt: F.date, align: 'center', color: C_LINK });
  put(ws, `J${L.isDates}`, { formula: na(`K${L.isDates}-365`) }, { fmt: F.date, align: 'center' });
  put(ws, `I${L.isDates}`, { formula: na(`J${L.isDates}-365`) }, { fmt: F.date, align: 'center' });
  put(ws, `L${L.isDates}`, { formula: na(`M${L.isDates}-366`) }, { fmt: F.date, align: 'center' });
  put(ws, `N${L.isDates}`, { formula: `M${L.isDates}` }, { fmt: F.date, align: 'center' });
  edge(ws, L.isDates, colRun(7, 14), 'bottom', 'thin', C_RULE);

  /**
   * An input line across the five entry periods with the LTM bridge in N.
   * Fiscal years read `adjustment ? 0 : "NA"` when blank; stubs always 0.
   */
  const isInput = (row, label, group, key, values, adjustment, fmt = F.money, o = {}) => {
    lbl(`G${row}`, label, o);
    for (let i = 0; i < 5; i++) {
      const v = i >= 3 || adjustment ? adjV(values?.[i]) : coreV(values?.[i]);
      inCell(`${IS_COL[i]}${row}`, `${group}.${key}.${i}`, v, fmt);
    }
    fml(`N${row}`, na(`K${row}+M${row}-L${row}`), fmt, o);
  };
  /** A derived line: the same formula in every period column. */
  const isCalc = (row, label, f, fmt = F.money, o = {}) => {
    lbl(`G${row}`, label, o);
    IS_COL.forEach((c) => fml(`${c}${row}`, na(f(c)), fmt, o));
  };
  /**
   * A derived line a REPORTED figure can override slot by slot (the target's
   * EBITDA / EBIT / net income). The LTM of a reported line is FY0 + current
   * stub − prior stub of the reported figures (a blank reported stub is 0).
   */
  const repKey = (line, i) => `rep.${line}.${i}`;
  const repVal = (line, i) => toNum(co.reported?.[line]?.[i]);
  const isRep = (line, i) => !!links[repKey(line, i)] || fin(repVal(line, i));
  const isCalcRep = (row, label, line, f, fmt = F.money, o = {}) => {
    lbl(`G${row}`, label, o);
    for (let i = 0; i < 5; i++) {
      const c = IS_COL[i];
      if (isRep(line, i)) inCell(`${c}${row}`, repKey(line, i), repVal(line, i), fmt, o);
      else fml(`${c}${row}`, na(f(c)), fmt, o);
    }
    if (isRep(line, 2)) {
      const m = isRep(line, 4) ? `M${row}` : '0', l = isRep(line, 3) ? `L${row}` : '0';
      fml(`N${row}`, na(`K${row}+${m}-${l}`), fmt, o);
    } else fml(`N${row}`, na(f('N')), fmt, o);
  };

  const grossKnown = co.grossKnown !== false;
  const MUTED = { italic: true, color: C_MUTED };
  const TOT = { bold: true, top: true };

  const is = co.is || {};
  isInput(L.sales, 'Sales', 'is', 'sales', is.sales, false);
  isInput(L.cogs, 'COGS (incl. D&A)', 'is', 'cogs', is.cogs, false);
  isCalcRep(L.grossProfit, '   Gross Profit', 'grossProfit', (c) => (grossKnown ? `${c}${L.sales}-${c}${L.cogs}` : '"NA"'), F.money, TOT);
  isInput(L.sga, 'SG&A', 'is', 'sga', is.sga, false);
  isInput(L.otherExp, 'Other Expense / (Income)', 'is', 'otherExp', is.otherExp, false);
  // EBIT is built off the full cost stack, so it stays exact without a gross-profit split
  isCalcRep(L.ebit, '   EBIT', 'ebit', (c) => `${c}${L.sales}-${c}${L.cogs}-${c}${L.sga}-${c}${L.otherExp}`, F.money, TOT);
  isInput(L.interest, 'Interest Expense, net', 'is', 'interest', is.interest, false);
  isCalc(L.pretax, '   Pre-tax Income', (c) => `${c}${L.ebit}-${c}${L.interest}`, F.money, TOT);
  isInput(L.taxes, 'Income Taxes', 'is', 'taxes', is.taxes, false);
  isInput(L.nci, 'Noncontrolling Interest', 'is', 'nci', is.nci, IS_ADJ.has('nci'));
  isInput(L.prefDiv, 'Preferred Dividends', 'is', 'prefDiv', is.prefDiv, IS_ADJ.has('prefDiv'));
  isCalcRep(L.netIncome, '   Net Income', 'netIncome', (c) => `${c}${L.pretax}-${c}${L.taxes}-${c}${L.nci}-${c}${L.prefDiv}`, F.money, { ...TOT, bottom: 'double' });
  isCalc(L.effTax, '   Effective Tax Rate', (c) => `${c}${L.taxes}/${c}${L.pretax}`, F.pct, MUTED);
  isInput(L.wtdShares, 'Weighted Avg. Diluted Shares', 'is', 'dilutedShares', is.dilutedShares, false, F.shares);
  // reported EPS bridges as a flow-per-share; a stub with no shares and no earnings is 0 (no stub)
  lbl(`G${L.dilEps}`, '   Diluted EPS', { bold: true });
  IS_COL.slice(0, 5).forEach((c, i) => {
    const eps = na(`${c}${L.netIncome}/${c}${L.wtdShares}`);
    fml(`${c}${L.dilEps}`, i >= 3 ? `IF(AND(${c}${L.wtdShares}=0,${c}${L.netIncome}=0),0,${eps})` : eps, F.price, { bold: true });
  });
  fml(`N${L.dilEps}`, na(`K${L.dilEps}+M${L.dilEps}-L${L.dilEps}`), F.price, { bold: true });

  /* ================= adjusted income statement ================= */
  hdr(`G${L.adjHdr}`, 'Adjusted Income Statement', 8);
  const adj = co.adj || {};
  isCalc(L.repGross, 'Reported Gross Profit', (c) => `${c}${L.grossProfit}`);
  isInput(L.nrCogs, 'Non-recurring Items in COGS', 'adj', 'nrCogs', adj.nrCogs, true);
  isCalc(L.adjGross, '   Adj. Gross Profit', (c) => `${c}${L.repGross}+${c}${L.nrCogs}`, F.money, TOT);
  isCalc(L.adjGrossM, '   % margin', (c) => `${c}${L.adjGross}/${c}${L.sales}`, F.pct, MUTED);

  isCalc(L.repEbit, 'Reported EBIT', (c) => `${c}${L.ebit}`);
  isCalc(L.nrCogsB, 'Non-recurring Items in COGS', (c) => `${c}${L.nrCogs}`);
  isInput(L.nrOther, 'Other Non-recurring Items', 'adj', 'nrOther', adj.nrOther, true);
  isCalc(L.adjEbit, '   Adjusted EBIT', (c) => `${c}${L.repEbit}+${c}${L.nrCogsB}+${c}${L.nrOther}`, F.money, TOT);
  isCalc(L.adjEbitM, '   % margin', (c) => `${c}${L.adjEbit}/${c}${L.sales}`, F.pct, MUTED);

  isCalcRep(L.ebitdaB, 'EBITDA (EBIT + D&A, or as reported)', 'ebitda', (c) => `${c}${L.ebit}+${c}${L.da}`);
  isCalc(L.adjEbitda, '   Adjusted EBITDA', (c) => `${c}${L.ebitdaB}+${c}${L.nrCogs}+${c}${L.nrOther}`, F.money, TOT);
  isCalc(L.adjEbitdaM, '   % margin', (c) => `${c}${L.adjEbitda}/${c}${L.sales}`, F.pct, MUTED);

  isCalc(L.repNi, 'Reported Net Income', (c) => `${c}${L.netIncome}`);
  isCalc(L.nrCogsC, 'Non-recurring Items in COGS', (c) => `${c}${L.nrCogs}`);
  isCalc(L.nrOtherB, 'Other Non-recurring Items', (c) => `${c}${L.nrOther}`);
  isInput(L.nrNonOp, 'Non-operating Non-rec. Items', 'adj', 'nrNonOp', adj.nrNonOp, true);
  // no adjustment → no tax effect (a blank tax rate never turns "none" into NA)
  lbl(`G${L.taxAdj}`, 'Tax Adjustment');
  IS_COL.forEach((c) => {
    const sum = `(${c}${L.nrCogsC}+${c}${L.nrOtherB}+${c}${L.nrNonOp})`;
    fml(`${c}${L.taxAdj}`, `IF(${sum}=0,0,${na(`-${sum}*$E$${L.taxRate}`)})`, F.money);
  });
  isCalc(L.adjNi, '   Adjusted Net Income', (c) => `${c}${L.repNi}+${c}${L.nrCogsC}+${c}${L.nrOtherB}+${c}${L.nrNonOp}+${c}${L.taxAdj}`, F.money, TOT);
  isCalc(L.adjNiM, '   % margin', (c) => `${c}${L.adjNi}/${c}${L.sales}`, F.pct, MUTED);
  isCalc(L.adjEps, 'Adjusted Diluted EPS', (c) => `${c}${L.adjNi}/${c}${L.wtdShares}`, F.price, { bold: true });

  /* ================= cash flow ================= */
  hdr(`G${L.cfHdr}`, 'Cash Flow Statement Data', 8);
  const cf = co.cf || {};
  isInput(L.cfo, 'Cash From Operations', 'cf', 'cfo', cf.cfo, false);
  isInput(L.capex, 'Capital Expenditures', 'cf', 'capex', cf.capex, false);
  isCalc(L.capexPct, '   % sales', (c) => `${c}${L.capex}/${c}${L.sales}`, F.pct, MUTED);
  isCalc(L.fcf, '   Free Cash Flow', (c) => `${c}${L.cfo}-${c}${L.capex}`, F.money, TOT);
  isCalc(L.fcfMargin, '   % margin', (c) => `${c}${L.fcf}/${c}${L.sales}`, F.pct, MUTED);
  isCalc(L.fcfPerShare, '   FCF / Share', (c) => `${c}${L.fcf}/${c}${L.wtdShares}`, F.price, { bold: true });
  isInput(L.da, 'Depreciation & Amortization', 'cf', 'da', cf.da, false);
  isCalc(L.daPct, '   % sales', (c) => `${c}${L.da}/${c}${L.sales}`, F.pct, MUTED);

  /* ================= balance sheet ================= */
  hdr(`P${L.bsHdr}`, 'Balance Sheet Data', 5);
  put(ws, `S${L.bsDates}`, { formula: `J${L.isDates}` }, { fmt: F.date, align: 'center', color: C_LINK });
  put(ws, `T${L.bsDates}`, { formula: `M${L.isDates}` }, { fmt: F.date, align: 'center', color: C_LINK });
  edge(ws, L.bsDates, colRun(16, 20), 'bottom', 'thin', C_RULE);
  const bsInput = (row, label, key) => {
    lbl(`P${row}`, label);
    BS_COL.forEach((c, i) => {
      const raw = co.bs?.[key]?.[i];
      inCell(`${c}${row}`, `bs.${key}.${i}`, BS_ADJ.has(key) ? adjV(raw) : coreV(raw), F.money);
    });
  };
  const bsCalc = (row, label, f, o = {}) => {
    lbl(`P${row}`, label, o);
    BS_COL.forEach((c) => fml(`${c}${row}`, na(f(c)), F.money, o));
  };
  const plus = (c, rows) => rows.map((r) => `${c}${r}`).join('+');
  bsInput(L.bsCash, 'Cash and Cash Equivalents', 'cash');
  bsInput(L.bsAr, 'Accounts Receivable', 'ar');
  bsInput(L.bsInv, 'Inventories', 'inventory');
  bsInput(L.bsPrepaid, 'Prepaids and Other Current Assets', 'prepaid');
  bsCalc(L.bsTca, '   Total Current Assets', (c) => plus(c, [L.bsCash, L.bsAr, L.bsInv, L.bsPrepaid]), TOT);
  bsInput(L.bsPpe, 'Property, Plant and Equipment, net', 'ppe');
  bsInput(L.bsGoodwill, 'Goodwill and Intangible Assets', 'goodwill');
  bsInput(L.bsOtherAssets, 'Other Assets', 'otherAssets');
  bsCalc(L.bsTotalAssets, '   Total Assets', (c) => plus(c, [L.bsTca, L.bsPpe, L.bsGoodwill, L.bsOtherAssets]), { ...TOT, bottom: 'double' });
  bsInput(L.bsAp, 'Accounts Payable', 'ap');
  bsInput(L.bsAccrued, 'Accrued Liabilities', 'accrued');
  bsInput(L.bsOtherCl, 'Other Current Liabilities', 'otherCurLiab');
  bsCalc(L.bsTcl, '   Total Current Liabilities', (c) => plus(c, [L.bsAp, L.bsAccrued, L.bsOtherCl]), TOT);
  bsInput(L.bsDebt, 'Total Debt', 'debt');
  bsInput(L.bsOtherLt, 'Other Long-Term Liabilities', 'otherLTLiab');
  bsCalc(L.bsTotalLiab, '   Total Liabilities', (c) => plus(c, [L.bsTcl, L.bsDebt, L.bsOtherLt]), TOT);
  bsInput(L.bsNci, 'Noncontrolling Interest', 'nci');
  bsInput(L.bsPref, 'Preferred Stock', 'preferred');
  bsInput(L.bsEquity, "Shareholders' Equity", 'equity');
  bsCalc(L.bsTotalLe, '   Total Liabilities and Equity', (c) => plus(c, [L.bsTotalLiab, L.bsNci, L.bsPref, L.bsEquity]), { ...TOT, bottom: 'double' });
  bsCalc(L.bsCheck, 'Balance Check', (c) => `${c}${L.bsTotalAssets}-${c}${L.bsTotalLe}`, { bold: true });

  /* ================= fully diluted shares (treasury method) ================= */
  hdr(`P${L.shHdr}`, 'Calculation of Fully Diluted Shares Outstanding', 5);
  lbl(`P${L.basicShares}`, 'Basic Shares Outstanding');
  inCell(`T${L.basicShares}`, 'basicShares', coreV(co.basicShares), F.shares);
  lbl(`P${L.plusOptions}`, 'Plus: Shares from In-the-Money Options');
  fml(`T${L.plusOptions}`, `S${L.optTotal}`, F.shares);
  lbl(`P${L.lessRepurch}`, 'Less: Shares Repurchased');
  fml(`T${L.lessRepurch}`, `IF(T${L.optTotal}=0,0,IF(AND(ISNUMBER(${PX}),${PX}>0),-T${L.optTotal}/${PX},"NA"))`, F.shares);
  lbl(`P${L.netNewOptions}`, '   Net New Shares from Options', { bold: true });
  fml(`T${L.netNewOptions}`, na(`T${L.plusOptions}+T${L.lessRepurch}`), F.shares, TOT);
  lbl(`P${L.plusConverts}`, 'Plus: Shares from Convertible Securities');
  fml(`T${L.plusConverts}`, `T${L.convTotal}`, F.shares);
  lbl(`P${L.fullyDiluted}`, '   Fully Diluted Shares Outstanding', { bold: true });
  fml(`T${L.fullyDiluted}`, na(`T${L.basicShares}+T${L.netNewOptions}+T${L.plusConverts}`), F.shares, { ...TOT, bottom: 'double' });

  /* options / warrants — an option without a price cannot be tested for moneyness (NA) */
  hdr(`P${L.optHdr}`, 'Options / Warrants', 5);
  put(ws, `Q${L.optSub}`, 'Number of', { bold: true, align: 'center' });
  put(ws, `R${L.optSub}`, 'Exercise', { bold: true, align: 'center' });
  put(ws, `S${L.optSub}`, 'In-the-Money', { bold: true, align: 'center' });
  ['Tranche', 'Shares', 'Price', 'Shares', 'Proceeds'].forEach((t, i) => put(ws, `${colL(16 + i)}${L.optCols}`, t, { bold: true, align: i ? 'center' : 'left', fill: C_SECTION_FILL }));
  edge(ws, L.optCols, colRun(16, 20), 'bottom', 'thin', C_RULE);
  const optRows = [];
  for (let i = 0; i < L.optCount; i++) {
    const r = L.optStart + i, o = (co.options || [])[i] || {};
    optRows.push(r);
    put(ws, `P${r}`, `Tranche ${i + 1}`);
    put(ws, `Q${r}`, adjV(o.shares), { fmt: F.shares, ...IN, align: 'right' });
    put(ws, `R${r}`, adjV(o.strike), { fmt: F.price, ...IN, align: 'right' });
    fml(`S${r}`, `IF(Q${r}=0,0,IF(ISNUMBER(${PX}),IF(R${r}<${PX},Q${r},0),"NA"))`, F.shares);
    fml(`T${r}`, na(`S${r}*R${r}`), F.money);
  }
  put(ws, `P${L.optTotal}`, '   Total', { bold: true });
  ['Q', 'S', 'T'].forEach((c) => fml(`${c}${L.optTotal}`, na(plus(c, optRows)), c === 'T' ? F.money : F.shares, TOT));

  /* convertible securities */
  hdr(`P${L.convHdr}`, 'Convertible Securities', 5);
  put(ws, `R${L.convSub}`, 'Conversion', { bold: true, align: 'center' });
  put(ws, `S${L.convSub}`, 'Conversion', { bold: true, align: 'center' });
  put(ws, `T${L.convSub}`, 'New', { bold: true, align: 'center' });
  ['Issue', 'Amount', 'Price', 'Ratio', 'Shares'].forEach((t, i) => put(ws, `${colL(16 + i)}${L.convCols}`, t, { bold: true, align: i ? 'center' : 'left', fill: C_SECTION_FILL }));
  edge(ws, L.convCols, colRun(16, 20), 'bottom', 'thin', C_RULE);
  const convRows = [];
  for (let i = 0; i < L.convCount; i++) {
    const r = L.convStart + i, c = (co.converts || [])[i] || {};
    convRows.push(r);
    put(ws, `P${r}`, `Issue ${i + 1}`);
    put(ws, `Q${r}`, adjV(c.amount), { fmt: F.money, ...IN, align: 'right' });
    put(ws, `R${r}`, adjV(c.price), { fmt: F.price, ...IN, align: 'right' });
    fml(`S${r}`, na(`1000/R${r}`), F.num);
    fml(`T${r}`, `IF(Q${r}=0,0,IF(ISNUMBER(${PX}),IF(AND(R${r}<${PX},R${r}<>0),Q${r}/R${r},0),"NA"))`, F.shares);
  }
  put(ws, `P${L.convTotal}`, '   Total', { bold: true });
  fml(`Q${L.convTotal}`, plus('Q', convRows), F.money, TOT);
  fml(`T${L.convTotal}`, na(plus('T', convRows)), F.shares, TOT);

  return companyRefs(ws.name, L);
}

/* ==================================================================== */
/*                          analysis pages                              */
/* ==================================================================== */

/**
 * Excel number format for a column spec's `kind`, on an ANALYSIS page. Money
 * columns are plain numbers (the header already states the currency).
 */
const kindFmt = (kind, F) => ({
  money: F.plain, price: F.price, pct: F.pct, x: F.x2,
  num: F.num3, date: F.date, text: null,
}[kind] ?? null);

/** B = Company, C = Ticker, then each group behind a narrow spacer column. */
function planColumns(groups, lead = 2) {
  const plan = [];
  let n = 2;
  for (let i = 0; i < lead; i++) plan.push({ kind: 'lead', col: colL(n++), idx: i });
  for (const g of groups) {
    plan.push({ kind: 'spacer', col: colL(n++) });
    const start = n;
    for (const c of g.cols) plan.push({ kind: 'col', col: colL(n++), spec: c, group: g });
    plan.push({ kind: 'groupSpan', group: g, from: colL(start), to: colL(n - 1) });
  }
  return { plan, lastCol: n - 1 };
}

/**
 * A tiered analysis page (Benchmarking 1 / 2, or the output page). Every
 * value cell links into a company sheet; every statistic is an AVERAGE /
 * MEDIAN / MAX / MIN over the peer rows, which skip NA / NM text.
 */
export function writeAnalysisSheet(ws, o) {
  const { title, groups, F, unitNote, target, tiers, source, note, statNote } = o;
  const { plan, lastCol } = planColumns(groups);
  const cols = plan.filter((p) => p.kind === 'col');
  const allCols = colRun(2, lastCol);

  ws.getColumn('A').width = 1.4;
  ws.getColumn('B').width = 28;
  ws.getColumn('C').width = 9.5;
  for (const p of plan) {
    if (p.kind === 'spacer') ws.getColumn(p.col).width = 1.4;
    else if (p.kind === 'col') ws.getColumn(p.col).width = { text: 11, money: 14 }[p.spec.kind] ?? 12.5;
  }

  const R_GROUP = 6, R_LABEL = 8, R_UNIT = 9, R_TARGET = 11;
  styleSheet(ws, { freezeRow: R_UNIT, freezeCol: 3, tab: C_TAB_ANALYSIS, printTitles: `1:${R_UNIT}` });

  put(ws, 'B1', { formula: target.name }, { bold: true, size: 16, color: C_LINK });
  put(ws, 'B2', title, { bold: true, size: 12 });
  put(ws, 'B3', unitNote, { italic: true, color: C_MUTED });
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 17;
  ws.getRow(4).height = 6;
  edge(ws, 4, allCols, 'bottom', 'medium', C_HDR_FILL);

  for (const g of plan.filter((p) => p.kind === 'groupSpan')) {
    if (!g.group.title) continue;
    const from = colN(g.from), to = colN(g.to);
    for (let c = from; c <= to; c++) {
      put(ws, `${colL(c)}${R_GROUP}`, c === from ? g.group.title : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true, align: 'center' });
    }
    if (to > from) ws.mergeCells(`${g.from}${R_GROUP}:${g.to}${R_GROUP}`);
  }
  ws.getRow(R_GROUP).height = 19;
  put(ws, `B${R_LABEL}`, 'Company', { bold: true, fill: C_SECTION_FILL });
  put(ws, `C${R_LABEL}`, 'Ticker', { bold: true, fill: C_SECTION_FILL, align: 'center' });
  for (const c of cols) put(ws, `${c.col}${R_LABEL}`, c.spec.label, { bold: true, fill: C_SECTION_FILL, align: 'center', wrap: true });
  const headerLines = Math.max(1, ...cols.map((c) => {
    const w = ws.getColumn(c.col).width || 12.5;
    return Math.ceil(String(c.spec.label).length / Math.max(6, w - 1.5));
  }));
  ws.getRow(R_LABEL).height = 15 + 12 * Math.min(3, headerLines);
  ws.getRow(R_UNIT).height = 4;
  edge(ws, R_UNIT, allCols, 'bottom', 'medium', C_HDR_FILL);

  const companyRow = (r, refs, o2 = {}) => {
    put(ws, `B${r}`, { formula: refs.name }, { color: C_LINK, ...o2 });
    put(ws, `C${r}`, { formula: refs.ticker }, { color: C_LINK, align: 'center', ...o2 });
    for (const c of cols) {
      const ref = refs[c.spec.cell];
      if (!ref) continue;
      put(ws, `${c.col}${r}`, { formula: ref }, { fmt: kindFmt(c.spec.kind, F), color: C_LINK, align: 'right', ...o2 });
    }
  };

  companyRow(R_TARGET, target, { bold: true, fill: C_GRID_FILL });
  fillRow(ws, R_TARGET, allCols, C_GRID_FILL);
  ws.getRow(R_TARGET).height = 17;
  edge(ws, R_TARGET, allCols, 'top', 'thin', C_HDR_FILL);
  edge(ws, R_TARGET, allCols, 'bottom', 'thin', C_HDR_FILL);

  let r = R_TARGET + 2;
  const tierRanges = [];
  for (const t of tiers) {
    if (!t.refs.length) continue;
    put(ws, `B${r}`, t.name, { bold: true, fill: C_SECTION_FILL });
    fillRow(ws, r, allCols, C_SECTION_FILL);
    ws.getRow(r).height = 17;
    edge(ws, r, allCols, 'top', 'thin', C_RULE);
    edge(ws, r, allCols, 'bottom', 'thin', C_RULE);
    r++;
    const first = r;
    for (const refs of t.refs) companyRow(r++, refs);
    const last = r - 1;
    tierRanges.push({ first, last });
    r++;
    for (const s of ['Mean', 'Median']) {
      put(ws, `B${r}`, s, { bold: true });
      for (const c of cols) {
        if (!c.spec.stat) continue;
        const fn = s === 'Mean' ? 'AVERAGE' : 'MEDIAN';
        put(ws, `${c.col}${r}`, { formula: na(`${fn}(${c.col}${first}:${c.col}${last})`) }, { fmt: kindFmt(c.spec.kind, F), bold: true, align: 'right' });
      }
      if (s === 'Mean') edge(ws, r, allCols, 'top', 'thin', C_RULE);
      r++;
    }
    r++;
  }

  if (tierRanges.length) {
    put(ws, `B${r}`, 'Overall', { bold: true, fill: C_HDR_FILL, color: C_HDR_TEXT });
    fillRow(ws, r, allCols, C_HDR_FILL);
    ws.getRow(r).height = 18;
    r += 2;
    for (const [label, fn] of [['Mean', 'AVERAGE'], ['Median', 'MEDIAN'], [null, null], ['High', 'MAX'], ['Low', 'MIN']]) {
      if (!label) { r++; continue; }
      put(ws, `B${r}`, label, { bold: true });
      for (const c of cols) {
        if (!c.spec.stat) continue;
        const ranges = tierRanges.map((t) => `${c.col}${t.first}:${c.col}${t.last}`).join(',');
        // MAX / MIN return 0 over an all-text range, so they are guarded to NA
        const f = fn === 'MAX' || fn === 'MIN' ? `IF(COUNT(${ranges})=0,"NA",${fn}(${ranges}))` : na(`${fn}(${ranges})`);
        put(ws, `${c.col}${r}`, { formula: f }, { fmt: kindFmt(c.spec.kind, F), bold: true, align: 'right' });
      }
      if (label === 'Mean') edge(ws, r, allCols, 'top', 'thin', C_RULE);
      r++;
    }
    edge(ws, r - 1, allCols, 'bottom', 'thin', C_RULE);
  }

  r++;
  put(ws, `B${r++}`, `Source: ${source}`, { italic: true, color: C_MUTED, size: 9 });
  if (note) put(ws, `B${r++}`, note, { italic: true, color: C_MUTED, size: 9 });
  if (statNote) put(ws, `B${r++}`, statNote, { italic: true, color: C_MUTED, size: 9 });
  return r + 1;
}

/**
 * Implied share price from the peer set: every peer's LTM multiples in one
 * contiguous block (live links), the quartiles off that, and multiple × the
 * target's LTM metric (Inputs sheet) → enterprise / equity value → per share.
 * Returns the refs the Combined sheet or a summary can link to.
 */
export function writeImpliedValuation(ws, o) {
  const { F, peerRefs, R, unitNote, target } = o;
  ws.getColumn('A').width = 1.4;
  ws.getColumn('B').width = 32;
  for (let i = 0; i < 4; i++) ws.getColumn(colL(3 + i)).width = 16;
  const allCols = colRun(2, 6);
  styleSheet(ws, { freezeRow: 5, tab: C_TAB_ANALYSIS, printTitles: '1:5', portrait: true });

  put(ws, 'B1', { formula: target.name }, { bold: true, size: 16, color: C_LINK });
  put(ws, 'B2', 'Implied Valuation — Peer LTM Multiples Applied to the Target', { bold: true, size: 12 });
  put(ws, 'B3', unitNote, { italic: true, color: C_MUTED });
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 17;
  ws.getRow(4).height = 6;
  edge(ws, 4, allCols, 'bottom', 'medium', C_HDR_FILL);
  let r = 6;

  const banner = (text, span) => {
    for (let i = 0; i < span; i++) put(ws, `${colL(2 + i)}${r}`, i === 0 ? text : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true });
    if (span > 1) ws.mergeCells(`B${r}:${colL(1 + span)}${r}`);
    ws.getRow(r).height = 19;
    r++;
  };
  banner('PEER TRADING MULTIPLES — LTM', 5);

  const metricRef = { evSales: R.tRev, evEbitda: R.tEbitda, evEbit: R.tEbit, pe: R.tNi };
  const cellOf = { evSales: 'evSales0', evEbitda: 'evEbitda0', evEbit: 'evEbit0', pe: 'pe0' };
  const bases = IMPLIED_ROWS.map((b) => ({ ...b, cell: cellOf[b.key], metricRef: metricRef[b.key] }));

  ['Peer (LTM)', ...bases.map((b) => b.label)].forEach((h, i) =>
    put(ws, `${colL(2 + i)}${r}`, h, { bold: true, fill: C_SECTION_FILL, align: i ? 'center' : 'left', wrap: true }));
  ws.getRow(r).height = 30;
  edge(ws, r, allCols, 'bottom', 'thin', C_RULE);
  r++;
  const first = r;
  for (const refs of peerRefs) {
    put(ws, `B${r}`, { formula: refs.name }, { color: C_LINK });
    bases.forEach((b, i) => put(ws, `${colL(3 + i)}${r}`, { formula: refs[b.cell] }, { fmt: F.x2, color: C_LINK, align: 'right' }));
    r++;
  }
  const last = r - 1;

  const statRows = {};
  for (const [label, fn] of [['Mean', 'AVERAGE(%r)'], ['Median', 'MEDIAN(%r)'], ['25th percentile', 'QUARTILE(%r,1)'], ['75th percentile', 'QUARTILE(%r,3)']]) {
    put(ws, `B${r}`, label, { bold: true });
    bases.forEach((b, i) => {
      const col = colL(3 + i);
      put(ws, `${col}${r}`, { formula: na(fn.replace('%r', `${col}${first}:${col}${last}`)) }, { fmt: F.x2, bold: true, align: 'right' });
    });
    if (label === 'Mean') edge(ws, r, allCols, 'top', 'thin', C_RULE);
    statRows[label] = r++;
  }
  edge(ws, r - 1, allCols, 'bottom', 'thin', C_RULE);
  r += 2;

  put(ws, `B${r}`, 'Target LTM metrics (Inputs sheet)', { bold: true, fill: C_SECTION_FILL });
  fillRow(ws, r, allCols, C_SECTION_FILL);
  r++;
  const metricRow = {};
  for (const b of bases) {
    put(ws, `B${r}`, `   ${b.metricLabel}`);
    put(ws, `C${r}`, { formula: b.metricRef }, { fmt: F.plain, color: C_LINK, align: 'right' });
    metricRow[b.key] = r++;
  }
  put(ws, `B${r}`, '   Less: net debt');
  put(ws, `C${r}`, { formula: R.netDebt }, { fmt: F.plain, color: C_LINK, align: 'right' });
  const netDebtRow = r++;
  put(ws, `B${r}`, '   Diluted shares');
  put(ws, `C${r}`, { formula: R.shares }, { fmt: F.shares, color: C_LINK, align: 'right' });
  const sharesRow = r++;
  edge(ws, r - 1, allCols, 'bottom', 'thin', C_RULE);
  r += 2;

  banner('IMPLIED SHARE PRICE', 4);
  ['', '25th percentile', 'Median', '75th percentile'].forEach((h, i) =>
    put(ws, `${colL(2 + i)}${r}`, h, { bold: true, fill: C_SECTION_FILL, align: i ? 'center' : 'left' }));
  edge(ws, r, colRun(2, 5), 'bottom', 'thin', C_RULE);
  r++;

  const refs = {};
  const priceFirst = r;
  bases.forEach((b, i) => {
    const mult = colL(3 + i);
    const metric = `$C$${metricRow[b.key]}`;
    put(ws, `B${r}`, b.label, { bold: true });
    [['25th percentile', 'C'], ['Median', 'D'], ['75th percentile', 'E']].forEach(([stat, out]) => {
      const m = `${mult}${statRows[stat]}`;
      const f = b.ev ? `(${m}*${metric}-$C$${netDebtRow})/$C$${sharesRow}` : `${m}*${metric}/$C$${sharesRow}`;
      put(ws, `${out}${r}`, { formula: na(`IF($C$${sharesRow}>0,${f},"NA")`) }, { fmt: F.price, align: 'right', bold: stat === 'Median' });
    });
    refs[b.key] = { lo: `'${ws.name}'!$C$${r}`, mid: `'${ws.name}'!$D$${r}`, hi: `'${ws.name}'!$E$${r}` };
    r++;
  });
  for (let rr = priceFirst; rr < r; rr++) ws.getCell(`D${rr}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_GRID_FILL } };
  edge(ws, r - 1, colRun(2, 5), 'bottom', 'double', C_HDR_FILL);

  r += 2;
  put(ws, `B${r++}`, 'Every row is shown side by side — there is no single headline. Quartiles use the same interpolation as Excel QUARTILE.INC.', { italic: true, color: C_MUTED, size: 9 });
  put(ws, `B${r++}`, 'NA / NM peer multiples are excluded from the statistics.', { italic: true, color: C_MUTED, size: 9 });
  return refs;
}

/** The flat "List of Comparable Companies" page — target first, then every peer. */
export function writeListSheet(ws, o) {
  const { F, unitNote, target, allRefs, source } = o;
  ws.getColumn('A').width = 1.4;
  ws.getColumn('B').width = 28;
  ws.getColumn('C').width = 9.5;
  ws.getColumn('D').width = 64;
  for (let i = 0; i < 4; i++) ws.getColumn(colL(5 + i)).width = 15;
  const allCols = colRun(2, 1 + LIST_COLS.length);
  styleSheet(ws, { freezeRow: 7, freezeCol: 3, tab: C_TAB_ANALYSIS, printTitles: '1:7' });

  put(ws, 'B1', { formula: target.name }, { bold: true, size: 16, color: C_LINK });
  put(ws, 'B2', 'List of Comparable Companies', { bold: true, size: 12 });
  put(ws, 'B3', unitNote, { italic: true, color: C_MUTED });
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 17;
  ws.getRow(4).height = 6;
  edge(ws, 4, allCols, 'bottom', 'medium', C_HDR_FILL);

  const R_LABEL = 6, R_UNIT = 7, R_TARGET = 9;
  LIST_COLS.forEach((c, i) => put(ws, `${colL(2 + i)}${R_LABEL}`, c.label, { bold: true, fill: C_SECTION_FILL, align: i > 2 ? 'center' : 'left', wrap: true }));
  ws.getRow(R_LABEL).height = 20;
  ws.getRow(R_UNIT).height = 4;
  edge(ws, R_UNIT, allCols, 'bottom', 'medium', C_HDR_FILL);

  let r = R_TARGET;
  const rowFor = (refs, bold, fill) => {
    LIST_COLS.forEach((c, i) => {
      const ref = refs[c.cell];
      if (!ref) return;
      put(ws, `${colL(2 + i)}${r}`, { formula: ref },
        { fmt: kindFmt(c.kind, F), color: C_LINK, bold, fill, align: c.kind === 'money' ? 'right' : 'left', wrap: c.wide, wrapTop: c.wide });
    });
    ws.getRow(r).height = 28;
    r++;
  };
  rowFor(target, true, C_GRID_FILL);
  fillRow(ws, r - 1, allCols, C_GRID_FILL);
  edge(ws, r - 1, allCols, 'top', 'thin', C_HDR_FILL);
  edge(ws, r - 1, allCols, 'bottom', 'thin', C_HDR_FILL);
  r++;
  for (const refs of allRefs) rowFor(refs, false);
  edge(ws, r - 1, allCols, 'bottom', 'thin', C_RULE);
  r++;
  put(ws, `B${r}`, `Source: ${source}`, { italic: true, color: C_MUTED, size: 9 });
  return ws;
}

/**
 * Links from the target page to the Inputs sheet: the comps target's own LTM
 * inputs plus the Company step (shares, price, debt, cash). FY0 is the LTM
 * year (no stubs); FY-1 carries the prior-year revenue and EBITDA.
 */
function targetLinks(R) {
  const L = {
    name: R.name, ticker: R.tTicker, exchange: R.tExchange, description: R.tDesc,
    moodys: R.tMoodys, sp: R.tSp, beta: R.tBeta, price: R.curPrice, high52: R.tHigh, low52: R.tLow,
    'is.sales.1': R.tPriorRev, 'is.sales.2': R.tRev,
    'is.interest.2': R.tInt,
    'is.dilutedShares.2': R.shares,
    'rep.grossProfit.2': R.tGross,
    'rep.ebitda.1': R.tPriorEbitda, 'rep.ebitda.2': R.tEbitda,
    'rep.ebit.2': R.tEbit,
    'rep.netIncome.2': R.tNi,
    'cf.da.2': `IFERROR(${R.tEbitda}-${R.tEbit},"NA")`,
    'bs.cash.1': R.cash, 'bs.debt.1': R.grossDebt, 'bs.equity.1': R.tEquity,
    basicShares: R.shares,
  };
  return Object.fromEntries(Object.entries(L).filter(([, v]) => v));
}

/**
 * Build the comps package onto a workbook. `R` holds the Inputs-sheet refs.
 * Returns the sheet names written, in order, plus the analysis refs.
 */
export function addCompsSheets(wb, a, F, unitNote, taken, R) {
  const peers = a.comps?.peers || [];
  const targetCo = targetCompanyPage(a);
  const all = [targetCo, ...peers];

  const optCount = Math.max(5, ...all.map((c) => (c.options || []).length));
  const convCount = Math.max(5, ...all.map((c) => (c.converts || []).length));
  const L = companyLayout(optCount, convCount);

  const source = a.comps?.source || 'Company filings';
  const asOf = a.comps?.asOfDate ? `Last twelve months data based on ${a.comps.asOfDate}. ` : '';
  const note = `Note: ${asOf}All multiples are LTM. LTM = FY0 + current stub − prior stub.`;
  const statNote = 'Statistics exclude companies reporting NA (not available) or NM (not meaningful — a multiple on a non-positive metric) for a given line.';

  const targetSheetName = sheetName(targetCo.name ? `${targetCo.name} (target)` : 'Target', taken);
  const peerSheetNames = peers.map((p) => sheetName(p.name || 'Peer', taken));
  const analysisNames = {
    b1: sheetName('Benchmarking 1', taken),
    b2: sheetName('Benchmarking 2', taken),
    out: sheetName('Comps Analysis', taken),
    implied: peers.length ? sheetName('Implied Valuation', taken) : null,
    list: sheetName('List', taken),
  };

  const b1 = wb.addWorksheet(analysisNames.b1);
  const b2 = wb.addWorksheet(analysisNames.b2);
  const outWs = wb.addWorksheet(analysisNames.out);
  const impliedWs = analysisNames.implied ? wb.addWorksheet(analysisNames.implied) : null;
  const listWs = wb.addWorksheet(analysisNames.list);

  const targetWs = wb.addWorksheet(targetSheetName);
  const targetRefs = writeCompanySheet(targetWs, targetCo, L, F, {
    unitNote, subtitle: 'Target page — linked to the Inputs sheet (FY0 = LTM, no stubs)', links: targetLinks(R),
  });
  const peerRefs = peers.map((p, i) => writeCompanySheet(wb.addWorksheet(peerSheetNames[i]), p, L, F, { unitNote }));

  const tiers = resolveTiers(a).map((t) => ({
    name: t.name,
    refs: peers.map((p, i) => [p, peerRefs[i]]).filter(([p]) => (p.tierId ?? null) === (t.id ?? null)).map(([, r]) => r),
  }));

  const common = { F, unitNote, target: targetRefs, tiers, source, note, statNote };
  writeAnalysisSheet(b1, { ...common, title: 'Benchmarking Analysis — Financial Statistics and Ratios, Page 1', groups: BENCH1_GROUPS });
  writeAnalysisSheet(b2, { ...common, title: 'Benchmarking Analysis — Financial Statistics and Ratios, Page 2', groups: BENCH2_GROUPS });
  writeAnalysisSheet(outWs, { ...common, title: 'Comparable Companies Analysis — LTM Trading Multiples', groups: OUTPUT_GROUPS });
  writeListSheet(listWs, { F, unitNote, target: targetRefs, allRefs: peerRefs, source });
  const implied = impliedWs ? writeImpliedValuation(impliedWs, { F, peerRefs, R, unitNote, target: targetRefs }) : {};

  return {
    order: [analysisNames.b1, analysisNames.b2, analysisNames.out, analysisNames.implied, analysisNames.list, targetSheetName, ...peerSheetNames].filter(Boolean),
    analysisNames, targetSheetName, peerSheetNames, layout: L, targetRefs, peerRefs, implied,
  };
}

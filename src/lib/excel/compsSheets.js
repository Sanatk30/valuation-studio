/**
 * Comparable companies analysis workbook, in the layout of the Rosenbaum &
 * Pearl (Investment Banking, 3E) template:
 *
 *   Benchmarking 1    — market valuation, LTM financials, margins, growth
 *   Benchmarking 2    — general, returns, leverage, coverage, credit ratings
 *   Comps Analysis    — the tiered trading-multiples output page
 *   Implied Valuation — peer quartiles bridged to an implied share price
 *   List              — company, ticker, description, equity value, EV, LTM figures
 *   <Target>          — the target's input page, driven by the shared model
 *   <Peer> × n        — one full input page per comparable company
 *
 * Every analysis cell is a live cross-sheet link into a company page, and every
 * company page cell is a formula off that page's blue inputs. Change a reported
 * number on any input page and the whole analysis recalculates.
 */
import {
  put, colL, colN, na, sheetName, styleSheet, fillRow, edge, colRun,
  C_INPUT, C_LINK, C_HDR_FILL, C_HDR_TEXT, C_SECTION_FILL, C_GRID_FILL, C_MUTED,
  C_RULE, C_TAB_ANALYSIS, C_TAB_INPUT,
} from './xlsxUtil.js';
import {
  LIST_COLS, BENCH1_GROUPS, BENCH2_GROUPS, OUTPUT_GROUPS, resolveTiers, targetCompanyPage,
} from '../engine/comps.js';

/* ------------------------------------------------------- company sheet map */

/** Income-statement period columns: FY-2, FY-1, FY0, prior stub, current stub, LTM. */
const IS_COL = ['I', 'J', 'K', 'L', 'M', 'N'];
/** Balance-sheet columns: prior, current. */
const BS_COL = ['S', 'T'];
/** Estimate columns on the multiples block: NFY, NFY+1, NFY+2 (B is LTM). */
const EST_COL = ['C', 'D', 'E'];

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
    multHdr: 32, multLbl: 33, multDate: 34,
    evSales: 35, evSalesM: 36, evEbitda: 37, evEbitdaM: 38, evEbit: 39, evEbitM: 40,
    pe: 41, peM: 42, pFcf: 43, fcfYield: 44, fcfM: 45,
    roiHdr: 47, roic: 48, roe: 49, roa: 50, divYield: 51,
    creditHdr: 53, debtCap: 54, debtEbitda: 55, netDebtEbitda: 56,
    ebitdaInt: 57, ebitdaCapexInt: 58, ebitInt: 59,
    growthHdr: 61, growthCols: 62, histHdr: 63, hist1: 64, hist2: 65,
    estHdr: 66, est1: 67, est2: 68, ltGrowth: 69,
    /* income statement (labels in G, values in I..N) */
    isHdr: 6, isFyLabel: 8, isDates: 9,
    sales: 10, cogs: 11, grossProfit: 12, sga: 13, otherExp: 14, ebit: 15, interest: 16,
    pretax: 17, taxes: 18, nci: 19, prefDiv: 20, netIncome: 21, effTax: 22,
    wtdShares: 24, dilEps: 25,
    adjHdr: 27, repGross: 28, nrCogs: 29, adjGross: 30, adjGrossM: 31,
    repEbit: 33, nrCogsB: 34, nrOther: 35, adjEbit: 36, adjEbitM: 37,
    daB: 39, adjEbitda: 40, adjEbitdaM: 41,
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
    equityValue: at(`$E$${L.equityValue}`), enterpriseValue: at(`$E$${L.ev}`),
    ltmSales: at(`$N$${L.sales}`), ltmGrossProfit: at(`$N$${L.adjGross}`),
    ltmEbitda: at(`$N$${L.adjEbitda}`), ltmEbit: at(`$N$${L.adjEbit}`), ltmNetIncome: at(`$N$${L.adjNi}`),
    grossMargin: at(`$N$${L.adjGrossM}`), ebitdaMargin: at(`$N$${L.adjEbitdaM}`),
    ebitMargin: at(`$N$${L.adjEbitM}`), netMargin: at(`$N$${L.adjNiM}`),
    gSalesHist1: at(`$B$${L.hist1}`), gSalesEst1: at(`$B$${L.est1}`),
    gEbitdaHist1: at(`$C$${L.hist1}`), gEbitdaEst1: at(`$C$${L.est1}`),
    gEpsEst1: at(`$E$${L.est1}`), gLongTerm: at(`$E$${L.ltGrowth}`),
    roic: at(`$E$${L.roic}`), roe: at(`$E$${L.roe}`), roa: at(`$E$${L.roa}`),
    dividendYield: at(`$E$${L.divYield}`),
    debtToTotalCap: at(`$E$${L.debtCap}`), debtToEbitda: at(`$E$${L.debtEbitda}`),
    netDebtToEbitda: at(`$E$${L.netDebtEbitda}`),
    ebitdaToInterest: at(`$E$${L.ebitdaInt}`),
    ebitdaLessCapexToInterest: at(`$E$${L.ebitdaCapexInt}`),
    ebitToInterest: at(`$E$${L.ebitInt}`),
    evSales0: at(`$B$${L.evSales}`), evSales1: at(`$C$${L.evSales}`), evSales2: at(`$D$${L.evSales}`),
    evEbitda0: at(`$B$${L.evEbitda}`), evEbitda1: at(`$C$${L.evEbitda}`), evEbitda2: at(`$D$${L.evEbitda}`),
    evEbit0: at(`$B$${L.evEbit}`), evEbit1: at(`$C$${L.evEbit}`), evEbit2: at(`$D$${L.evEbit}`),
    pe0: at(`$B$${L.pe}`), pe1: at(`$C$${L.pe}`), pe2: at(`$D$${L.pe}`),
    pFcf0: at(`$B$${L.pFcf}`), pFcf1: at(`$C$${L.pFcf}`), pFcf2: at(`$D$${L.pFcf}`),
  };
}

/* ------------------------------------------------------ company input page */

/** Write one company's full input page. Returns its refs. */
export function writeCompanySheet(ws, co, L, F, opts) {
  const { unitNote, derived } = opts;
  const IN = { color: C_INPUT };                       // blue = type over it
  const w = (col, n) => (ws.getColumn(col).width = n);
  w('A', 34); w('B', 11.5); w('C', 11.5); w('D', 11.5); w('E', 14); w('F', 2.2);
  w('G', 32); w('H', 2.2); w('I', 12); w('J', 12); w('K', 12); w('L', 12); w('M', 12); w('N', 13);
  w('O', 2.2); w('P', 34); w('Q', 12.5); w('R', 12); w('S', 13); w('T', 13);

  // The page is three stacked blocks side by side, so only the title rows are
  // frozen; the whole sheet prints one page wide.
  styleSheet(ws, { freezeRow: 5, tab: C_TAB_INPUT, printTitles: `1:${L.units}` });
  ws.getRow(L.title).height = 22;
  ws.getRow(L.inputPage).height = 15;

  /** A block banner: white on navy, merged across the block, a taller row. */
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
  const inp = (addr, v, fmt) => put(ws, addr, v, { fmt, ...IN, align: 'right' });
  const fml = (addr, f, fmt, o = {}) => put(ws, addr, { formula: f }, { fmt, align: 'right', ...o });

  /* ---------------- header ---------------- */
  put(ws, `A${L.title}`, { formula: `E${L.name}&" ("&E${L.exchange}&":"&E${L.ticker}&")"` }, { bold: true, size: 14 });
  put(ws, `A${L.inputPage}`, derived ? 'Input Page — driven by the model assumptions' : 'Input Page', { italic: true, color: C_MUTED });
  put(ws, `A${L.units}`, unitNote, { italic: true, color: C_MUTED });
  put(ws, 'P1', 'Business Description', { bold: true });
  put(ws, 'P2', co.description || '[to come]', { ...IN, wrap: true, wrapTop: true });
  ws.mergeCells('P2:T4');
  // a merged range takes its outline from the master cell
  ws.getCell('P2').border = {
    top: { style: 'thin', color: { argb: C_RULE } },
    bottom: { style: 'thin', color: { argb: C_RULE } },
  };

  /* ---------------- general information ---------------- */
  hdr(`A${L.genHdr}`, 'General Information', 5);
  lbl(`A${L.name}`, 'Company Name'); inp(`E${L.name}`, co.name, null);
  lbl(`A${L.ticker}`, 'Ticker'); inp(`E${L.ticker}`, co.ticker, null);
  lbl(`A${L.exchange}`, 'Stock Exchange'); inp(`E${L.exchange}`, co.exchange, null);
  lbl(`A${L.fyEnd}`, 'Fiscal Year Ending'); inp(`E${L.fyEnd}`, new Date(co.fyEnd), F.date);
  lbl(`A${L.moodys}`, "Moody's Corporate Rating"); inp(`E${L.moodys}`, co.moodys, null);
  lbl(`A${L.sp}`, 'S&P Corporate Rating'); inp(`E${L.sp}`, co.sp, null);
  lbl(`A${L.beta}`, 'Predicted Beta'); inp(`E${L.beta}`, Number(co.beta), F.num3);
  lbl(`A${L.taxRate}`, 'Marginal Tax Rate'); inp(`E${L.taxRate}`, Number(co.taxRate) / 100, F.pct);

  /* ---------------- market data & EV bridge ---------------- */
  hdr(`A${L.mktHdr}`, 'Selected Market Data', 5);
  lbl(`A${L.price}`, 'Current Price'); inp(`E${L.price}`, co.price, F.price);
  lbl(`A${L.pctHigh}`, '   % of 52-week High', { italic: true });
  fml(`E${L.pctHigh}`, na(`E${L.price}/E${L.high52}`), F.pct, { italic: true });
  lbl(`A${L.high52}`, '52-week High Price'); inp(`E${L.high52}`, co.high52, F.price);
  lbl(`A${L.low52}`, '52-week Low Price'); inp(`E${L.low52}`, co.low52, F.price);
  lbl(`A${L.dps}`, 'Dividend Per Share (MRQ)'); inp(`E${L.dps}`, co.dpsMRQ, F.price);

  lbl(`A${L.fdShares}`, 'Fully Diluted Shares Outstanding');
  fml(`E${L.fdShares}`, `T${L.fullyDiluted}`, F.shares, { color: C_LINK });
  lbl(`A${L.equityValue}`, '   Equity Value', { bold: true });
  fml(`E${L.equityValue}`, `E${L.fdShares}*E${L.price}`, F.money, { bold: true, top: true });
  lbl(`A${L.plusDebt}`, 'Plus: Total Debt');
  fml(`E${L.plusDebt}`, `T${L.bsDebt}`, F.money, { color: C_LINK });
  lbl(`A${L.plusPref}`, 'Plus: Preferred Stock');
  fml(`E${L.plusPref}`, `T${L.bsPref}`, F.money, { color: C_LINK });
  lbl(`A${L.plusNci}`, 'Plus: Noncontrolling Interest');
  fml(`E${L.plusNci}`, `T${L.bsNci}`, F.money, { color: C_LINK });
  lbl(`A${L.lessCash}`, 'Less: Cash and Cash Equivalents');
  fml(`E${L.lessCash}`, `-T${L.bsCash}`, F.money, { color: C_LINK });
  lbl(`A${L.ev}`, '   Enterprise Value', { bold: true });
  fml(`E${L.ev}`, `SUM(E${L.equityValue}:E${L.lessCash})`, F.money, { bold: true, top: true, bottom: 'double' });

  /* ---------------- trading multiples ---------------- */
  hdr(`A${L.multHdr}`, 'Trading Multiples', 5);
  put(ws, `B${L.multLbl}`, 'LTM', { bold: true, align: 'center', fill: C_SECTION_FILL });
  ['NFY', 'NFY+1', 'NFY+2'].forEach((t, i) => put(ws, `${EST_COL[i]}${L.multLbl}`, t, { bold: true, align: 'center', fill: C_SECTION_FILL }));
  put(ws, `B${L.multDate}`, { formula: `N${L.isDates}` }, { fmt: F.date, align: 'center', italic: true });
  EST_COL.forEach((c, i) => put(ws, `${c}${L.multDate}`, { formula: `E${L.fyEnd}+${365 * (i + 1)}` }, { fmt: F.date, align: 'center', italic: true }));
  edge(ws, L.multDate, colRun(1, 5), 'bottom', 'thin', C_RULE);

  /* Each multiple sits directly above its own denominator, so the metric row
     and the multiple can never disagree. A non-positive denominator (a loss
     year, negative free cash flow) makes the multiple not-meaningful: the cell
     reports the text "NM", which AVERAGE / MEDIAN / QUARTILE / MAX / MIN on the
     analysis pages ignore, so one broken peer can't drag a statistic. */
  const nmDiv = (baseCell, metricCell) => `IF(${metricCell}<=0,"NM",IFERROR(${baseCell}/${metricCell},"NM"))`;
  const multiple = (row, metricRow, label, baseCell, ltmSource, estValues, metricFmt) => {
    lbl(`A${row}`, label, { bold: true });
    fml(`B${row}`, nmDiv(baseCell, `B${metricRow}`), F.x2, { bold: true });
    EST_COL.forEach((c) => fml(`${c}${row}`, nmDiv(baseCell, `${c}${metricRow}`), F.x2, { bold: true }));
    lbl(`A${metricRow}`, '   Metric', { italic: true, color: C_MUTED });
    fml(`B${metricRow}`, ltmSource, metricFmt, { italic: true, color: C_LINK });
    EST_COL.forEach((c, i) => put(ws, `${c}${metricRow}`, estValues[i], { fmt: metricFmt, ...IN, align: 'right', italic: true }));
  };
  const ev = `$E$${L.ev}`, px = `$E$${L.price}`;
  multiple(L.evSales, L.evSalesM, 'EV / Sales', ev, `N${L.sales}`, co.est.sales, F.money);
  multiple(L.evEbitda, L.evEbitdaM, 'EV / EBITDA', ev, `N${L.adjEbitda}`, co.est.ebitda, F.money);
  multiple(L.evEbit, L.evEbitM, 'EV / EBIT', ev, `N${L.adjEbit}`, co.est.ebit, F.money);
  multiple(L.pe, L.peM, 'P / E', px, `N${L.adjEps}`, co.est.eps, F.price);
  // P/FCF and FCF Yield share one per-share denominator (the 3E template mixes
  // a total with a per-share figure here, and points its estimate columns at
  // empty cells; both are corrected).
  multiple(L.pFcf, L.fcfM, 'P / FCF', px, `N${L.fcfPerShare}`, co.est.fcfPerShare, F.price);
  // FCF yield is the reciprocal of P/FCF, so it is NM on exactly the same years
  lbl(`A${L.fcfYield}`, 'FCF Yield', { bold: true });
  fml(`B${L.fcfYield}`, `IF(B${L.fcfM}<=0,"NM",${na(`B${L.fcfM}/${px}`)})`, F.pct, { bold: true });
  EST_COL.forEach((c) => fml(`${c}${L.fcfYield}`, `IF(${c}${L.fcfM}<=0,"NM",${na(`${c}${L.fcfM}/${px}`)})`, F.pct, { bold: true }));

  /* ---------------- returns ---------------- */
  hdr(`A${L.roiHdr}`, 'LTM Return on Investment Ratios', 5);
  const avgIC = `AVERAGE(S${L.bsDebt}-S${L.bsCash}+S${L.bsEquity},T${L.bsDebt}-T${L.bsCash}+T${L.bsEquity})`;
  lbl(`A${L.roic}`, 'Return on Invested Capital');
  fml(`E${L.roic}`, na(`N${L.adjEbit}/${avgIC}`), F.pct);
  lbl(`A${L.roe}`, 'Return on Equity');
  fml(`E${L.roe}`, na(`N${L.adjNi}/AVERAGE(S${L.bsEquity},T${L.bsEquity})`), F.pct);
  lbl(`A${L.roa}`, 'Return on Assets');
  fml(`E${L.roa}`, na(`N${L.adjNi}/AVERAGE(S${L.bsTotalAssets},T${L.bsTotalAssets})`), F.pct);
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

  /* ---------------- growth rates ---------------- */
  hdr(`A${L.growthHdr}`, 'Growth Rates', 5);
  ['Sales', 'EBITDA', 'FCF / sh.', 'EPS'].forEach((t, i) => put(ws, `${colL(2 + i)}${L.growthCols}`, t, { bold: true, align: 'center', fill: C_SECTION_FILL }));
  edge(ws, L.growthCols, colRun(1, 5), 'bottom', 'thin', C_RULE);
  // Historical growth is measured on fiscal years (K = FY0, J = FY-1, I = FY-2);
  // FCF and EPS are per-share so their multiples and growth agree.
  const gSrc = [L.sales, L.adjEbitda, L.fcfPerShare, L.adjEps];
  const gEst = [L.evSalesM, L.evEbitdaM, L.fcfM, L.peM];
  lbl(`A${L.histHdr}`, 'Historical', { bold: true });
  lbl(`A${L.hist1}`, '   1-year');
  lbl(`A${L.hist2}`, '   2-year CAGR');
  lbl(`A${L.estHdr}`, 'Estimated', { bold: true });
  lbl(`A${L.est1}`, '   1-year');
  lbl(`A${L.est2}`, '   2-year CAGR');
  gSrc.forEach((srcRow, i) => {
    const c = colL(2 + i);
    fml(`${c}${L.hist1}`, na(`K${srcRow}/J${srcRow}-1`), F.pct);
    fml(`${c}${L.hist2}`, na(`(K${srcRow}/I${srcRow})^(1/2)-1`), F.pct);
    fml(`${c}${L.est1}`, na(`C${gEst[i]}/K${srcRow}-1`), F.pct);
    fml(`${c}${L.est2}`, na(`(D${gEst[i]}/K${srcRow})^(1/2)-1`), F.pct);
  });
  lbl(`A${L.ltGrowth}`, 'Long-term');
  put(ws, `E${L.ltGrowth}`, isFinite(co.ltGrowth) ? Number(co.ltGrowth) / 100 : 'NA', { fmt: F.pct, color: C_INPUT, align: 'right' });

  /* ================= reported income statement ================= */
  hdr(`G${L.isHdr}`, 'Reported Income Statement', 8);
  put(ws, `I${L.isFyLabel}`, { formula: `"Fiscal Year Ending "&TEXT($E$${L.fyEnd},"d mmmm")` }, { italic: true, color: C_MUTED });
  put(ws, `L${L.isFyLabel - 1}`, 'Prior', { bold: true, align: 'center' });
  put(ws, `L${L.isFyLabel}`, 'Stub', { bold: true, align: 'center' });
  put(ws, `M${L.isFyLabel - 1}`, 'Current', { bold: true, align: 'center' });
  put(ws, `M${L.isFyLabel}`, 'Stub', { bold: true, align: 'center' });
  put(ws, `N${L.isFyLabel}`, 'LTM', { bold: true, align: 'center' });
  // period ends: three fiscal years off the FY-end input, two stubs off the stub input
  put(ws, `M${L.isDates}`, new Date(co.stubEnd), { fmt: F.date, color: C_INPUT, align: 'center' });
  put(ws, `K${L.isDates}`, { formula: `E${L.fyEnd}` }, { fmt: F.date, align: 'center', color: C_LINK });
  put(ws, `J${L.isDates}`, { formula: `K${L.isDates}-365` }, { fmt: F.date, align: 'center' });
  put(ws, `I${L.isDates}`, { formula: `J${L.isDates}-365` }, { fmt: F.date, align: 'center' });
  put(ws, `L${L.isDates}`, { formula: `M${L.isDates}-366` }, { fmt: F.date, align: 'center' });
  put(ws, `N${L.isDates}`, { formula: `M${L.isDates}` }, { fmt: F.date, align: 'center' });
  edge(ws, L.isDates, colRun(7, 14), 'bottom', 'thin', C_RULE);

  /** An input line across the five entry periods with the LTM bridge in N. */
  const isInput = (row, label, values, fmt = F.money, o = {}) => {
    lbl(`G${row}`, label, o);
    for (let i = 0; i < 5; i++) put(ws, `${IS_COL[i]}${row}`, values[i], { fmt, ...IN, align: 'right' });
    fml(`N${row}`, `K${row}+M${row}-L${row}`, fmt, o);
  };
  /** A derived line: the same formula written into every period column. */
  const isCalc = (row, label, f, fmt = F.money, o = {}) => {
    lbl(`G${row}`, label, o);
    IS_COL.forEach((c) => fml(`${c}${row}`, f(c), fmt, o));
  };

  // A model-derived target has no COGS/SG&A split, so gross profit reports NA
  // and EBIT is built off the full cost stack instead of off gross profit.
  const grossKnown = co.grossKnown !== false;
  const naRow = (row, label, o = {}) => {
    lbl(`G${row}`, label, o);
    IS_COL.forEach((c) => put(ws, `${c}${row}`, 'NA', { align: 'right', ...o }));
  };

  isInput(L.sales, 'Sales', co.is.sales);
  isInput(L.cogs, 'COGS (incl. D&A)', co.is.cogs);
  if (grossKnown) isCalc(L.grossProfit, '   Gross Profit', (c) => `${c}${L.sales}-${c}${L.cogs}`, F.money, { bold: true, top: true });
  else naRow(L.grossProfit, '   Gross Profit', { bold: true, top: true, italic: true, color: C_MUTED });
  isInput(L.sga, 'SG&A', co.is.sga);
  isInput(L.otherExp, 'Other Expense / (Income)', co.is.otherExp);
  isCalc(L.ebit, '   EBIT',
    (c) => (grossKnown
      ? `${c}${L.grossProfit}-${c}${L.sga}-${c}${L.otherExp}`
      : `${c}${L.sales}-${c}${L.cogs}-${c}${L.sga}-${c}${L.otherExp}`),
    F.money, { bold: true, top: true });
  isInput(L.interest, 'Interest Expense, net', co.is.interest);
  isCalc(L.pretax, '   Pre-tax Income', (c) => `${c}${L.ebit}-${c}${L.interest}`, F.money, { bold: true, top: true });
  isInput(L.taxes, 'Income Taxes', co.is.taxes);
  isInput(L.nci, 'Noncontrolling Interest', co.is.nci);
  isInput(L.prefDiv, 'Preferred Dividends', co.is.prefDiv);
  isCalc(L.netIncome, '   Net Income', (c) => `${c}${L.pretax}-${c}${L.taxes}-${c}${L.nci}-${c}${L.prefDiv}`, F.money, { bold: true, top: true, bottom: 'double' });
  isCalc(L.effTax, '   Effective Tax Rate', (c) => na(`${c}${L.taxes}/${c}${L.pretax}`), F.pct, { italic: true, color: C_MUTED });
  isInput(L.wtdShares, 'Weighted Avg. Diluted Shares', co.is.dilutedShares, F.shares);
  // reported EPS bridges as a flow-per-share, matching the LTM convention
  lbl(`G${L.dilEps}`, '   Diluted EPS', { bold: true });
  IS_COL.slice(0, 5).forEach((c) => fml(`${c}${L.dilEps}`, na(`${c}${L.netIncome}/${c}${L.wtdShares}`), F.price, { bold: true }));
  fml(`N${L.dilEps}`, na(`K${L.dilEps}+M${L.dilEps}-L${L.dilEps}`), F.price, { bold: true });

  /* ================= adjusted income statement ================= */
  hdr(`G${L.adjHdr}`, 'Adjusted Income Statement', 8);
  if (grossKnown) {
    isCalc(L.repGross, 'Reported Gross Profit', (c) => `${c}${L.grossProfit}`);
    isInput(L.nrCogs, 'Non-recurring Items in COGS', co.adj.nrCogs);
    isCalc(L.adjGross, '   Adj. Gross Profit', (c) => `${c}${L.repGross}+${c}${L.nrCogs}`, F.money, { bold: true, top: true });
    isCalc(L.adjGrossM, '   % margin', (c) => na(`${c}${L.adjGross}/${c}${L.sales}`), F.pct, { italic: true, color: C_MUTED });
  } else {
    naRow(L.repGross, 'Reported Gross Profit', { italic: true, color: C_MUTED });
    isInput(L.nrCogs, 'Non-recurring Items in COGS', co.adj.nrCogs);
    naRow(L.adjGross, '   Adj. Gross Profit', { bold: true, top: true, italic: true, color: C_MUTED });
    naRow(L.adjGrossM, '   % margin', { italic: true, color: C_MUTED });
  }

  isCalc(L.repEbit, 'Reported EBIT', (c) => `${c}${L.ebit}`);
  isCalc(L.nrCogsB, 'Non-recurring Items in COGS', (c) => `${c}${L.nrCogs}`);
  isInput(L.nrOther, 'Other Non-recurring Items', co.adj.nrOther);
  isCalc(L.adjEbit, '   Adjusted EBIT', (c) => `SUM(${c}${L.repEbit}:${c}${L.nrOther})`, F.money, { bold: true, top: true });
  isCalc(L.adjEbitM, '   % margin', (c) => na(`${c}${L.adjEbit}/${c}${L.sales}`), F.pct, { italic: true, color: C_MUTED });

  isCalc(L.daB, 'Depreciation & Amortization', (c) => `${c}${L.da}`);
  isCalc(L.adjEbitda, '   Adjusted EBITDA', (c) => `${c}${L.daB}+${c}${L.adjEbit}`, F.money, { bold: true, top: true });
  isCalc(L.adjEbitdaM, '   % margin', (c) => na(`${c}${L.adjEbitda}/${c}${L.sales}`), F.pct, { italic: true, color: C_MUTED });

  isCalc(L.repNi, 'Reported Net Income', (c) => `${c}${L.netIncome}`);
  isCalc(L.nrCogsC, 'Non-recurring Items in COGS', (c) => `${c}${L.nrCogs}`);
  isCalc(L.nrOtherB, 'Other Non-recurring Items', (c) => `${c}${L.nrOther}`);
  isInput(L.nrNonOp, 'Non-operating Non-rec. Items', co.adj.nrNonOp);
  isCalc(L.taxAdj, 'Tax Adjustment', (c) => `-(SUM(${c}${L.nrCogsC}:${c}${L.nrNonOp})*$E$${L.taxRate})`);
  isCalc(L.adjNi, '   Adjusted Net Income', (c) => `SUM(${c}${L.repNi}:${c}${L.taxAdj})`, F.money, { bold: true, top: true });
  isCalc(L.adjNiM, '   % margin', (c) => na(`${c}${L.adjNi}/${c}${L.sales}`), F.pct, { italic: true, color: C_MUTED });
  isCalc(L.adjEps, 'Adjusted Diluted EPS', (c) => na(`${c}${L.adjNi}/${c}${L.wtdShares}`), F.price, { bold: true });

  /* ================= cash flow ================= */
  hdr(`G${L.cfHdr}`, 'Cash Flow Statement Data', 8);
  isInput(L.cfo, 'Cash From Operations', co.cf.cfo);
  isInput(L.capex, 'Capital Expenditures', co.cf.capex);
  isCalc(L.capexPct, '   % sales', (c) => na(`${c}${L.capex}/${c}${L.sales}`), F.pct, { italic: true, color: C_MUTED });
  isCalc(L.fcf, '   Free Cash Flow', (c) => `${c}${L.cfo}-${c}${L.capex}`, F.money, { bold: true, top: true });
  isCalc(L.fcfMargin, '   % margin', (c) => na(`${c}${L.fcf}/${c}${L.sales}`), F.pct, { italic: true, color: C_MUTED });
  isCalc(L.fcfPerShare, '   FCF / Share', (c) => na(`${c}${L.fcf}/${c}${L.wtdShares}`), F.price, { bold: true });
  isInput(L.da, 'Depreciation & Amortization', co.cf.da);
  isCalc(L.daPct, '   % sales', (c) => na(`${c}${L.da}/${c}${L.sales}`), F.pct, { italic: true, color: C_MUTED });

  /* ================= balance sheet ================= */
  hdr(`P${L.bsHdr}`, 'Balance Sheet Data', 5);
  put(ws, `S${L.bsDates}`, { formula: `J${L.isDates}` }, { fmt: F.date, align: 'center', color: C_LINK });
  put(ws, `T${L.bsDates}`, { formula: `M${L.isDates}` }, { fmt: F.date, align: 'center', color: C_LINK });
  edge(ws, L.bsDates, colRun(16, 20), 'bottom', 'thin', C_RULE);
  const bsInput = (row, label, key) => {
    lbl(`P${row}`, label);
    BS_COL.forEach((c, i) => put(ws, `${c}${row}`, co.bs[key][i], { fmt: F.money, ...IN, align: 'right' }));
  };
  const bsCalc = (row, label, f, o = {}) => {
    lbl(`P${row}`, label, o);
    BS_COL.forEach((c) => fml(`${c}${row}`, f(c), F.money, o));
  };
  bsInput(L.bsCash, 'Cash and Cash Equivalents', 'cash');
  bsInput(L.bsAr, 'Accounts Receivable', 'ar');
  bsInput(L.bsInv, 'Inventories', 'inventory');
  bsInput(L.bsPrepaid, 'Prepaids and Other Current Assets', 'prepaid');
  bsCalc(L.bsTca, '   Total Current Assets', (c) => `SUM(${c}${L.bsCash}:${c}${L.bsPrepaid})`, { bold: true, top: true });
  bsInput(L.bsPpe, 'Property, Plant and Equipment, net', 'ppe');
  bsInput(L.bsGoodwill, 'Goodwill and Intangible Assets', 'goodwill');
  bsInput(L.bsOtherAssets, 'Other Assets', 'otherAssets');
  bsCalc(L.bsTotalAssets, '   Total Assets', (c) => `${c}${L.bsTca}+SUM(${c}${L.bsPpe}:${c}${L.bsOtherAssets})`, { bold: true, top: true, bottom: 'double' });
  bsInput(L.bsAp, 'Accounts Payable', 'ap');
  bsInput(L.bsAccrued, 'Accrued Liabilities', 'accrued');
  bsInput(L.bsOtherCl, 'Other Current Liabilities', 'otherCurLiab');
  bsCalc(L.bsTcl, '   Total Current Liabilities', (c) => `SUM(${c}${L.bsAp}:${c}${L.bsOtherCl})`, { bold: true, top: true });
  bsInput(L.bsDebt, 'Total Debt', 'debt');
  bsInput(L.bsOtherLt, 'Other Long-Term Liabilities', 'otherLTLiab');
  bsCalc(L.bsTotalLiab, '   Total Liabilities', (c) => `${c}${L.bsTcl}+SUM(${c}${L.bsDebt}:${c}${L.bsOtherLt})`, { bold: true, top: true });
  bsInput(L.bsNci, 'Noncontrolling Interest', 'nci');
  bsInput(L.bsPref, 'Preferred Stock', 'preferred');
  bsInput(L.bsEquity, "Shareholders' Equity", 'equity');
  bsCalc(L.bsTotalLe, '   Total Liabilities and Equity', (c) => `${c}${L.bsTotalLiab}+SUM(${c}${L.bsNci}:${c}${L.bsEquity})`, { bold: true, top: true, bottom: 'double' });
  bsCalc(L.bsCheck, 'Balance Check', (c) => `${c}${L.bsTotalAssets}-${c}${L.bsTotalLe}`, { bold: true });

  /* ================= fully diluted shares ================= */
  hdr(`P${L.shHdr}`, 'Calculation of Fully Diluted Shares Outstanding', 5);
  lbl(`P${L.basicShares}`, 'Basic Shares Outstanding');
  put(ws, `T${L.basicShares}`, co.basicShares, { fmt: F.shares, ...IN, align: 'right' });
  lbl(`P${L.plusOptions}`, 'Plus: Shares from In-the-Money Options');
  fml(`T${L.plusOptions}`, `S${L.optTotal}`, F.shares);
  lbl(`P${L.lessRepurch}`, 'Less: Shares Repurchased');
  fml(`T${L.lessRepurch}`, na(`-T${L.optTotal}/E${L.price}`), F.shares);
  lbl(`P${L.netNewOptions}`, '   Net New Shares from Options', { bold: true });
  fml(`T${L.netNewOptions}`, `T${L.plusOptions}+T${L.lessRepurch}`, F.shares, { bold: true, top: true });
  lbl(`P${L.plusConverts}`, 'Plus: Shares from Convertible Securities');
  fml(`T${L.plusConverts}`, `T${L.convTotal}`, F.shares);
  lbl(`P${L.fullyDiluted}`, '   Fully Diluted Shares Outstanding', { bold: true });
  fml(`T${L.fullyDiluted}`, `T${L.basicShares}+SUM(T${L.netNewOptions}:T${L.plusConverts})`, F.shares, { bold: true, top: true, bottom: 'double' });

  /* options / warrants */
  hdr(`P${L.optHdr}`, 'Options / Warrants', 5);
  put(ws, `Q${L.optSub}`, 'Number of', { bold: true, align: 'center' });
  put(ws, `R${L.optSub}`, 'Exercise', { bold: true, align: 'center' });
  put(ws, `S${L.optSub}`, 'In-the-Money', { bold: true, align: 'center' });
  ['Tranche', 'Shares', 'Price', 'Shares', 'Proceeds'].forEach((t, i) => put(ws, `${colL(16 + i)}${L.optCols}`, t, { bold: true, align: i ? 'center' : 'left', fill: C_SECTION_FILL }));
  edge(ws, L.optCols, colRun(16, 20), 'bottom', 'thin', C_RULE);
  for (let i = 0; i < L.optCount; i++) {
    const r = L.optStart + i, o = co.options[i] || { shares: 0, strike: 0 };
    put(ws, `P${r}`, `Tranche ${i + 1}`);
    put(ws, `Q${r}`, o.shares, { fmt: F.shares, ...IN, align: 'right' });
    put(ws, `R${r}`, o.strike, { fmt: F.price, ...IN, align: 'right' });
    fml(`S${r}`, `IF(R${r}<$E$${L.price},Q${r},0)`, F.shares);
    fml(`T${r}`, `S${r}*R${r}`, F.money);
  }
  put(ws, `P${L.optTotal}`, '   Total', { bold: true });
  ['Q', 'S', 'T'].forEach((c) => fml(`${c}${L.optTotal}`, `SUM(${c}${L.optStart}:${c}${L.optStart + L.optCount - 1})`, c === 'T' ? F.money : F.shares, { bold: true, top: true }));

  /* convertible securities */
  hdr(`P${L.convHdr}`, 'Convertible Securities', 5);
  put(ws, `R${L.convSub}`, 'Conversion', { bold: true, align: 'center' });
  put(ws, `S${L.convSub}`, 'Conversion', { bold: true, align: 'center' });
  put(ws, `T${L.convSub}`, 'New', { bold: true, align: 'center' });
  ['Issue', 'Amount', 'Price', 'Ratio', 'Shares'].forEach((t, i) => put(ws, `${colL(16 + i)}${L.convCols}`, t, { bold: true, align: i ? 'center' : 'left', fill: C_SECTION_FILL }));
  edge(ws, L.convCols, colRun(16, 20), 'bottom', 'thin', C_RULE);
  for (let i = 0; i < L.convCount; i++) {
    const r = L.convStart + i, c = co.converts[i] || { amount: 0, price: 0 };
    put(ws, `P${r}`, `Issue ${i + 1}`);
    put(ws, `Q${r}`, c.amount, { fmt: F.money, ...IN, align: 'right' });
    put(ws, `R${r}`, c.price, { fmt: F.price, ...IN, align: 'right' });
    fml(`S${r}`, `IFERROR(1000/R${r},0)`, F.num);
    fml(`T${r}`, `IF(R${r}<$E$${L.price},IFERROR(Q${r}/R${r},0),0)`, F.shares);
  }
  put(ws, `P${L.convTotal}`, '   Total', { bold: true });
  fml(`Q${L.convTotal}`, `SUM(Q${L.convStart}:Q${L.convStart + L.convCount - 1})`, F.money, { bold: true, top: true });
  fml(`T${L.convTotal}`, `SUM(T${L.convStart}:T${L.convStart + L.convCount - 1})`, F.shares, { bold: true, top: true });

  return companyRefs(ws.name, L);
}

/* ==================================================================== */
/*                          analysis pages                              */
/* ==================================================================== */

/**
 * Excel number format for a column spec's `kind`, on an ANALYSIS page.
 * Money columns are plain numbers here: the page header already states
 * "(₹ in Cr…)", and repeating the symbol down twenty columns is noise. The
 * currency symbol stays where it carries information — per-share prices, and
 * the company input pages.
 */
const kindFmt = (kind, F) => ({
  money: F.plain, price: F.price, pct: F.pct, x: F.x2,
  num: F.num3, date: F.date, text: null,
}[kind] ?? null);

/**
 * Lay columns out left to right: B = Company, C = Ticker, then each group
 * separated by a narrow spacer column, exactly as the template reads.
 */
function planColumns(groups, lead = 2) {
  const plan = [];
  let n = 2;                                  // column B
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
 * Write a tiered analysis page (Benchmarking 1 / 2, or the Output page).
 *
 * Every value cell is a live link into a company sheet; every statistic is an
 * AVERAGE / MEDIAN / MAX / MIN over the peer rows on this page, so the whole
 * page recalculates from the input pages alone.
 */
export function writeAnalysisSheet(ws, o) {
  const { title, groups, F, unitNote, target, tiers, source, note, statNote } = o;
  const { plan, lastCol } = planColumns(groups);
  const cols = plan.filter((p) => p.kind === 'col');
  const allCols = colRun(2, lastCol);                  // B .. last, spacers included

  ws.getColumn('A').width = 1.4;
  ws.getColumn('B').width = 28;
  ws.getColumn('C').width = 9.5;
  for (const p of plan) {
    if (p.kind === 'spacer') ws.getColumn(p.col).width = 1.4;
    else if (p.kind === 'col') ws.getColumn(p.col).width = { text: 11, money: 14 }[p.spec.kind] ?? 12.5;
  }

  const R_GROUP = 6, R_LABEL = 8, R_UNIT = 9, R_TARGET = 11;

  // company name and ticker stay on screen while the columns scroll
  styleSheet(ws, { freezeRow: R_UNIT, freezeCol: 3, tab: C_TAB_ANALYSIS, printTitles: `1:${R_UNIT}` });

  put(ws, 'B1', { formula: target.name }, { bold: true, size: 16, color: C_LINK });
  put(ws, 'B2', title, { bold: true, size: 12 });
  put(ws, 'B3', unitNote, { italic: true, color: C_MUTED });
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 17;
  ws.getRow(4).height = 6;
  edge(ws, 4, allCols, 'bottom', 'medium', C_HDR_FILL);

  // Group banners. The cells are merged: a banner sits in one cell with filled
  // neighbours either side, and Excel clips rather than overflows into those.
  for (const g of plan.filter((p) => p.kind === 'groupSpan')) {
    if (!g.group.title) continue;
    // colN, not charCodeAt: the output page runs past column Z, and single-letter
    // arithmetic silently dropped the last group's banner.
    const from = colN(g.from), to = colN(g.to);
    for (let c = from; c <= to; c++) {
      put(ws, `${colL(c)}${R_GROUP}`, c === from ? g.group.title : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true, align: 'center' });
    }
    if (to > from) ws.mergeCells(`${g.from}${R_GROUP}:${g.to}${R_GROUP}`);
  }
  ws.getRow(R_GROUP).height = 19;
  put(ws, `B${R_LABEL}`, 'Company', { bold: true, fill: C_SECTION_FILL });
  put(ws, `C${R_LABEL}`, 'Ticker', { bold: true, fill: C_SECTION_FILL, align: 'center' });
  for (const c of cols) {
    put(ws, `${c.col}${R_LABEL}`, c.spec.label, { bold: true, fill: C_SECTION_FILL, align: 'center', wrap: true });
  }
  // Size the header band to the labels that actually wrap, instead of always
  // reserving three lines — a page of one-line headers was mostly empty space.
  const headerLines = Math.max(1, ...cols.map((c) => {
    const w = ws.getColumn(c.col).width || 12.5;
    return Math.ceil(String(c.spec.label).length / Math.max(6, w - 1.5));
  }));
  ws.getRow(R_LABEL).height = 15 + 12 * Math.min(3, headerLines);
  ws.getRow(R_UNIT).height = 4;
  edge(ws, R_UNIT, allCols, 'bottom', 'medium', C_HDR_FILL);

  /** One company row: name + ticker + every column linked to its sheet. */
  const companyRow = (r, refs, o2 = {}) => {
    put(ws, `B${r}`, { formula: refs.name }, { color: C_LINK, ...o2 });
    put(ws, `C${r}`, { formula: refs.ticker }, { color: C_LINK, align: 'center', ...o2 });
    for (const c of cols) {
      const ref = refs[c.spec.cell];
      if (!ref) continue;
      put(ws, `${c.col}${r}`, { formula: ref }, { fmt: kindFmt(c.spec.kind, F), color: C_LINK, align: 'right', ...o2 });
    }
  };

  // Target row: the subject of the analysis, so it is banded and boxed above
  // the peer set rather than reading as just another company row.
  companyRow(R_TARGET, target, { bold: true, fill: C_GRID_FILL });
  fillRow(ws, R_TARGET, allCols, C_GRID_FILL);
  ws.getRow(R_TARGET).height = 17;
  edge(ws, R_TARGET, allCols, 'top', 'thin', C_HDR_FILL);
  edge(ws, R_TARGET, allCols, 'bottom', 'thin', C_HDR_FILL);

  let r = R_TARGET + 2;
  const tierRanges = [];                       // [{ first, last }] for the overall block
  for (const t of tiers) {
    if (!t.refs.length) continue;
    put(ws, `B${r}`, t.name, { bold: true, fill: C_SECTION_FILL });
    fillRow(ws, r, allCols, C_SECTION_FILL);   // an unbroken band, spacers included
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
        put(ws, `${c.col}${r}`, { formula: na(`${fn}(${c.col}${first}:${c.col}${last})`) },
          { fmt: kindFmt(c.spec.kind, F), bold: true, align: 'right' });
      }
      if (s === 'Mean') edge(ws, r, allCols, 'top', 'thin', C_RULE);
      r++;
    }
    r++;
  }

  // overall block across every tier
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
        put(ws, `${c.col}${r}`, { formula: na(`${fn}(${ranges})`) },
          { fmt: kindFmt(c.spec.kind, F), bold: true, align: 'right' });
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
 * Implied share price from the peer set — its own sheet.
 *
 * Peers are laid out tier by tier on the analysis page, so the quartile
 * formulas need one contiguous range: this page restates every peer's NFY
 * multiples in consecutive rows (still live links to the input pages), takes
 * the quartiles off that, and bridges multiple × target metric → enterprise or
 * equity value → per share. It gets its own sheet because the trading-multiples
 * page's columns are sized for that page (narrow spacers between the groups),
 * which left this narrower block clipped when the two shared a sheet.
 * Returns the refs the football field and summary link to.
 */
export function writeImpliedValuation(ws, o) {
  const { F, peerRefs, model, unitNote, target } = o;

  // The table is exactly B..E — sizing and ruling any wider left the header
  // rules running four empty columns past the last number.
  ws.getColumn('A').width = 1.4;
  ws.getColumn('B').width = 32;
  for (let i = 0; i < 3; i++) ws.getColumn(colL(3 + i)).width = 16;
  const allCols = colRun(2, 5);
  styleSheet(ws, { freezeRow: 5, tab: C_TAB_ANALYSIS, printTitles: '1:5', portrait: true });

  put(ws, 'B1', { formula: target.name }, { bold: true, size: 16, color: C_LINK });
  put(ws, 'B2', 'Implied Valuation — Peer Multiples Applied to the Target', { bold: true, size: 12 });
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
  banner('PEER TRADING MULTIPLES — NEXT FISCAL YEAR', 4);

  const bases = [
    { key: 'evSales', label: 'EV / Sales', cell: 'evSales1', ev: true, metric: model.ntmRevenue, metricLabel: 'NTM Revenue' },
    { key: 'evEbitda', label: 'EV / EBITDA', cell: 'evEbitda1', ev: true, metric: model.ntmEbitda, metricLabel: 'NTM EBITDA' },
    { key: 'pe', label: 'P / E', cell: 'pe1', ev: false, metric: model.ntmNetIncome, metricLabel: 'NTM Net Income' },
  ];

  const mCols = colRun(2, 5);
  ['Peer (NFY basis)', ...bases.map((b) => b.label)].forEach((h, i) =>
    put(ws, `${colL(2 + i)}${r}`, h, { bold: true, fill: C_SECTION_FILL, align: i ? 'center' : 'left' }));
  edge(ws, r, mCols, 'bottom', 'thin', C_RULE);
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
      put(ws, `${col}${r}`, { formula: na(fn.replace('%r', `${col}${first}:${col}${last}`)) },
        { fmt: F.x2, bold: true, align: 'right' });
    });
    if (label === 'Mean') edge(ws, r, mCols, 'top', 'thin', C_RULE);
    statRows[label] = r++;
  }
  edge(ws, r - 1, mCols, 'bottom', 'thin', C_RULE);
  r += 2;

  // target metrics, linked to the shared projection
  put(ws, `B${r}`, 'Target NTM metrics', { bold: true, fill: C_SECTION_FILL });
  fillRow(ws, r, mCols, C_SECTION_FILL);
  r++;
  const metricRow = {};
  for (const b of bases) {
    put(ws, `B${r}`, `   ${b.metricLabel}`);
    put(ws, `C${r}`, { formula: b.metric }, { fmt: F.plain, color: C_LINK, align: 'right' });
    metricRow[b.key] = r++;
  }
  put(ws, `B${r}`, '   Less: net debt');
  put(ws, `C${r}`, { formula: model.netDebt }, { fmt: F.plain, color: C_LINK, align: 'right' });
  const netDebtRow = r++;
  put(ws, `B${r}`, '   Fully diluted shares');
  put(ws, `C${r}`, { formula: model.shares }, { fmt: F.shares, color: C_LINK, align: 'right' });
  const sharesRow = r++;
  edge(ws, r - 1, mCols, 'bottom', 'thin', C_RULE);
  r += 2;

  banner('IMPLIED SHARE PRICE', 4);
  ['', '25th percentile', 'Median', '75th percentile'].forEach((h, i) =>
    put(ws, `${colL(2 + i)}${r}`, h, { bold: true, fill: C_SECTION_FILL, align: i ? 'center' : 'left' }));
  edge(ws, r, mCols, 'bottom', 'thin', C_RULE);
  r++;

  const refs = {};
  const priceFirst = r;
  bases.forEach((b, i) => {
    const mult = colL(3 + i);
    const metric = `$C$${metricRow[b.key]}`;
    put(ws, `B${r}`, b.label, { bold: true });
    [['25th percentile', 'C'], ['Median', 'D'], ['75th percentile', 'E']].forEach(([stat, out]) => {
      const m = `${mult}${statRows[stat]}`;
      const f = b.ev
        ? `(${m}*${metric}-$C$${netDebtRow})/$C$${sharesRow}`
        : `${m}*${metric}/$C$${sharesRow}`;
      put(ws, `${out}${r}`, { formula: na(f) }, { fmt: F.price, align: 'right', bold: stat === 'Median' });
    });
    refs[b.key] = { lo: `'${ws.name}'!$C$${r}`, mid: `'${ws.name}'!$D$${r}`, hi: `'${ws.name}'!$E$${r}` };
    r++;
  });
  // the median column is the headline read, so it carries the emphasis
  for (let rr = priceFirst; rr < r; rr++) ws.getCell(`D${rr}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_GRID_FILL } };
  edge(ws, r - 1, mCols, 'bottom', 'double', C_HDR_FILL);

  r += 2;
  put(ws, `B${r++}`, `${unitNote} · quartiles use the same interpolation as Excel QUARTILE.INC.`, { italic: true, color: C_MUTED, size: 9 });
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

  // Header sits at row 6 — the other analysis pages fill rows 5-7 with a group
  // banner, and this page has none, so it was carrying three dead rows.
  const R_LABEL = 6, R_UNIT = 7, R_TARGET = 9;
  const heads = LIST_COLS.map((c) => c.label);
  heads.forEach((h, i) => put(ws, `${colL(2 + i)}${R_LABEL}`, h, { bold: true, fill: C_SECTION_FILL, align: i > 2 ? 'center' : 'left', wrap: true }));
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
    // business descriptions wrap, so give every company row room for two lines
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
 * Build the whole comps package onto a workbook and return the sheet names
 * written, in order, plus the analysis refs the summary page links to.
 */
export function addCompsSheets(wb, a, F, unitNote, taken, model) {
  const peers = a.comps?.peers || [];
  const targetCo = targetCompanyPage(a);
  const all = [targetCo, ...peers];

  // one shared row layout so every company page has identical anatomy
  const optCount = Math.max(5, ...all.map((c) => (c.options || []).length));
  const convCount = Math.max(5, ...all.map((c) => (c.converts || []).length));
  const L = companyLayout(optCount, convCount);

  const source = a.comps?.source || 'Company filings, Bloomberg, consensus estimates';
  const asOf = a.comps?.asOfDate ? `Last twelve months data based on ${a.comps.asOfDate}. ` : '';
  const note = `Note: ${asOf}Estimates are consensus. LTM = FY0 + current stub − prior stub.`;
  const statNote = 'Statistics exclude companies reporting NA (not available) or NM (not meaningful — a multiple on a non-positive metric) for a given line.';

  // company pages first so the analysis pages can link to them
  const targetSheetName = sheetName(targetCo.name || 'Target', taken);
  const peerSheetNames = peers.map((p) => sheetName(p.name || 'Peer', taken));

  const analysisNames = {
    b1: sheetName('Benchmarking 1', taken),
    b2: sheetName('Benchmarking 2', taken),
    out: sheetName('Comps Analysis', taken),
    // the implied-valuation page only exists when there is a peer set to draw from
    implied: peers.length ? sheetName('Implied Valuation', taken) : null,
    list: sheetName('List', taken),
  };

  // Benchmarking pages lead the workbook; the input pages sit behind them.
  const b1 = wb.addWorksheet(analysisNames.b1);
  const b2 = wb.addWorksheet(analysisNames.b2);
  const outWs = wb.addWorksheet(analysisNames.out);
  const impliedWs = analysisNames.implied ? wb.addWorksheet(analysisNames.implied) : null;
  const listWs = wb.addWorksheet(analysisNames.list);

  const targetWs = wb.addWorksheet(targetSheetName);
  const targetRefs = writeCompanySheet(targetWs, targetCo, L, F, { unitNote, derived: true });
  const peerRefs = peers.map((p, i) => {
    const ws = wb.addWorksheet(peerSheetNames[i]);
    return writeCompanySheet(ws, p, L, F, { unitNote, derived: false });
  });

  const tierCfg = resolveTiers(a);
  const tiers = tierCfg.map((t) => ({
    name: t.name,
    refs: peers.map((p, i) => [p, peerRefs[i]]).filter(([p]) => (p.tierId ?? null) === (t.id ?? null)).map(([, r]) => r),
  }));

  const common = { F, unitNote, target: targetRefs, tiers, source, note, statNote };
  writeAnalysisSheet(b1, { ...common, title: 'Benchmarking Analysis — Financial Statistics and Ratios, Page 1', groups: BENCH1_GROUPS });
  writeAnalysisSheet(b2, { ...common, title: 'Benchmarking Analysis — Financial Statistics and Ratios, Page 2', groups: BENCH2_GROUPS });
  writeAnalysisSheet(outWs, { ...common, title: 'Comparable Companies Analysis', groups: OUTPUT_GROUPS });
  writeListSheet(listWs, { F, unitNote, target: targetRefs, allRefs: peerRefs, source });

  const implied = impliedWs
    ? writeImpliedValuation(impliedWs, { F, peerRefs, model, unitNote, target: targetRefs })
    : {};

  return {
    order: [analysisNames.b1, analysisNames.b2, analysisNames.out, analysisNames.implied, analysisNames.list, targetSheetName, ...peerSheetNames].filter(Boolean),
    analysisNames, targetSheetName, peerSheetNames, layout: L, targetRefs, peerRefs, implied,
  };
}

/** Sheet names the comps package will create, without building the workbook. */
export function compsSheetNames(a, reserved = []) {
  const taken = new Set(reserved);
  const targetCo = targetCompanyPage(a);
  const hasPeers = (a.comps?.peers || []).length > 0;
  const names = {
    b1: sheetName('Benchmarking 1', taken),
    b2: sheetName('Benchmarking 2', taken),
    out: sheetName('Comps Analysis', taken),
    implied: hasPeers ? sheetName('Implied Valuation', taken) : null,
    list: sheetName('List', taken),
  };
  const target = sheetName(targetCo.name || 'Target', taken);
  const peers = (a.comps?.peers || []).map((p) => sheetName(p.name || 'Peer', taken));
  return [names.b1, names.b2, names.out, names.implied, names.list, target, ...peers].filter(Boolean);
}

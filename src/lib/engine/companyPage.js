/**
 * One company page of the Comparable Company / Precedent Transactions
 * templates (Indian Ind AS layout): income statement, balance sheet, cash flow,
 * market data / deal terms and key ratios, over
 *
 *   N fiscal years (1–10, oldest → latest) · Prior-year YTD · Current YTD · LTM
 *
 * Every figure follows the template's own Excel formulas exactly, including
 * how Excel reads a blank cell:
 *   - a blank input counts as 0 in arithmetic (SUM, +, −, ×);
 *   - P&L and cash flow LTM = latest FY + current YTD − prior YTD, so blank YTD
 *     columns make LTM equal the latest FY;
 *   - a balance-sheet LTM line = the interim (current YTD) balance when one is
 *     entered, else the latest FY (IF(ISBLANK(interim), latest FY, interim));
 *   - diluted shares LTM likewise (interim else latest FY);
 *   - EPS = IFERROR(PAT / shares, 0); ratios = IFERROR(…, "") → '' (blank);
 *   - growth rates exist from the second fiscal year; the first year and the
 *     LTM column read 'n.a.'.
 *
 * Cell values are: a number · '' (the template's IFERROR blank) · 'n.a.' ·
 * null (a cell the template leaves empty or greys out, e.g. the balance sheet
 * in the prior-YTD column).
 *
 * The page's lines carry their template row numbers so the Excel writer and
 * this engine walk the same layout.
 */

export const MIN_YEARS = 1;
export const MAX_YEARS = 10;

/* -------------------------------------------------------------- layout */

/** Income statement (rows 7–26). `input` lines are typed; the rest are formulas. */
export const IS_LINES = [
  { key: 'rev', row: 7, label: 'Revenue from Operations', input: true },
  { key: 'otherInc', row: 8, label: 'Other Income', input: true },
  { key: 'totalIncome', row: 9, label: 'Total Income', sub: true },
  { key: 'materials', row: 10, label: 'Cost of Materials (incl. purchases & change in inventories)', input: true },
  { key: 'employee', row: 11, label: 'Employee Benefits Expense', input: true },
  { key: 'otherExp', row: 12, label: 'Other Expenses', input: true },
  { key: 'opex', row: 13, label: 'Total Operating Expenses', sub: true },
  { key: 'ebitda', row: 14, label: 'EBITDA', sub: true },
  { key: 'da', row: 15, label: 'Depreciation & Amortisation', input: true },
  { key: 'ebit', row: 16, label: 'EBIT', sub: true },
  { key: 'finance', row: 17, label: 'Finance Costs', input: true },
  { key: 'exceptional', row: 18, label: 'Exceptional Items (gain + / loss −)', input: true },
  { key: 'pbt', row: 19, label: 'Profit Before Tax', sub: true },
  { key: 'tax', row: 20, label: 'Tax Expense', input: true },
  { key: 'pat', row: 21, label: 'Profit After Tax', sub: true },
  { key: 'assoc', row: 22, label: 'Share of Profit / (Loss) of Associates & JVs', input: true },
  { key: 'nciProfit', row: 23, label: 'Profit Attributable to Non-controlling Interest', input: true },
  { key: 'patOwners', row: 24, label: 'PAT Attributable to Owners', sub: true },
  { key: 'shares', row: 25, label: 'Diluted Weighted Avg. Shares', input: true, kind: 'shares' },
  { key: 'eps', row: 26, label: 'Diluted EPS', kind: 'pershare' },
];

/** Balance sheet (rows 29–64). `head` rows are the underlined sub-headings. */
export const BS_LINES = [
  { head: 'Non-current Assets', row: 29 },
  { key: 'ppe', row: 30, label: 'Property, Plant & Equipment (incl. CWIP)', input: true },
  { key: 'rou', row: 31, label: 'Right-of-Use Assets', input: true },
  { key: 'intangibles', row: 32, label: 'Goodwill & Other Intangibles', input: true },
  { key: 'ncInvest', row: 33, label: 'Non-current Investments', input: true },
  { key: 'otherNca', row: 34, label: 'Other Non-current Assets', input: true },
  { key: 'totalNca', row: 35, label: 'Total Non-current Assets', sub: true },
  { head: 'Current Assets', row: 36 },
  { key: 'inventories', row: 37, label: 'Inventories', input: true },
  { key: 'receivables', row: 38, label: 'Trade Receivables', input: true },
  { key: 'cash', row: 39, label: 'Cash & Cash Equivalents', input: true },
  { key: 'otherBank', row: 40, label: 'Other Bank Balances', input: true },
  { key: 'curInvest', row: 41, label: 'Current Investments (liquid)', input: true },
  { key: 'otherCa', row: 42, label: 'Other Current Assets', input: true },
  { key: 'totalCa', row: 43, label: 'Total Current Assets', sub: true },
  { key: 'totalAssets', row: 44, label: 'TOTAL ASSETS', sub: true },
  { head: 'Equity', row: 46 },
  { key: 'shareCap', row: 47, label: 'Equity Share Capital', input: true },
  { key: 'otherEquity', row: 48, label: 'Other Equity', input: true },
  { key: 'eqOwners', row: 49, label: 'Equity Attributable to Owners', sub: true },
  { key: 'nci', row: 50, label: 'Non-controlling Interest', input: true },
  { key: 'totalEquity', row: 51, label: 'Total Equity', sub: true },
  { head: 'Non-current Liabilities', row: 52 },
  { key: 'ltBorrow', row: 53, label: 'Long-term Borrowings', input: true },
  { key: 'leaseNc', row: 54, label: 'Lease Liabilities (non-current)', input: true },
  { key: 'otherNcl', row: 55, label: 'Other Non-current Liabilities (incl. deferred tax)', input: true },
  { key: 'totalNcl', row: 56, label: 'Total Non-current Liabilities', sub: true },
  { head: 'Current Liabilities', row: 57 },
  { key: 'stBorrow', row: 58, label: 'Short-term Borrowings (incl. current maturities)', input: true },
  { key: 'leaseCur', row: 59, label: 'Lease Liabilities (current)', input: true },
  { key: 'payables', row: 60, label: 'Trade Payables', input: true },
  { key: 'otherCl', row: 61, label: 'Other Current Liabilities & Provisions', input: true },
  { key: 'totalCl', row: 62, label: 'Total Current Liabilities', sub: true },
  { key: 'totalEL', row: 63, label: 'TOTAL EQUITY & LIABILITIES', sub: true },
  { key: 'check', row: 64, label: 'Balance Check (must be 0)' },
];

/** Cash flow statement (rows 67–88). Outflows are entered negative, as reported. */
export const CF_LINES = [
  { key: 'cfPbt', row: 67, label: 'Profit Before Tax', input: true },
  { key: 'cfDa', row: 68, label: 'Depreciation & Amortisation', input: true },
  { key: 'cfFinance', row: 69, label: 'Finance Costs (add back)', input: true },
  { key: 'cfOther', row: 70, label: 'Other Non-cash / Non-operating Adjustments', input: true },
  { key: 'cfWc', row: 71, label: 'Changes in Working Capital', input: true },
  { key: 'cfTax', row: 72, label: 'Income Taxes Paid', input: true },
  { key: 'cfo', row: 73, label: 'Net Cash from Operating Activities (CFO)', sub: true },
  { key: 'capex', row: 74, label: 'Capex – Purchase of PP&E & Intangibles', input: true },
  { key: 'ppeSale', row: 75, label: 'Proceeds from Sale of PP&E', input: true },
  { key: 'investNet', row: 76, label: 'Net (Purchase) / Sale of Investments', input: true },
  { key: 'acquisitions', row: 77, label: 'Acquisitions / Investment in Subsidiaries & JVs', input: true },
  { key: 'intDivRecd', row: 78, label: 'Interest & Dividend Received / Others', input: true },
  { key: 'cfi', row: 79, label: 'Net Cash from Investing Activities (CFI)', sub: true },
  { key: 'borrowNet', row: 80, label: 'Net Proceeds / (Repayment) of Borrowings', input: true },
  { key: 'intPaid', row: 81, label: 'Interest Paid', input: true },
  { key: 'divPaid', row: 82, label: 'Dividends Paid', input: true },
  { key: 'leasePay', row: 83, label: 'Lease Payments', input: true },
  { key: 'equityIssue', row: 84, label: 'Equity Issued / (Buyback)', input: true },
  { key: 'otherFin', row: 85, label: 'Other Financing Items', input: true },
  { key: 'cff', row: 86, label: 'Net Cash from Financing Activities (CFF)', sub: true },
  { key: 'netCash', row: 87, label: 'Net Increase / (Decrease) in Cash', sub: true },
  { key: 'fcf', row: 88, label: 'Free Cash Flow (CFO + Capex)', sub: true },
];

/** Key ratios (rows 91–117), fiscal years and LTM. fmt: pct | x | days. */
export const RATIO_LINES = [
  { head: 'Growth', row: 91 },
  { key: 'gRev', row: 92, label: 'Revenue Growth (YoY)', fmt: 'pct', growth: true },
  { key: 'gEbitda', row: 93, label: 'EBITDA Growth (YoY)', fmt: 'pct', growth: true },
  { key: 'gPat', row: 94, label: 'PAT Growth (YoY)', fmt: 'pct', growth: true },
  { head: 'Profitability & Returns', row: 95 },
  { key: 'ebitdaMargin', row: 96, label: 'EBITDA Margin', fmt: 'pct' },
  { key: 'ebitMargin', row: 97, label: 'EBIT Margin', fmt: 'pct' },
  { key: 'patMargin', row: 98, label: 'PAT Margin (owners)', fmt: 'pct' },
  { key: 'roe', row: 99, label: 'Return on Equity (ROE)', fmt: 'pct' },
  { key: 'roce', row: 100, label: 'Return on Capital Employed (ROCE)', fmt: 'pct' },
  { key: 'roa', row: 101, label: 'Return on Assets (ROA)', fmt: 'pct' },
  { key: 'assetTurn', row: 102, label: 'Asset Turnover', fmt: 'x' },
  { head: 'Leverage & Liquidity', row: 103 },
  { key: 'de', row: 104, label: 'Debt / Equity', fmt: 'x' },
  { key: 'ndEbitda', row: 105, label: 'Net Debt / EBITDA', fmt: 'x' },
  { key: 'intCover', row: 106, label: 'Interest Coverage (EBIT / Finance Costs)', fmt: 'x' },
  { key: 'currentRatio', row: 107, label: 'Current Ratio', fmt: 'x' },
  { head: 'Working Capital (days)', row: 108 },
  { key: 'invDays', row: 109, label: 'Inventory Days', fmt: 'days' },
  { key: 'recDays', row: 110, label: 'Receivable Days', fmt: 'days' },
  { key: 'payDays', row: 111, label: 'Payable Days', fmt: 'days' },
  { key: 'ccc', row: 112, label: 'Cash Conversion Cycle', fmt: 'days' },
  { head: 'Cash Flow Quality', row: 113 },
  { key: 'cfoEbitda', row: 114, label: 'CFO / EBITDA', fmt: 'pct' },
  { key: 'fcfMargin', row: 115, label: 'FCF Margin', fmt: 'pct' },
  { key: 'capexRev', row: 116, label: 'Capex / Revenue', fmt: 'pct' },
  { key: 'payout', row: 117, label: 'Dividend Payout', fmt: 'pct' },
];

export const INPUT_KEYS = {
  is: IS_LINES.filter((l) => l.input).map((l) => l.key),
  bs: BS_LINES.filter((l) => l.input).map((l) => l.key),
  cf: CF_LINES.filter((l) => l.input).map((l) => l.key),
};
const BS_KEYS = new Set(INPUT_KEYS.bs);

/* -------------------------------------------------------------- data */

/**
 * A blank page. Each input line is { fy: [oldest … latest], p, c }: the fiscal
 * years (kept latest-last so changing the number of years never shifts the
 * latest year), prior-year YTD and current YTD (balance sheet: the interim
 * balance; `p` unused). Nothing is pre-filled.
 */
export function blankPage(over = {}) {
  const line = () => ({ fy: [], p: null, c: null });
  return {
    lines: Object.fromEntries([...INPUT_KEYS.is, ...INPUT_KEYS.bs, ...INPUT_KEYS.cf].map((k) => [k, line()])),
    labels: null, // per-page period labels (precedent pages): { fy: [], p, c, ltm }
    ...over,
  };
}

/** No number anywhere on the page (nothing typed, pasted or fetched). */
export function pageIsEmpty(page) {
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  return !Object.values(page?.lines || {}).some((l) => (l.fy || []).some(num) || num(l.p) || num(l.c));
}

/** The last `n` fiscal-year values of a line, oldest first, padded with blanks on the left. */
export function fyValues(line, n) {
  const fy = Array.isArray(line?.fy) ? line.fy : [];
  const tail = fy.slice(-n);
  return [...Array(Math.max(0, n - tail.length)).fill(null), ...tail];
}

/** Set one cell of a page (returns a new page). col: fiscal index 0…n−1 | 'p' | 'c'. */
export function setCell(page, key, col, value, n) {
  const line = page.lines?.[key] || { fy: [], p: null, c: null };
  let next;
  if (col === 'p' || col === 'c') next = { ...line, [col]: value };
  else {
    const fy = fyValues(line, n);
    fy[col] = value;
    // keep any older years beyond the visible window, so a later larger n brings them back
    const older = (line.fy || []).slice(0, Math.max(0, (line.fy || []).length - n));
    next = { ...line, fy: [...older, ...fy] };
  }
  return { ...page, lines: { ...page.lines, [key]: next } };
}

/* -------------------------------------------------------------- helpers */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** Excel's reading of a cell in arithmetic: a blank (null) is 0. */
const z = (v) => (isNum(v) ? v : 0);
const sum = (...vs) => vs.reduce((s, v) => s + z(v), 0);
/** IFERROR(a / b, fallback): a text operand or a zero divisor gives the fallback. */
export const iferrDiv = (a, b, fallback = '') => {
  if (typeof a === 'string' || typeof b === 'string') return fallback;
  const d = z(b);
  return d === 0 ? fallback : z(a) / d;
};
/** Excel ROUND(x, 1): half away from zero. */
export const round1 = (x) => Math.sign(x) * Math.round(Math.abs(x) * 10 + 1e-9) / 10;

/* -------------------------------------------------------------- compute */

/**
 * Compute a page.
 *   n        number of fiscal years (1–10)
 *   toggle   include lease liabilities in net debt (1 / 0)
 *   ytd      the prior / current YTD columns are on the page (else LTM = latest FY)
 *   market   { price, shares } for a listed company, or
 *            { dealEquity, stake, consideration } for a deal page
 * Columns: 0…n−1 fiscal years, n = prior YTD, n+1 = current YTD, n+2 = LTM.
 */
export function computePage(page, { n, toggle = 1, ytd = true, market = {} }) {
  const N = n;
  const P = N, C = N + 1, L = N + 2;
  const cols = N + 3;
  // YTD columns switched off: they are not on the page at all, so LTM = latest FY
  const raw = (key) => {
    const line = page?.lines?.[key];
    const fy = fyValues(line, N);
    return [...fy, ytd && isNum(line?.p) ? line.p : null, ytd && isNum(line?.c) ? line.c : null];
  };
  const r = {};
  const arr = (fn) => Array.from({ length: cols }, (_, i) => fn(i));

  /* ---- flow lines (IS + CF inputs): LTM = latest FY + current YTD − prior YTD ---- */
  for (const key of [...INPUT_KEYS.is, ...INPUT_KEYS.cf]) {
    const v = raw(key);
    if (key === 'shares') {
      // G25 = IF(ISBLANK(F25), D25, F25)
      r.shares = [...v.slice(0, L), v[C] === null ? z(v[N - 1]) : v[C]];
    } else {
      r[key] = [...v.slice(0, L), z(v[N - 1]) + z(v[C]) - z(v[P])];
    }
  }
  /* ---- balance sheet inputs: prior-YTD column not applicable; LTM = interim else latest FY ---- */
  for (const key of INPUT_KEYS.bs) {
    const v = raw(key);
    r[key] = arr((i) => (i === P ? null : i === L ? (v[C] === null ? z(v[N - 1]) : v[C]) : v[i]));
  }

  /* ---- income statement formulas (every column) ---- */
  r.totalIncome = arr((i) => sum(r.rev[i], r.otherInc[i]));
  r.opex = arr((i) => sum(r.materials[i], r.employee[i], r.otherExp[i]));
  r.ebitda = arr((i) => z(r.rev[i]) - r.opex[i]);
  r.ebit = arr((i) => r.ebitda[i] - z(r.da[i]));
  r.pbt = arr((i) => r.ebit[i] + z(r.otherInc[i]) - z(r.finance[i]) + z(r.exceptional[i]));
  r.pat = arr((i) => r.pbt[i] - z(r.tax[i]));
  r.patOwners = arr((i) => r.pat[i] + z(r.assoc[i]) - z(r.nciProfit[i]));
  r.eps = arr((i) => iferrDiv(r.patOwners[i], r.shares[i], 0));

  /* ---- balance sheet totals (fiscal years, interim and LTM; not prior YTD) ---- */
  const bsArr = (fn) => arr((i) => (i === P ? null : fn(i)));
  r.totalNca = bsArr((i) => sum(r.ppe[i], r.rou[i], r.intangibles[i], r.ncInvest[i], r.otherNca[i]));
  r.totalCa = bsArr((i) => sum(r.inventories[i], r.receivables[i], r.cash[i], r.otherBank[i], r.curInvest[i], r.otherCa[i]));
  r.totalAssets = bsArr((i) => r.totalNca[i] + r.totalCa[i]);
  r.eqOwners = bsArr((i) => sum(r.shareCap[i], r.otherEquity[i]));
  r.totalEquity = bsArr((i) => r.eqOwners[i] + z(r.nci[i]));
  r.totalNcl = bsArr((i) => sum(r.ltBorrow[i], r.leaseNc[i], r.otherNcl[i]));
  r.totalCl = bsArr((i) => sum(r.stBorrow[i], r.leaseCur[i], r.payables[i], r.otherCl[i]));
  r.totalEL = bsArr((i) => r.totalEquity[i] + r.totalNcl[i] + r.totalCl[i]);
  r.check = bsArr((i) => round1(r.totalAssets[i] - r.totalEL[i]));

  /* ---- cash flow totals (every column) ---- */
  r.cfo = arr((i) => sum(r.cfPbt[i], r.cfDa[i], r.cfFinance[i], r.cfOther[i], r.cfWc[i], r.cfTax[i]));
  r.cfi = arr((i) => sum(r.capex[i], r.ppeSale[i], r.investNet[i], r.acquisitions[i], r.intDivRecd[i]));
  r.cff = arr((i) => sum(r.borrowNet[i], r.intPaid[i], r.divPaid[i], r.leasePay[i], r.equityIssue[i], r.otherFin[i]));
  r.netCash = arr((i) => r.cfo[i] + r.cfi[i] + r.cff[i]);
  r.fcf = arr((i) => r.cfo[i] + z(r.capex[i]));

  /* ---- key ratios: fiscal years and LTM; the YTD columns are not applicable ---- */
  const ratioCols = (fn) => arr((i) => (i === P || i === C ? null : fn(i)));
  const growth = (key) => ratioCols((i) => (i === 0 || i === L ? 'n.a.' : iferrDivMinus1(r[key][i], r[key][i - 1])));
  const iferrDivMinus1 = (a, b) => {
    const q = iferrDiv(a, b, '');
    return q === '' ? '' : q - 1;
  };
  r.gRev = growth('rev');
  r.gEbitda = growth('ebitda');
  r.gPat = growth('patOwners');
  r.ebitdaMargin = ratioCols((i) => iferrDiv(r.ebitda[i], r.rev[i]));
  r.ebitMargin = ratioCols((i) => iferrDiv(r.ebit[i], r.rev[i]));
  r.patMargin = ratioCols((i) => iferrDiv(r.patOwners[i], r.rev[i]));
  r.roe = ratioCols((i) => iferrDiv(r.patOwners[i], r.eqOwners[i]));
  r.roce = ratioCols((i) => iferrDiv(r.ebit[i], r.totalEquity[i] + z(r.ltBorrow[i]) + z(r.stBorrow[i]) + z(r.leaseNc[i]) + z(r.leaseCur[i])));
  r.roa = ratioCols((i) => iferrDiv(r.patOwners[i], r.totalAssets[i]));
  r.assetTurn = ratioCols((i) => iferrDiv(r.rev[i], r.totalAssets[i]));
  r.de = ratioCols((i) => iferrDiv(z(r.ltBorrow[i]) + z(r.stBorrow[i]), r.totalEquity[i]));
  r.ndEbitda = ratioCols((i) => iferrDiv(
    z(r.ltBorrow[i]) + z(r.stBorrow[i]) + (z(r.leaseNc[i]) + z(r.leaseCur[i])) * toggle - z(r.cash[i]) - z(r.otherBank[i]) - z(r.curInvest[i]),
    r.ebitda[i],
  ));
  r.intCover = ratioCols((i) => iferrDiv(r.ebit[i], r.finance[i]));
  r.currentRatio = ratioCols((i) => iferrDiv(r.totalCa[i], r.totalCl[i]));
  const days = (a, b) => {
    const q = iferrDiv(a, b);
    return q === '' ? '' : q * 365;
  };
  r.invDays = ratioCols((i) => days(r.inventories[i], r.materials[i]));
  r.recDays = ratioCols((i) => days(r.receivables[i], r.rev[i]));
  r.payDays = ratioCols((i) => days(r.payables[i], r.materials[i]));
  r.ccc = ratioCols((i) => {
    const [a, b, c] = [r.invDays[i], r.recDays[i], r.payDays[i]];
    return [a, b, c].some((x) => typeof x === 'string') ? '' : a + b - c;
  });
  r.cfoEbitda = ratioCols((i) => iferrDiv(r.cfo[i], r.ebitda[i]));
  r.fcfMargin = ratioCols((i) => iferrDiv(r.fcf[i], r.rev[i]));
  r.capexRev = ratioCols((i) => iferrDiv(-z(r.capex[i]), r.rev[i]));
  r.payout = ratioCols((i) => iferrDiv(-z(r.divPaid[i]), r.patOwners[i]));

  /* ---- market data / deal terms and the EV bridge (LTM balance sheet) ---- */
  const borrowings = z(r.ltBorrow[L]) + z(r.stBorrow[L]);
  const leases = (z(r.leaseNc[L]) + z(r.leaseCur[L])) * toggle;
  const cashLike = z(r.cash[L]) + z(r.otherBank[L]) + z(r.curInvest[L]);
  const netDebt = borrowings + leases - cashLike;
  const nci = z(r.nci[L]);
  const bookEquity = r.eqOwners[L];
  const m = { borrowings, leases, cashLike, netDebt, nci, bookEquity };
  if ('dealEquity' in market) {
    m.equity = z(market.dealEquity);
    m.stake = market.stake;
    m.consideration = market.consideration;
    m.ev = m.equity + netDebt + nci;
  } else {
    m.price = market.price ?? null;
    m.shares = market.shares ?? null;
    m.equity = z(m.price) * z(m.shares);          // market capitalisation
    m.ev = m.equity + netDebt + nci;
    m.bvps = iferrDiv(bookEquity, m.shares, 0);
  }

  return { n: N, ytd, cols: { P, C, L }, v: r, market: m };
}


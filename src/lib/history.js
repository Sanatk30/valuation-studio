/**
 * Reported-statement history → renderable statement sections.
 *
 * `history.statements` (written by the Yahoo company search, see
 * lib/yahoo.js listingHistory) holds every reported line ALREADY converted
 * into the company's valuation currency and money unit at the rate the user
 * confirmed — { annual: { dates, lines }, quarterly: { dates, lines }, kinds }.
 * There is no FX here: this module only lays the lines out as banker-style
 * IS / BS / CF sections with derived margin, growth and check rows. A line
 * that was not reported stays null (NA) and a line never reported is hidden.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Column label for a report date: annual "FY 2026 (Mar)" → "FY26" / "2025"; quarterly "Mar '26". */
function colLabel(date, freq) {
  const [y, m] = date.split('-').map(Number);
  if (freq === 'Q') return `${MONTHS[m - 1]} '${String(y).slice(-2)}`;
  return m === 12 ? String(y) : `FY${String(y).slice(-2)}`;
}

/* Row kinds (display format only — values arrive converted):
 *   money    — an amount in the valuation currency and unit
 *   pershare — per-share (EPS), in the valuation currency
 *   shares   — a share count, in the money unit's scale
 */
const row = (type, label, o = {}) => ({ type, label, kind: 'money', ...o });
const ps = (type, label, o = {}) => ({ type, label, kind: 'pershare', fmt: 'ps', ...o });
const sh = (type, label, o = {}) => ({ type, label, kind: 'shares', fmt: 'sh', ...o });
/** Derived row: fn(get) → vals; get(type) returns the converted, aligned array. */
const der = (label, fn, o = {}) => ({ derived: fn, label, fmt: 'pct', sub: true, ...o });

const pctOf = (get, numType, denType) => {
  const n = get(numType), d = get(denType);
  return n.map((v, i) => (v != null && d[i] ? (v / d[i]) * 100 : null));
};

const LAYOUT = [
  {
    title: 'Income Statement',
    rows: (get, ctx) => [
      row('TotalRevenue', 'Revenue', { bold: true }),
      der('Revenue growth (y/y)', () => ctx.yoy(get('TotalRevenue'))),
      row('CostOfRevenue', 'Less: Cost of revenue', { neg: true, sub: true }),
      row('GrossProfit', 'Gross profit', { bold: true }),
      der('Gross margin', () => pctOf(get, 'GrossProfit', 'TotalRevenue')),
      row('SellingGeneralAndAdministration', 'Less: SG&A', { neg: true, sub: true }),
      row('ResearchAndDevelopment', 'Less: R&D', { neg: true, sub: true }),
      row('OperatingExpense', 'Less: Total operating expenses', { neg: true, sub: true }),
      row('OperatingIncome', 'Operating income', { bold: true }),
      der('Operating margin', () => pctOf(get, 'OperatingIncome', 'TotalRevenue')),
      row('EBITDA', 'EBITDA'),
      der('EBITDA margin', () => pctOf(get, 'EBITDA', 'TotalRevenue')),
      row('EBIT', 'EBIT', { sub: true }),
      row('ReconciledDepreciation', 'D&A (reconciled)', { sub: true }),
      row('InterestExpense', 'Less: Interest expense', { neg: true, sub: true }),
      row('InterestIncome', 'Add: Interest income', { sub: true }),
      row('OtherIncomeExpense', 'Other income / (expense)', { sub: true }),
      row('PretaxIncome', 'Pre-tax income', { bold: true }),
      row('TaxProvision', 'Less: Tax provision', { neg: true, sub: true }),
      der('Effective tax rate', () => pctOf(get, 'TaxProvision', 'PretaxIncome')),
      row('NetIncome', 'Net income', { bold: true }),
      der('Net margin', () => pctOf(get, 'NetIncome', 'TotalRevenue')),
      row('NetIncomeCommonStockholders', 'Net income to common', { sub: true }),
      ps('BasicEPS', 'Basic EPS'),
      ps('DilutedEPS', 'Diluted EPS'),
      sh('BasicAverageShares', 'Basic avg shares', { sub: true }),
      sh('DilutedAverageShares', 'Diluted avg shares', { sub: true }),
    ],
  },
  {
    title: 'Balance Sheet',
    rows: (get) => [
      row('CashAndCashEquivalents', 'Cash & equivalents'),
      row('CashCashEquivalentsAndShortTermInvestments', 'Cash & ST investments', { sub: true }),
      row('AccountsReceivable', 'Accounts receivable'),
      row('Inventory', 'Inventory'),
      row('OtherCurrentAssets', 'Other current assets', { sub: true }),
      row('CurrentAssets', 'Total current assets', { bold: true }),
      row('GrossPPE', 'Gross PP&E', { sub: true }),
      row('AccumulatedDepreciation', 'Less: Accumulated depreciation', { sub: true }),
      row('NetPPE', 'Net PP&E'),
      row('Goodwill', 'Goodwill'),
      row('OtherIntangibleAssets', 'Other intangibles'),
      row('InvestmentsAndAdvances', 'Investments & advances', { sub: true }),
      row('OtherNonCurrentAssets', 'Other non-current assets', { sub: true }),
      row('TotalNonCurrentAssets', 'Total non-current assets', { bold: true }),
      row('TotalAssets', 'TOTAL ASSETS', { bold: true }),
      row('AccountsPayable', 'Accounts payable'),
      row('CurrentDebt', 'Current debt'),
      row('OtherCurrentLiabilities', 'Other current liabilities', { sub: true }),
      row('CurrentLiabilities', 'Total current liabilities', { bold: true }),
      row('LongTermDebt', 'Long-term debt'),
      row('OtherNonCurrentLiabilities', 'Other non-current liabilities', { sub: true }),
      row('TotalNonCurrentLiabilitiesNetMinorityInterest', 'Total non-current liabilities', { bold: true }),
      row('TotalLiabilitiesNetMinorityInterest', 'TOTAL LIABILITIES', { bold: true }),
      row('CommonStock', 'Common stock', { sub: true }),
      row('RetainedEarnings', 'Retained earnings'),
      row('StockholdersEquity', "Stockholders' equity", { bold: true }),
      row('MinorityInterest', 'Minority interest', { sub: true }),
      row('TotalEquityGrossMinorityInterest', 'TOTAL EQUITY', { bold: true }),
      der('Check: A − L − E', (g) => {
        const a_ = g('TotalAssets'), l = g('TotalLiabilitiesNetMinorityInterest'), e = g('TotalEquityGrossMinorityInterest');
        return a_.map((v, i) => (v != null && l[i] != null && e[i] != null ? v - l[i] - e[i] : null));
      }, { fmt: 'num' }),
      row('TotalDebt', 'Total debt (memo)', { sub: true }),
      row('WorkingCapital', 'Working capital (memo)', { sub: true }),
      row('InvestedCapital', 'Invested capital (memo)', { sub: true }),
      row('TangibleBookValue', 'Tangible book value (memo)', { sub: true }),
      sh('ShareIssued', 'Shares issued (memo)', { sub: true }),
    ],
  },
  {
    title: 'Cash Flow Statement',
    rows: (get) => [
      row('NetIncomeFromContinuingOperations', 'Net income (continuing ops)'),
      row('DepreciationAndAmortization', 'Add: D&A'),
      row('StockBasedCompensation', 'Add: Stock-based compensation', { sub: true }),
      row('DeferredIncomeTax', 'Deferred income tax', { sub: true }),
      row('ChangeInWorkingCapital', 'Change in working capital'),
      row('ChangeInReceivables', 'Δ Receivables', { sub: true }),
      row('ChangeInInventory', 'Δ Inventory', { sub: true }),
      row('ChangeInPayable', 'Δ Payables', { sub: true }),
      row('OtherNonCashItems', 'Other non-cash items', { sub: true }),
      row('OperatingCashFlow', 'CASH FROM OPERATIONS', { bold: true }),
      row('CapitalExpenditure', 'Capital expenditure'),
      row('PurchaseOfInvestment', 'Purchases of investments', { sub: true }),
      row('SaleOfInvestment', 'Sales of investments', { sub: true }),
      row('NetOtherInvestingChanges', 'Other investing', { sub: true }),
      row('InvestingCashFlow', 'CASH FROM INVESTING', { bold: true }),
      row('IssuanceOfDebt', 'Debt issued'),
      row('RepaymentOfDebt', 'Debt repaid'),
      row('RepurchaseOfCapitalStock', 'Share buybacks', { sub: true }),
      row('CashDividendsPaid', 'Dividends paid'),
      row('NetOtherFinancingCharges', 'Other financing', { sub: true }),
      row('FinancingCashFlow', 'CASH FROM FINANCING', { bold: true }),
      row('EffectOfExchangeRateChanges', 'FX effect on cash', { sub: true }),
      row('ChangesInCash', 'Net change in cash', { bold: true }),
      row('BeginningCashPosition', 'Beginning cash', { sub: true }),
      row('EndCashPosition', 'Ending cash', { bold: true }),
      row('FreeCashFlow', 'Free cash flow (memo)'),
      der('FCF conversion (FCF / CFO)', (g) => pctOf(g, 'FreeCashFlow', 'OperatingCashFlow')),
    ],
  },
];

/** True when the reported statements carry a quarterly block. */
export const hasQuarterly = (history) => !!history?.statements?.quarterly?.dates?.length;

/** True when there are reported full statements to show at all. */
export const hasStatements = (history) =>
  !!(history?.statements?.annual?.dates?.length || history?.statements?.quarterly?.dates?.length);

/**
 * Build the Past statements at freq 'Y' | 'Q' from `history.statements`.
 * `periods` keeps only the latest N columns (all when omitted).
 * Returns null when there are no reported statements at that frequency;
 * otherwise { labels, dates, sections, currency, unit }.
 */
export function buildHistoryStatements(history, freq = 'Y', periods = null) {
  const st = history?.statements;
  const blk = freq === 'Q' ? st?.quarterly : st?.annual;
  if (!blk?.dates?.length) return null;

  const all = blk.dates;
  const n = Number.isInteger(periods) && periods > 0 ? Math.min(periods, all.length) : all.length;
  const first = all.length - n;
  const dates = all.slice(first);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const empty = new Array(dates.length).fill(null);
  const get = (type) => (blk.lines[type] ? blk.lines[type].slice(first).map(num) : empty);

  // y/y growth matches each column to the report ~1 year earlier (±60 days),
  // so quarterly growth is year-over-year even with missing quarters
  const yoy = (vals) => dates.map((d, i) => {
    if (vals[i] == null) return null;
    const t = new Date(d).getTime() - 365.25 * 86400e3;
    let best = -1, bestGap = Infinity;
    dates.forEach((d2, j) => {
      const gap = Math.abs(new Date(d2).getTime() - t);
      if (gap < bestGap) { bestGap = gap; best = j; }
    });
    if (best < 0 || bestGap > 60 * 86400e3 || vals[best] == null || !vals[best]) return null;
    return (vals[i] / vals[best] - 1) * 100;
  });

  const sections = LAYOUT.map(({ title, rows }) => ({
    title,
    rows: rows(get, { yoy })
      .map((r) => {
        let vals = r.derived ? r.derived(get) : get(r.type);
        if (r.neg) vals = vals.map((v) => (v == null ? null : -Math.abs(v)));
        return { label: r.label, vals, fmt: r.fmt || 'num', bold: !!r.bold, sub: !!r.sub };
      })
      // hide line items the company simply doesn't report
      .filter((r) => r.vals.some((v) => v != null && Number.isFinite(v))),
  })).filter((s) => s.rows.length);

  return {
    labels: dates.map((d) => colLabel(d, freq)),
    dates,
    sections,
    currency: st.currency,
    unit: st.unit,
  };
}

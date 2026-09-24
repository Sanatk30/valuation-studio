/**
 * Reported-statement history → renderable statement sections.
 *
 * `a.history` (written by the top-bar company search) stores RAW reported values in the
 * company's reporting currency. This module aligns every line item on a
 * common set of report dates, converts to the current display currency/unit
 * at render time (so later currency switches keep working), and lays the
 * items out as banker-style IS / BS / CF sections with derived margin,
 * growth and check rows.
 */
import { FX } from './format.js';
import { UNIT_FACTOR } from './yahoo.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Column label for a report date: annual "FY 2026 (Mar)" → "FY26" / "2025"; quarterly "Mar '26". */
function colLabel(date, freq) {
  const [y, m] = date.split('-').map(Number);
  if (freq === 'Q') return `${MONTHS[m - 1]} '${String(y).slice(-2)}`;
  return m === 12 ? String(y) : `FY${String(y).slice(-2)}`;
}

/* Row kinds: how a raw reported value converts for display.
 *   money    — currency-convert then scale into the display unit
 *   pershare — currency-convert only (EPS)
 *   shares   — scale into the display unit only (share counts)
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

export const hasQuarterly = (history) =>
  !!history && Object.keys(history.quarterly || {}).length > 0;

/**
 * Build the Past statements at freq 'Y' | 'Q'.
 * Returns null when there is no history;
 * otherwise { labels, dates, sections, fxOk, note }.
 */
export function buildHistoryStatements(history, settings, freq = 'Y') {
  if (!history) return null;
  const bucket = freq === 'Q' ? history.quarterly || {} : history.annual || {};
  if (!Object.keys(bucket).length) return null;

  // one aligned column set across all three statements
  const dates = [...new Set(Object.values(bucket).flatMap((rows) => rows.map((r) => r.date)))].sort();
  if (!dates.length) return null;
  const idx = new Map(dates.map((d, i) => [d, i]));

  // display conversion: reported currency → display currency (FX is units per USD)
  const fxFrom = FX[history.currency], fxTo = FX[settings.currency];
  const fxOk = isFinite(fxFrom) && isFinite(fxTo);
  const fx = fxOk ? fxTo / fxFrom : 1;
  const uf = UNIT_FACTOR[settings.unit] || 1;
  const KIND = { money: (v) => (v * fx) / uf, pershare: (v) => v * fx, shares: (v) => v / uf };

  const aligned = {}; // type → converted array on the common columns (money-converted)
  const alignedRaw = {};
  for (const [type, rows] of Object.entries(bucket)) {
    const arrM = new Array(dates.length).fill(null);
    const arrR = new Array(dates.length).fill(null);
    for (const r of rows) { const i = idx.get(r.date); if (i != null) { arrM[i] = KIND.money(r.value); arrR[i] = r.value; } }
    aligned[type] = arrM;
    alignedRaw[type] = arrR;
  }
  const empty = new Array(dates.length).fill(null);
  const get = (type) => aligned[type] || empty;
  const getRaw = (type) => alignedRaw[type] || empty;

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
    rows: rows(get, { yoy, getRaw })
      .map((r) => {
        let vals = r.derived ? r.derived(get) : (r.kind === 'money' ? get(r.type) : (getRaw(r.type) || empty).map((v) => (v == null ? null : KIND[r.kind](v))));
        if (r.neg) vals = vals.map((v) => (v == null ? null : -Math.abs(v)));
        return { label: r.label, vals, fmt: r.fmt || 'num', bold: !!r.bold, sub: !!r.sub };
      })
      // hide line items the company simply doesn't report
      .filter((r) => r.vals.some((v) => v != null && isFinite(v))),
  })).filter((s) => s.rows.length);

  return {
    labels: dates.map((d) => colLabel(d, freq)),
    dates,
    sections,
    fxOk,
    note: fxOk
      ? (history.currency !== settings.currency ? `converted ${history.currency} → ${settings.currency} at the model FX` : '')
      : `shown in reported ${history.currency} (no FX rate for ${settings.currency})`,
  };
}

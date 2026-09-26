import { f } from '../fields.js';
import { hasHistory } from '../../lib/historyModel.js';

/* ================================ LBO ================================ */

export const lboEntryStep = () => ({
  id: 'lboEntry',
  title: 'Entry & exit',
  blurb: 'Purchase and exit multiples on EBITDA, the holding period, fees and the cash left in the business at close.',
  fields: (data) => [
    f.x('lbo.entryMultiple', 'Entry EV / LTM EBITDA'),
    f.x('lbo.exitMultiple', 'Exit EV / EBITDA'),
    f.int('lbo.exitYear', 'Exit year', { min: 1, max: Number.isInteger(data.drivers?.years) ? data.drivers.years : undefined, hint: Number.isInteger(data.drivers?.years) ? `1 to ${data.drivers.years} (the forecast horizon)` : 'Within the forecast horizon' }),
    f.pct('lbo.feesPctEV', 'Transaction fees (% of entry EV)', { min: 0 }),
    f.pct('lbo.finFeesPct', 'Financing fees (% of new debt)', { min: 0, hint: 'Capitalised and amortised over the hold (tax-deductible, non-cash)' }),
    f.money('lbo.cashAtClose', 'Cash left on the balance sheet at close', { hint: 'Funded at close as part of the uses; 0 for a cash-free deal' }),
  ],
});

export const lboDebtStep = () => ({
  id: 'lboDebt',
  title: 'Debt structure',
  blurb: 'New acquisition debt, sized as multiples of LTM EBITDA.',
  fields: (data) => {
    const hasMezz = Number.isFinite(data.lbo?.mezzX) && data.lbo.mezzX > 0;
    return [
      f.x('lbo.seniorX', 'Senior debt (x LTM EBITDA)', { gt: undefined, min: 0 }),
      f.pct('lbo.seniorRate', 'Senior interest rate', { min: 0 }),
      f.pct('lbo.seniorAmort', 'Senior amortisation p.a. (% of original)', { min: 0, max: 100 }),
      f.x('lbo.mezzX', 'Mezzanine debt (x LTM EBITDA)', { gt: undefined, min: 0, hint: '0 if none' }),
      ...(hasMezz ? [
        f.pct('lbo.mezzRate', 'Mezzanine interest rate', { min: 0 }),
        f.bool('lbo.mezzPIK', 'Is mezzanine interest PIK?', { yes: 'PIK — accrues to the balance', no: 'Cash-pay' }),
      ] : []),
    ];
  },
});

export const lboSweepStep = () => ({
  id: 'lboSweep',
  title: 'Cash sweep & hurdle',
  blurb: 'How free cash flow repays debt, the operating cash floor, and the return a sponsor requires.',
  fields: () => [
    f.pct('lbo.sweepPct', 'Cash sweep (% of FCF after amortisation)', { min: 0, max: 100 }),
    f.money('lbo.minCash', 'Minimum operating cash', { hint: 'The sweep never takes cash below this' }),
    f.pct('lbo.hurdleRate', 'Sponsor IRR hurdle', { gt: 0, hint: 'Sets the LBO floor price — the most a sponsor could pay and still earn it' }),
  ],
});

/* ================================ IPO ================================ */

export const financingSpecs = ({ ppe = false } = {}) => [
  f.pct('ts.interestRateDebt', 'Interest rate on debt', { min: 0, hint: 'Charged on opening debt' }),
  f.pct('ts.interestRateCash', 'Interest earned on cash', { min: 0, hint: 'On opening cash' }),
  f.pct('ts.debtRepayPct', 'Mandatory debt repayment', { min: 0, max: 100, hint: '% of opening debt each year' }),
  f.pct('ts.dividendPayout', 'Dividend payout', { min: 0, max: 100, hint: '% of net income' }),
  ...(ppe ? [
    f.money('ts.startingPPE', 'Opening net PP&E'),
    f.signedMoney('ts.equity0', "Opening shareholders' equity (reported)", { hint: 'The gap to cash + NWC + PP&E − debt becomes an “Other net assets / (liabilities)” line' }),
  ] : []),
];

export const ipoFinancingStep = () => ({
  id: 'ipoFinancing',
  title: 'Financing rates',
  blurb: 'Needed to take the forecast down to net income (the P/E basis and the pro-forma EPS).',
  fields: () => financingSpecs(),
});

export const ipoPricingStep = () => ({
  id: 'ipoPricing',
  title: 'Pricing basis',
  blurb: 'Fair value from a multiple on next-year (Year 1) earnings, less the discount offered to IPO investors.',
  fields: (data) => [
    f.choice('ipo.basis', 'Pricing basis', [
      { value: 'pe', label: 'P/E × Year-1 net income' },
      { value: 'evEbitda', label: 'EV/EBITDA × Year-1 EBITDA' },
    ]),
    ...(data.ipo?.basis === 'pe' ? [f.x('ipo.offerPE', 'Offer P/E')] : []),
    ...(data.ipo?.basis === 'evEbitda' ? [f.x('ipo.offerEvEbitda', 'Offer EV/EBITDA')] : []),
    f.pct('ipo.ipoDiscount', 'IPO discount to fair value', { min: 0, lt: 100 }),
    f.pct('ipo.rangeBand', 'Bookbuild band below the offer', { min: 0, lt: 100, hint: 'Low end of the price range' }),
  ],
});

export const ipoStructureStep = () => ({
  id: 'ipoStructure',
  title: 'Offer structure',
  blurb: 'New money, shares sold by existing holders, the over-allotment, fees and what the proceeds do.',
  fields: () => [
    f.money('ipo.primaryRaise', 'Primary raise (fresh capital)'),
    f.pct('ipo.secondaryPct', 'Secondary sale (% of existing shares)', { min: 0, max: 100 }),
    f.pct('ipo.greenshoePct', 'Greenshoe size (% of base deal)', { min: 0 }),
    f.pct('ipo.greenshoeExercisedPct', 'Greenshoe exercised', { min: 0, max: 100, hint: '% of the greenshoe actually exercised' }),
    f.choice('ipo.greenshoeType', 'Greenshoe shares are', [
      { value: 'primary', label: 'New shares (primary)', hint: 'Proceeds go to the company; share count rises' },
      { value: 'secondary', label: 'Existing holders’ (secondary)', hint: 'Proceeds go to selling holders; share count unchanged' },
    ]),
    f.pct('ipo.feesPct', 'Underwriting fees + expenses', { min: 0, lt: 100, hint: '% of gross primary proceeds' }),
    f.pct('ipo.useProceedsDebtPct', 'Net proceeds used to repay debt', { min: 0, max: 100, hint: 'The rest stays as cash' }),
  ],
});

/* ============================= Analysis ============================= */

export const financingStep = () => ({
  id: 'financing',
  title: 'Financing & balance sheet',
  blurb: 'Interest, repayment and payout policy, plus the opening PP&E and reported equity.',
  fields: () => financingSpecs({ ppe: true }),
});

function histYearsAvailable(data) {
  return hasHistory(data.history) ? data.history.annual.dates.length : 0;
}

export const ratioSettingsStep = () => ({
  id: 'ratioSettings',
  title: 'Ratio settings',
  blurb: 'Analyse the reported past, or the forecast.',
  fields: (data) => {
    const hy = histYearsAvailable(data);
    const hasQ = !!data.history?.quarterly?.dates?.length;
    return [
      f.choice('ratio.span', 'Which period?', [
        ...(hy ? [{ value: 'past', label: `Past — reported (${hy} yrs available)` }] : []),
        { value: 'future', label: 'Future — the forecast' },
      ], { hint: hy ? undefined : 'Past ratios need reported history (Historical financials step)' }),
      ...(data.ratio?.span === 'past' ? [
        f.int('ratio.histYears', 'Years of history to show', { min: 1, max: hy }),
        ...(hasQ ? [f.choice('ratio.freq', 'Frequency', [{ value: 'Y', label: 'Yearly' }, { value: 'Q', label: 'Quarterly' }])] : []),
      ] : []),
    ];
  },
});

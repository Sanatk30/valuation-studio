import { f } from '../fields.js';
import { hasHistory } from '../../lib/historyModel.js';
import { toEngineInput } from '../../store/methodModel.js';
import { computeIpo } from '../../lib/engine/ipo.js';

/* ====================== Operating forecast grid ====================== */

/** The rows of the year-by-year forecast grid (steps/common.jsx renders them). */
export const GRID_ROWS = [
  { key: 'revenue', modeKey: 'revenueMode', label: 'Revenue', modes: [['growth', 'growth %'], ['abs', 'absolute']] },
  { key: 'ebitda', modeKey: 'ebitdaMode', label: 'EBITDA', modes: [['margin', 'margin %'], ['abs', 'absolute']] },
  { key: 'da', modeKey: 'daMode', label: 'D&A', modes: [['pct', '% of revenue'], ['abs', 'absolute']] },
  { key: 'capex', modeKey: 'capexMode', label: 'Capex', modes: [['pct', '% of revenue'], ['abs', 'absolute']] },
  { key: 'nwc', modeKey: 'nwcMode', label: 'NWC balance', modes: [['pct', '% of revenue'], ['abs', 'absolute']] },
];

/** A per-year array cut or padded (with blanks) to n years. */
export const resize = (arr, n) => Array.from({ length: n }, (_, i) => (arr?.[i] ?? null));

/**
 * A stored per-year row padded to n years, keeping any years beyond the horizon
 * (so lowering the projection years and raising them again loses nothing, as in
 * the DCF / LBO driver grids). The engine reads only the first n.
 */
export const fitKeep = (arr, n) => [...resize(arr, n), ...(Array.isArray(arr) ? arr.slice(n) : [])];

/**
 * Errors in the year-by-year grid. Same logical limits as the start → end
 * fields: growth above −100 %, revenue above 0, EBITDA margin at most 100 %,
 * D&A and capex not negative (in % or absolute).
 */
export function gridErrors(d) {
  if (d.mode !== 'grid') return [];
  const n = d.years;
  if (!Number.isInteger(n) || n < 3 || n > 15) return [];
  const g = d.perYear;
  if (!g) return ['Fill the year-by-year grid.'];
  const errs = [];
  for (const r of GRID_ROWS) {
    const vals = resize(g[r.key], n);
    const has = (test) => vals.some((v) => Number.isFinite(v) && test(v));
    const missing = vals.filter((v) => v === null || !Number.isFinite(v)).length;
    if (missing) errs.push(`${r.label}: ${missing} year${missing > 1 ? 's' : ''} missing`);
    if (r.key === 'revenue' && g.revenueMode === 'growth' && has((v) => v <= -100)) errs.push('Revenue growth must be above −100 %');
    if (r.key === 'revenue' && g.revenueMode === 'abs' && has((v) => v <= 0)) errs.push('Absolute revenue must be above 0');
    if (r.key === 'ebitda' && g.ebitdaMode !== 'abs' && has((v) => v > 100)) errs.push('EBITDA margin must be at most 100 %');
    if ((r.key === 'da' || r.key === 'capex') && has((v) => v < 0)) errs.push(`${r.label} must be at least 0`);
  }
  return errs;
}

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
  summary: (data) => (Number.isFinite(data.ts?.interestRateDebt) ? `debt ${data.ts.interestRateDebt}% · payout ${data.ts?.dividendPayout ?? '—'}%` : null),
  title: 'Financing rates',
  blurb: 'Needed to take the forecast down to net income (the P/E basis and the pro-forma EPS).',
  fields: () => financingSpecs(),
});

export const ipoPricingStep = () => ({
  id: 'ipoPricing',
  summary: (data) => { const p = data.ipo || {}; const x = p.basis === 'pe' ? p.offerPE : p.offerEvEbitda; return p.basis && Number.isFinite(x) ? `${p.basis === 'pe' ? 'P/E' : 'EV/EBITDA'} ${x}x · ${p.ipoDiscount ?? '—'}% discount` : null; },
  title: 'Pricing basis',
  blurb: 'Fair value from a multiple on next-year (Year 1) earnings, less the discount offered to IPO investors.',
  fields: (data) => [
    f.choice('ipo.basis', 'Pricing basis', [
      { value: 'pe', label: 'P/E × Year-1 net income' },
      { value: 'evEbitda', label: 'EV/EBITDA × Year-1 EBITDA' },
    ]),
    ...(data.ipo?.basis === 'pe' ? [f.x('ipo.offerPE', 'Fair-value P/E (peer multiple, before the IPO discount)', { hint: 'Fair equity = P/E × Year-1 net income. Take it from trading comps; the IPO discount is applied after.' })] : []),
    ...(data.ipo?.basis === 'evEbitda' ? [f.x('ipo.offerEvEbitda', 'Fair-value EV/EBITDA (peer multiple, before the IPO discount)', { hint: 'Fair equity = EV/EBITDA × Year-1 EBITDA − net debt. The IPO discount is applied after.' })] : []),
    f.pct('ipo.ipoDiscount', 'IPO discount to fair value', { min: 0, lt: 100 }),
    f.pct('ipo.rangeBand', 'Bookbuild band below the offer', { min: 0, lt: 100, hint: 'Low end of the price range' }),
  ],
});

/** True when no greenshoe share is sold (size or % exercised entered as 0) — its type then does not matter. */
const noGreenshoe = (ipo) => ipo?.greenshoePct === 0 || ipo?.greenshoeExercisedPct === 0;

export const ipoStructureStep = () => ({
  id: 'ipoStructure',
  summary: (data) => (Number.isFinite(data.ipo?.primaryRaise) ? `${data.ipo.primaryRaise} primary` : null),
  title: 'Offer structure',
  blurb: 'New money, shares sold by existing holders, the over-allotment, fees and what the proceeds do.',
  fields: (data) => [
    f.money('ipo.primaryRaise', 'Primary raise (fresh capital)'),
    f.pct('ipo.secondaryPct', 'Secondary sale (% of existing shares)', { min: 0, max: 100 }),
    f.pct('ipo.greenshoePct', 'Greenshoe size (% of base deal)', { min: 0 }),
    f.pct('ipo.greenshoeExercisedPct', 'Greenshoe exercised', { min: 0, max: 100, hint: '% of the greenshoe actually exercised' }),
    f.choice('ipo.greenshoeType', 'Greenshoe shares are', [
      { value: 'primary', label: 'New shares (primary)', hint: 'Proceeds go to the company; share count rises' },
      { value: 'secondary', label: 'Existing holders’ (secondary)', hint: 'Proceeds go to selling holders; share count unchanged' },
    ], noGreenshoe(data.ipo) ? { required: false, hint: 'Not needed — no greenshoe shares are sold' } : {}),
    f.pct('ipo.feesPct', 'Underwriting fees + expenses', { min: 0, lt: 100, hint: '% of gross primary proceeds' }),
    f.pct('ipo.useProceedsDebtPct', 'Net proceeds used to repay debt', { min: 0, max: 100, hint: 'The rest stays as cash' }),
  ],
  // existing holders cannot sell more shares than they hold (secondary sale + secondary greenshoe)
  validate: (data, ctx) => {
    if (!ctx?.company) return [];
    const a = toEngineInput(ctx.company, data);
    const r = computeIpo(a);
    const sold = r.secondaryShares + r.gsSecondary;
    const held = a.company.sharesOut;
    return sold > held * (1 + 1e-12)
      ? [`Existing holders would sell ${+sold.toFixed(4)} shares (secondary sale + secondary greenshoe) but hold only ${+held.toFixed(4)} — lower the secondary sale or the greenshoe, or make the greenshoe primary.`]
      : [];
  },
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

/** True when the user skipped the Historical financials step of this method (history then is not used). */
const historySkipped = (ctx) => !!ctx?.record?.methods?.[ctx?.methodId]?.skipped?.history;

export const ratioSettingsStep = () => ({
  id: 'ratioSettings',
  title: 'Ratio settings',
  blurb: 'Analyse the reported past, or the forecast.',
  fields: (data, ctx) => {
    // a skipped history step means "no history" here too, as in the output and the Excel file
    const skipped = historySkipped(ctx);
    const hy = skipped ? 0 : histYearsAvailable(data);
    const hasQ = !!data.history?.quarterly?.dates?.length;
    return [
      f.choice('ratio.span', 'Which period?', [
        ...(hy ? [{ value: 'past', label: `Past — reported (${hy} yrs available)` }] : []),
        { value: 'future', label: 'Future — the forecast' },
      ], { hint: hy ? undefined : skipped ? 'Past ratios need reported history — the Historical financials step is skipped' : 'Past ratios need reported history (Historical financials step)' }),
      ...(hy && data.ratio?.span === 'past' ? [
        f.int('ratio.histYears', 'Years of history to show', { min: 1, max: hy }),
        ...(hasQ ? [f.choice('ratio.freq', 'Frequency', [{ value: 'Y', label: 'Yearly' }, { value: 'Q', label: 'Quarterly' }])] : []),
      ] : []),
    ];
  },
});

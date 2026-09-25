import { projectOperations } from './drivers.js';
import { computeThreeStatement } from './threeStatement.js';
import { nolStep } from './tax.js';

/**
 * IPO valuation & dilution model.
 *
 * Pricing: fair pre-money equity value from the chosen basis (P/E x Year-1 net
 * income, or EV/EBITDA x Year-1 EBITDA less net debt). IPO investors are
 * offered a discount to fair value; the offer price = discounted pre-money /
 * existing shares.
 *
 * Deal structure: primary raise (fresh shares at the offer price), secondary
 * sale (existing holders, no company proceeds), and the greenshoe
 * over-allotment:
 *   greenshoe shares = base deal shares x greenshoe size % x % exercised
 *   'primary'   — new shares: proceeds to the company, share count rises
 *   'secondary' — existing holders' shares: proceeds to the selling holders,
 *                 share count unchanged
 * The greenshoe type must be chosen whenever greenshoe shares are sold
 * (unchosen → NA). Underwriting fees come out of gross primary proceeds; net
 * proceeds repay debt / build cash, which feeds the post-IPO net debt and the
 * pro-forma Year-1 net income.
 *
 * Pro-forma Year-1 net income: the 3-statement pre-tax income plus the interest
 * saved on repaid debt and earned on the cash added, taxed through the same
 * tax-loss carryforward (opening NOL of Year 1) — so tax is never negative and
 * losses shelter the extra income exactly as they shelter the base case.
 */
export function computeIpo(a) {
  const ops = projectOperations(a);
  const ts = computeThreeStatement(a, ops);
  const p = a.ipo;
  const t = a.company.taxRate / 100;
  const S0 = a.company.sharesOut;
  const netDebt = a.company.grossDebt - a.company.cash;

  const ntm = { revenue: ops.revenue[0], ebitda: ops.ebitda[0], netIncome: ts.netIncome[0] };

  const fairEquityPre =
    p.basis === 'evEbitda' ? p.offerEvEbitda * ntm.ebitda - netDebt
      : p.basis === 'pe' ? p.offerPE * ntm.netIncome
        : NaN;
  const fairPricePre = fairEquityPre / S0;

  const offerEquityPre = fairEquityPre * (1 - p.ipoDiscount / 100);
  const offerPrice = offerEquityPre / S0;

  // share counts
  const primaryShares = offerPrice > 0 ? p.primaryRaise / offerPrice : NaN;
  const secondaryShares = S0 * (p.secondaryPct / 100);
  const baseDealShares = primaryShares + secondaryShares;
  const greenshoeShares = baseDealShares * (p.greenshoePct / 100) * (p.greenshoeExercisedPct / 100);
  const greenshoeType = p.greenshoeType === 'primary' || p.greenshoeType === 'secondary' ? p.greenshoeType : null;
  // a type is only needed when greenshoe shares are actually sold
  const gsKnown = greenshoeType !== null || greenshoeShares === 0;
  const gsPrimary = !gsKnown ? NaN : greenshoeType === 'primary' ? greenshoeShares : 0;
  const gsSecondary = !gsKnown ? NaN : greenshoeType === 'secondary' ? greenshoeShares : 0;
  const postShares = S0 + primaryShares + gsPrimary;

  // proceeds
  const greenshoeProceeds = greenshoeShares * offerPrice;
  const grossPrimary = (primaryShares + gsPrimary) * offerPrice;
  const grossSecondary = (secondaryShares + gsSecondary) * offerPrice; // to selling holders
  const fees = grossPrimary * (p.feesPct / 100);
  const netPrimary = grossPrimary - fees;
  const debtRepaid = Math.min(a.company.grossDebt, netPrimary * (p.useProceedsDebtPct / 100));
  const cashAdded = netPrimary - debtRepaid;

  // post-IPO balance sheet & Year-1 P&L effects
  const grossDebtPost = a.company.grossDebt - debtRepaid;
  const cashPost = a.company.cash + cashAdded;
  const netDebtPost = grossDebtPost - cashPost; // = netDebt - netPrimary
  const interestSaved = debtRepaid * (a.ts.interestRateDebt / 100);   // pre-tax
  const cashIncome = cashAdded * (a.ts.interestRateCash / 100);       // pre-tax
  const ebtPost = ts.ebt[0] + interestSaved + cashIncome;
  const taxPost = nolStep(ebtPost, t, ts.nolOpen[0]).tax;
  const niPost = ebtPost - taxPost;

  const epsPre = ntm.netIncome / S0;
  const epsPost = niPost / postShares;
  const epsDilution = (epsPost / epsPre - 1) * 100;

  // market cap & fair value uplift once the IPO discount unwinds
  const mktCapAtOffer = offerPrice * postShares;
  const fairEquityPost = fairEquityPre + netPrimary; // cash raised adds to fair value
  const fairPricePost = fairEquityPost / postShares;
  const uplift = (fairPricePost / offerPrice - 1) * 100;

  // ownership: every share sold in the offer is free float
  const soldShares = primaryShares + secondaryShares + greenshoeShares;
  const freeFloat = soldShares / postShares;
  const existingPost = (S0 - secondaryShares - gsSecondary) / postShares;

  // bookbuild range for the football field: low band -> fair value
  const rangeLow = offerPrice * (1 - p.rangeBand / 100);
  const rangeHigh = fairPricePost;

  return {
    ntm, netDebt, ts,
    fairEquityPre, fairPricePre, offerEquityPre, offerPrice,
    primaryShares, secondaryShares, baseDealShares,
    greenshoeShares, greenshoeType, greenshoeProceeds, gsPrimary, gsSecondary,
    postShares, soldShares,
    grossPrimary, grossSecondary, fees, netPrimary, debtRepaid, cashAdded,
    grossDebtPost, cashPost, netDebtPost,
    interestSaved, cashIncome, ebtPost, taxPost, niPost,
    epsPre, epsPost, epsDilution,
    mktCapAtOffer, fairEquityPost, fairPricePost, uplift,
    freeFloat, existingPost,
    rangeLow, rangeHigh,
  };
}

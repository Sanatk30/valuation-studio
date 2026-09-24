import { projectOperations } from './drivers.js';
import { computeThreeStatement } from './threeStatement.js';

/**
 * IPO valuation & dilution model.
 *
 * Pricing: fair pre-money equity value from the chosen basis (P/E x NTM net
 * income, or EV/EBITDA x NTM EBITDA less net debt). IPO investors are offered
 * a discount to fair value; the offer price = discounted pre-money / existing
 * shares.
 *
 * Deal structure: primary raise (fresh shares at the offer price), secondary
 * sale (existing holders, no company proceeds), greenshoe over-allotment
 * (assumed primary and exercised). Underwriting fees come out of gross
 * primary proceeds; net proceeds repay debt / build cash, which feeds the
 * post-IPO net debt, interest saving, and pro-forma EPS.
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
    p.basis === 'evEbitda'
      ? p.offerEvEbitda * ntm.ebitda - netDebt
      : p.offerPE * ntm.netIncome;
  const fairPricePre = fairEquityPre / S0;

  const offerEquityPre = fairEquityPre * (1 - p.ipoDiscount / 100);
  const offerPrice = offerEquityPre / S0;

  // share counts
  const primaryShares = offerPrice > 0 ? p.primaryRaise / offerPrice : NaN;
  const secondaryShares = S0 * (p.secondaryPct / 100);
  const baseDealShares = primaryShares + secondaryShares;
  const greenshoeShares = baseDealShares * (p.greenshoePct / 100); // assumed primary
  const postShares = S0 + primaryShares + greenshoeShares;

  // proceeds
  const grossPrimary = (primaryShares + greenshoeShares) * offerPrice;
  const grossSecondary = secondaryShares * offerPrice; // to selling holders
  const fees = grossPrimary * (p.feesPct / 100);
  const netPrimary = grossPrimary - fees;
  const debtRepaid = Math.min(a.company.grossDebt, netPrimary * (p.useProceedsDebtPct / 100));
  const cashAdded = netPrimary - debtRepaid;

  // post-IPO balance sheet & P&L effects
  const grossDebtPost = a.company.grossDebt - debtRepaid;
  const cashPost = a.company.cash + cashAdded;
  const netDebtPost = grossDebtPost - cashPost; // = netDebt - netPrimary
  const interestSaved = debtRepaid * (a.ts.interestRateDebt / 100) * (1 - t);
  const cashIncome = cashAdded * (a.ts.interestRateCash / 100) * (1 - t);
  const niPost = ntm.netIncome + interestSaved + cashIncome;

  const epsPre = ntm.netIncome / S0;
  const epsPost = niPost / postShares;
  const epsDilution = (epsPost / epsPre - 1) * 100;

  // market cap & fair value uplift once the IPO discount unwinds
  const mktCapAtOffer = offerPrice * postShares;
  const fairEquityPost = fairEquityPre + netPrimary; // cash raised adds to fair value
  const fairPricePost = fairEquityPost / postShares;
  const uplift = (fairPricePost / offerPrice - 1) * 100;

  // ownership
  const freeFloat = (primaryShares + greenshoeShares + secondaryShares) / postShares;
  const existingPost = (S0 - secondaryShares) / postShares;

  // bookbuild range for the football field: low band -> fair value
  const rangeLow = offerPrice * (1 - p.rangeBand / 100);
  const rangeHigh = fairPricePost;

  return {
    ntm, netDebt,
    fairEquityPre, fairPricePre, offerEquityPre, offerPrice,
    primaryShares, secondaryShares, baseDealShares, greenshoeShares, postShares,
    grossPrimary, grossSecondary, fees, netPrimary, debtRepaid, cashAdded,
    grossDebtPost, cashPost, netDebtPost, interestSaved, cashIncome, niPost,
    epsPre, epsPost, epsDilution,
    mktCapAtOffer, fairEquityPost, fairPricePost, uplift,
    freeFloat, existingPost,
    rangeLow, rangeHigh,
  };
}

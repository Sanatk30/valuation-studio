/**
 * Per-deal input page for precedent transactions, in the style of the
 * Rosenbaum & Pearl (Investment Banking, 3E) transaction "Input Page".
 *
 * A deal page is the comparable-company input page (compsCo.js) with the
 * target's reported financials, priced at the OFFER rather than at the market:
 *
 *   offer price per share = cash offer + exchange ratio × acquirer share price
 *   implied equity value  = offer price × fully diluted shares (treasury method)
 *   implied enterprise value = equity value + debt + preferred + NCI − cash
 *   transaction multiples = that enterprise value over the target's LTM metrics
 *
 * Reusing computeCompany() means the LTM stub bridge, the non-recurring
 * adjustments and their tax effect, the treasury-stock share count and the EV
 * bridge are all the same verified code the comps pages run on — a deal page
 * and a peer page can never disagree about how LTM EBITDA is built.
 *
 * On top of that sit the deal-specific blocks: the offer-price build, premiums
 * paid against the unaffected share price at 1 / 7 / 30 days, and the deal
 * identity (acquirer, target, dates, transaction type, consideration).
 */
import { blankCompany, computeCompany, nextId, sd, P } from './compsCo.js';

/** Premium look-back windows the 3E output page reports, in days. */
export const PREMIUM_DAYS = [1, 7, 30];

export const TRANSACTION_TYPES = [
  'Public / Public', 'Public / Private', 'Sponsor / Public', 'Sponsor / Private',
  'Private / Private', 'Public / Divestiture',
];
export const CONSIDERATION_TYPES = ['Cash', 'Stock', 'Cash / Stock'];

/** An empty precedent transaction. */
export function blankDeal(over = {}) {
  return {
    id: nextId('deal'),
    // identity
    acquirer: 'New Acquirer',
    acquirerTicker: '',
    acquirerFyEnd: '2025-12-31',
    acquirerPrice: 0,
    dateAnnounced: '2025-06-30',
    dateEffective: 'Pending',
    transactionType: 'Public / Public',
    consideration: 'Cash',
    targetDescription: '',
    acquirerDescription: '',
    comments: '',
    // offer terms
    cashOffer: 0,          // cash per target share
    exchangeRatio: 0,      // acquirer shares per target share
    // unaffected target share price, by look-back window
    unaffected: { 1: 0, 7: 0, 30: 0 },
    // the target's reported financials — the same shape as a comps input page
    target: blankCompany({ name: 'New Target' }),
    ...over,
  };
}

/** Offer price per share = cash consideration + the stock leg at the acquirer's price. */
export const offerPricePerShare = (deal) => {
  const cash = Number(deal?.cashOffer) || 0;
  const stock = (Number(deal?.exchangeRatio) || 0) * (Number(deal?.acquirerPrice) || 0);
  return cash + stock;
};

/**
 * Compute a full deal page.
 * The target's financials are run through the comps engine at the OFFER price,
 * so `page.equityValue` is the implied equity value of the transaction and
 * every multiple is a transaction multiple.
 */
export function computeDeal(deal) {
  const offerPrice = offerPricePerShare(deal);
  const stockOffer = (Number(deal?.exchangeRatio) || 0) * (Number(deal?.acquirerPrice) || 0);
  // price the target's page at the offer — everything downstream follows
  const page = computeCompany({ ...deal.target, price: offerPrice });

  const premiums = {};
  for (const d of PREMIUM_DAYS) {
    const px = Number(deal?.unaffected?.[d]);
    premiums[d] = px > 0 ? offerPrice / px - 1 : NaN;
  }

  return {
    deal, page,
    offerPrice,
    cashOffer: Number(deal?.cashOffer) || 0,
    stockOffer,
    equityValue: page.equityValue,
    enterpriseValue: page.enterpriseValue,
    // transaction multiples, straight off the shared page
    evSales: page.multiples.evSales.values[0],
    evEbitda: page.multiples.evEbitda.values[0],
    evEbit: page.multiples.evEbit.values[0],
    pe: page.multiples.pe.values[0],
    ltmSales: page.is.sales[P.LTM],
    ltmEbitda: page.adjEbitda[P.LTM],
    ltmEbit: page.adjEbit[P.LTM],
    ltmNetIncome: page.adjNetIncome[P.LTM],
    ebitdaMargin: page.ebitdaMargin[P.LTM],
    premiums,
    year: Number(String(deal?.dateAnnounced || '').slice(0, 4)) || NaN,
  };
}

/**
 * Data-quality issues on a deal page, for the input-page badge.
 * Only reports things that actually break a downstream number.
 */
export function validateDeal(d) {
  const issues = [];
  if (!(d.offerPrice > 0)) issues.push({ level: 'error', field: 'offer', msg: 'No offer price — equity value and every transaction multiple are NA' });
  if (!(d.page.shares.fullyDiluted > 0)) issues.push({ level: 'error', field: 'shares', msg: 'No share count — implied equity value is NA' });
  if (!(d.ltmSales > 0)) issues.push({ level: 'error', field: 'is', msg: 'No LTM sales — EV/Sales and the margins are NA' });
  if (!(d.ltmEbitda > 0)) issues.push({ level: 'warn', field: 'is', msg: 'No LTM EBITDA — EV/EBITDA is NM' });
  const bal = d.page.bs.check;
  const scale = Math.max(1, Math.abs(d.page.bs.totalAssets[1]));
  if (Math.abs(bal[1]) > scale * 1e-6) issues.push({ level: 'warn', field: 'bs', msg: `Balance sheet is out by ${bal[1].toFixed(1)} — the EV bridge reads debt, preferred, NCI and cash off it` });
  const missing = PREMIUM_DAYS.filter((k) => !(Number(d.deal?.unaffected?.[k]) > 0));
  if (missing.length === PREMIUM_DAYS.length) issues.push({ level: 'warn', field: 'premium', msg: 'No unaffected share prices — every premiums-paid column is NA' });
  else if (missing.length) issues.push({ level: 'info', field: 'premium', msg: `No unaffected price ${missing.join(', ')} day(s) prior — those columns read NA` });
  if (!d.deal.targetDescription) issues.push({ level: 'info', field: 'desc', msg: 'No target business description — the List page will read [to come]' });
  return issues;
}

/**
 * Migrate a legacy typed-multiple deal ({ name, year, evSales, evEbitda, premium })
 * onto the bottom-up shape. What maps, maps; the rest starts blank and the page
 * badge says what is still needed. The original rows are kept on `legacyDeals`.
 *
 * The old set carried multiples, not financials, so the metrics are back-solved
 * from an assumed LTM sales of 1,000 units: that reproduces the SAME multiples
 * (which is what the valuation actually used) while giving the page a coherent
 * income statement to show. The badge flags it as reconstructed.
 */
export function migrateLegacyDeal(row) {
  const evSales = Number(row?.evSales);
  const evEbitda = Number(row?.evEbitda);
  const sales = 1000;
  const ev = isFinite(evSales) && evSales > 0 ? evSales * sales : NaN;
  const ebitda = isFinite(ev) && isFinite(evEbitda) && evEbitda > 0 ? ev / evEbitda : NaN;
  const parts = String(row?.name || 'Legacy transaction').split('/');
  const acquirer = (parts[0] || 'Acquirer').trim();
  const target = (parts[1] || parts[0] || 'Target').trim();
  const year = Number(row?.year) || new Date().getFullYear();

  const shares = 100;
  const offer = isFinite(ev) ? ev / shares : 0;   // no debt/cash known: EV == equity value
  // FY0 only, both stubs zero — the LTM bridge (FY0 + current stub − prior stub)
  // then lands exactly on FY0, so the reconstructed multiples equal the originals
  const five = (v) => [0, 0, isFinite(v) ? v : 0, 0, 0];
  const co = blankCompany({
    name: target,
    fyEnd: `${year - 1}-12-31`,
    stubEnd: `${year}-06-30`,
    basicShares: shares,
    grossKnown: false,
    is: {
      sales: five(sales),
      // no COGS/SG&A split is recoverable, so all operating cost sits in COGS
      cogs: five(isFinite(ebitda) ? sales - ebitda : sales),
      sga: [0, 0, 0, 0, 0], otherExp: [0, 0, 0, 0, 0],
      interest: [0, 0, 0, 0, 0], taxes: [0, 0, 0, 0, 0],
      nci: [0, 0, 0, 0, 0], prefDiv: [0, 0, 0, 0, 0],
      dilutedShares: five(shares),
    },
  });

  return blankDeal({
    acquirer,
    dateAnnounced: `${year}-06-30`,
    cashOffer: offer,
    unaffected: {
      1: isFinite(Number(row?.premium)) && offer > 0 ? offer / (1 + Number(row.premium) / 100) : 0,
      7: 0, 30: 0,
    },
    target: co,
    _reconstructed: true,
  });
}

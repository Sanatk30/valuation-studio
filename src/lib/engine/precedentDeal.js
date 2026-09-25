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
import { blankCompany, computeCompany, nextId, P } from './compsCo.js';

/** Premium look-back windows the 3E output page reports, in days. */
export const PREMIUM_DAYS = [1, 7, 30];

export const TRANSACTION_TYPES = [
  'Public / Public', 'Public / Private', 'Sponsor / Public', 'Sponsor / Private',
  'Private / Private', 'Public / Divestiture',
];
export const CONSIDERATION_TYPES = ['Cash', 'Stock', 'Cash / Stock'];

/** A blank / non-numeric input → NaN (NA); never lets null read as 0. */
const val = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : NaN;
};

/** An empty precedent transaction — fully blank: nothing typed, nothing assumed. */
export function blankDeal(over = {}) {
  return {
    id: nextId('deal'),
    // identity
    acquirer: '',
    acquirerTicker: '',
    dateAnnounced: '',
    dateEffective: '',
    transactionType: '',
    consideration: '',     // 'Cash' | 'Stock' | 'Cash / Stock' — decides which offer legs apply
    targetDescription: '',
    acquirerDescription: '',
    comments: '',
    // offer terms
    cashOffer: null,       // cash per target share
    exchangeRatio: null,   // acquirer shares per target share
    acquirerPrice: null,   // acquirer share price (for the stock leg)
    // unaffected target share price, by look-back window
    unaffected: { 1: null, 7: null, 30: null },
    // the target's reported financials — the same shape as a comps input page
    target: blankCompany(),
    ...over,
  };
}

/** Which offer legs a consideration type carries. Unchosen → none known (NA). */
export function offerLegs(consideration) {
  if (consideration === 'Cash') return { cash: true, stock: false };
  if (consideration === 'Stock') return { cash: false, stock: true };
  if (consideration === 'Cash / Stock') return { cash: true, stock: true };
  return null;
}

/** Stock leg per target share = exchange ratio × acquirer share price (NA if either is blank). */
export const stockOfferPerShare = (deal) => val(deal?.exchangeRatio) * val(deal?.acquirerPrice);

/**
 * Offer price per share = cash consideration + the stock leg at the acquirer's
 * price. The purchase consideration says which legs exist: a leg the deal does
 * not have is 0; a leg it has must be filled, or the offer price is NA.
 */
export const offerPricePerShare = (deal) => {
  const legs = offerLegs(deal?.consideration);
  if (!legs) return NaN;
  const cash = legs.cash ? val(deal?.cashOffer) : 0;
  const stock = legs.stock ? stockOfferPerShare(deal) : 0;
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
  const legs = offerLegs(deal?.consideration);
  const stockOffer = !legs ? NaN : legs.stock ? stockOfferPerShare(deal) : 0;
  const cashOffer = !legs ? NaN : legs.cash ? val(deal?.cashOffer) : 0;
  // price the target's page at the offer — everything downstream follows
  const page = computeCompany({ ...deal.target, price: offerPrice });

  const premiums = {};
  for (const d of PREMIUM_DAYS) {
    const px = val(deal?.unaffected?.[d]);
    premiums[d] = px > 0 ? offerPrice / px - 1 : NaN;
  }

  return {
    deal, page,
    offerPrice,
    cashOffer,
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
  if (!offerLegs(d.deal?.consideration)) issues.push({ level: 'error', field: 'offer', msg: 'Choose the purchase consideration (cash, stock or both) — it decides which offer terms apply' });
  else if (!(d.offerPrice > 0)) issues.push({ level: 'error', field: 'offer', msg: 'No offer price — fill the offer terms; equity value and every transaction multiple are NA' });
  if (!(d.page.shares.fullyDiluted > 0)) issues.push({ level: 'error', field: 'shares', msg: 'No share count — implied equity value is NA' });
  if (!(d.ltmSales > 0)) issues.push({ level: 'error', field: 'is', msg: 'No LTM sales — EV/Sales and the margins are NA' });
  if (!Number.isFinite(d.page.bs.debt[1]) || !Number.isFinite(d.page.bs.cash[1])) issues.push({ level: 'error', field: 'bs', msg: 'No current debt or cash — the implied enterprise value is NA' });
  if (!Number.isFinite(d.ltmEbitda)) issues.push({ level: 'warn', field: 'is', msg: 'LTM EBITDA is NA — EV/EBITDA is NA' });
  else if (!(d.ltmEbitda > 0)) issues.push({ level: 'warn', field: 'is', msg: 'LTM EBITDA is not positive — EV/EBITDA is NM' });
  const bal = d.page.bs.check;
  const scale = Math.max(1, Math.abs(Number.isFinite(d.page.bs.totalAssets[1]) ? d.page.bs.totalAssets[1] : 0));
  if (Number.isFinite(bal[1]) && Math.abs(bal[1]) > scale * 1e-6) issues.push({ level: 'warn', field: 'bs', msg: `Balance sheet is out by ${bal[1].toFixed(1)} — the EV bridge reads debt, preferred, NCI and cash off it` });
  const missing = PREMIUM_DAYS.filter((k) => !(val(d.deal?.unaffected?.[k]) > 0));
  if (missing.length === PREMIUM_DAYS.length) issues.push({ level: 'warn', field: 'premium', msg: 'No unaffected share prices — every premiums-paid column is NA' });
  else if (missing.length) issues.push({ level: 'info', field: 'premium', msg: `No unaffected price ${missing.join(', ')} day(s) prior — those columns read NA` });
  if (!d.deal.targetDescription) issues.push({ level: 'info', field: 'desc', msg: 'No target business description — the List page will read [to come]' });
  return issues;
}

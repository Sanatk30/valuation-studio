/**
 * Search hints for the peer finder, by Yahoo industry.
 *
 * Yahoo's "people also watch" lists follow popularity, not industry: from NIKE
 * they lead to Starbucks and Visa, never to adidas or Deckers, and a word
 * search only finds companies whose NAME carries the industry word
 * ("… Footwears Ltd"). So for the larger industries the finder also starts
 * from a few well-known listings of that industry ("anchors").
 *
 * Anchors are hints, never answers: each one is profiled like any other name
 * and counts as a same-industry peer only when Yahoo itself classifies it in
 * the target's industry; a ticker that has changed simply drops out. Their own
 * co-watched lists then seed the industry crawl.
 *
 * RELATED_INDUSTRIES pairs industries whose companies compete or are valued
 * alike (Consumer Electronics ↔ Computer Hardware, the two bank types …).
 * Candidates there are ranked in their own group, after the same industry and
 * before the rest of the sector.
 */

export const INDUSTRY_ANCHORS = {
  'Footwear & Accessories': ['NKE', 'ADS.DE', 'PUM.DE', 'DECK', 'ONON', 'CROX', '7936.T', 'BIRK', 'BATAINDIA.NS', 'RELAXO.NS'],
  'Apparel Manufacturing': ['VFC', 'PVH', 'RL', 'UAA', 'LEVI', 'COLM', 'GIL', 'MONC.MI', 'PAGEIND.NS'],
  'Apparel Retail': ['TJX', 'ROST', 'ANF', 'GAP', 'URBN', 'AEO', 'LULU', 'ITX.MC', 'TRENT.NS', 'METROBRAND.NS'],
  'Luxury Goods': ['MC.PA', 'RMS.PA', 'KER.PA', 'CFR.SW', 'TPR', 'CPRI', 'TITAN.NS'],
  'Consumer Electronics': ['AAPL', 'SONY', '005930.KS', '1810.HK', '066570.KS', '6752.T', 'SONO', 'GPRO'],
  'Computer Hardware': ['DELL', 'HPQ', 'LOGI', '0992.HK', 'SMCI', 'ANET'],
  Semiconductors: ['NVDA', 'AMD', 'INTC', 'AVGO', 'QCOM', 'TXN', 'MU', 'ADI', 'NXPI', 'TSM', 'IFX.DE', 'STM'],
  'Semiconductor Equipment & Materials': ['ASML', 'AMAT', 'LRCX', 'KLAC', '8035.T', 'TER'],
  'Software—Infrastructure': ['MSFT', 'ORCL', 'PANW', 'CRWD', 'FTNT', 'NET', 'ZS', 'SNPS', 'MDB'],
  'Software—Application': ['CRM', 'SAP', 'INTU', 'NOW', 'WDAY', 'ADSK', 'DDOG', 'TEAM'],
  'Information Technology Services': ['ACN', 'IBM', 'CTSH', 'INFY', 'WIT', 'EPAM', 'CAP.PA', 'TCS.NS', 'INFY.NS', 'HCLTECH.NS', 'WIPRO.NS', 'TECHM.NS'],
  'Internet Content & Information': ['GOOGL', 'META', 'BIDU', 'PINS', 'SNAP', 'RDDT', 'NAUKRI.NS'],
  'Internet Retail': ['AMZN', 'BABA', 'PDD', 'JD', 'MELI', 'EBAY', 'CPNG', 'ETSY', 'NYKAA.NS'],
  'Auto Manufacturers': ['TSLA', 'TM', 'GM', 'F', 'STLA', 'HMC', 'BMW.DE', 'MBG.DE', 'VOW3.DE', '1211.HK', 'MARUTI.NS', 'M&M.NS', 'RIVN', 'RACE'],
  'Auto Parts': ['APTV', 'BWA', 'LEA', 'MGA', 'CON.DE', '6902.T', 'BOSCHLTD.NS', 'MOTHERSON.NS'],
  'Banks—Diversified': ['JPM', 'BAC', 'C', 'WFC', 'HSBA.L', '8306.T', 'RY', 'TD'],
  'Banks—Regional': ['HDFCBANK.NS', 'ICICIBANK.NS', 'KOTAKBANK.NS', 'AXISBANK.NS', 'SBIN.NS', 'INDUSINDBK.NS', 'USB', 'PNC', 'TFC'],
  'Drug Manufacturers—General': ['LLY', 'JNJ', 'PFE', 'MRK', 'ABBV', 'NVS', 'AZN', 'GSK', 'SNY', 'BMY', 'NVO'],
  'Drug Manufacturers—Specialty & Generic': ['SUNPHARMA.NS', 'DRREDDY.NS', 'CIPLA.NS', 'LUPIN.NS', 'ZYDUSLIFE.NS', 'AUROPHARMA.NS', 'TEVA', 'VTRS'],
  // Yahoo spells this one with a long dash in 'Non—Alcoholic'
  'Beverages—Non—Alcoholic': ['KO', 'PEP', 'KDP', 'MNST', 'CELH', 'VBL.NS'],
  'Beverages—Brewers': ['BUD', 'HEIA.AS', 'TAP', 'STZ', 'CARL-B.CO', 'ABEV', 'UBL.NS'],
  'Beverages—Wineries & Distilleries': ['DEO', 'RI.PA', 'BF-B', 'UNITDSPR.NS', 'RADICO.NS'],
  'Packaged Foods': ['NESN.SW', 'GIS', 'KHC', 'BN.PA', 'NESTLEIND.NS', 'BRITANNIA.NS', 'TATACONSUM.NS'],
  'Household & Personal Products': ['PG', 'UL', 'CL', 'EL', 'KMB', 'CHD', 'OR.PA', 'HINDUNILVR.NS', 'DABUR.NS', 'GODREJCP.NS', 'COLPAL.NS', 'MARICO.NS'],
  'Specialty Chemicals': ['SHW', 'PPG', 'ECL', 'AKZA.AS', 'ASIANPAINT.NS', 'BERGEPAINT.NS', 'PIDILITIND.NS'],
  'Oil & Gas Integrated': ['XOM', 'CVX', 'SHEL', 'BP', 'TTE', 'PBR', 'EQNR', 'ENI.MI', 'ONGC.NS'],
  'Oil & Gas Refining & Marketing': ['MPC', 'VLO', 'PSX', 'RELIANCE.NS', 'IOC.NS', 'BPCL.NS', 'HINDPETRO.NS'],
  'Telecom Services': ['T', 'VZ', 'TMUS', 'VOD.L', 'DTE.DE', 'BHARTIARTL.NS', 'IDEA.NS'],
  Steel: ['NUE', 'STLD', 'MT', 'CLF', 'PKX', '5401.T', 'TATASTEEL.NS', 'JSWSTEEL.NS', 'SAIL.NS'],
  'Building Materials': ['CRH', 'VMC', 'MLM', 'HOLN.SW', 'HEI.DE', 'ULTRACEMCO.NS', 'SHREECEM.NS', 'AMBUJACEM.NS', 'ACC.NS'],
  Restaurants: ['MCD', 'SBUX', 'CMG', 'YUM', 'QSR', 'DRI', 'JUBLFOOD.NS', 'DEVYANI.NS'],
  'Discount Stores': ['WMT', 'COST', 'TGT', 'DG', 'DLTR', 'DMART.NS'],
  'Aerospace & Defense': ['BA', 'AIR.PA', 'LMT', 'RTX', 'GD', 'NOC', 'SAF.PA', 'HAL.NS', 'BEL.NS'],
  'Insurance—Life': ['MET', 'PRU', '1299.HK', 'LICI.NS', 'HDFCLIFE.NS', 'SBILIFE.NS'],
  'Credit Services': ['V', 'MA', 'AXP', 'COF', 'PYPL', 'BAJFINANCE.NS'],
  'Utilities—Regulated Electric': ['NEE', 'DUK', 'SO', 'AEP', 'POWERGRID.NS'],
  Entertainment: ['NFLX', 'DIS', 'PVRINOX.NS'],
  Airlines: ['DAL', 'UAL', 'AAL', 'LUV', 'RYAAY', 'LHA.DE', 'INDIGO.NS'],
};

const PAIRS = [
  ['Consumer Electronics', 'Computer Hardware'],
  ['Footwear & Accessories', 'Apparel Manufacturing'], ['Footwear & Accessories', 'Luxury Goods'],
  ['Apparel Manufacturing', 'Apparel Retail'], ['Apparel Manufacturing', 'Luxury Goods'],
  ['Banks—Regional', 'Banks—Diversified'],
  ['Drug Manufacturers—General', 'Drug Manufacturers—Specialty & Generic'], ['Drug Manufacturers—General', 'Biotechnology'],
  ['Software—Application', 'Software—Infrastructure'],
  ['Semiconductors', 'Semiconductor Equipment & Materials'],
  ['Oil & Gas Integrated', 'Oil & Gas E&P'], ['Oil & Gas Integrated', 'Oil & Gas Refining & Marketing'],
  ['Insurance—Life', 'Insurance—Diversified'], ['Insurance—Property & Casualty', 'Insurance—Diversified'],
  ['Specialty Chemicals', 'Chemicals'],
  ['Beverages—Brewers', 'Beverages—Wineries & Distilleries'], ['Beverages—Non—Alcoholic', 'Packaged Foods'],
  ['Packaged Foods', 'Confectioners'], ['Packaged Foods', 'Household & Personal Products'],
  ['Utilities—Regulated Electric', 'Utilities—Independent Power Producers'], ['Utilities—Regulated Electric', 'Utilities—Diversified'],
  ['Utilities—Renewable', 'Utilities—Independent Power Producers'],
  ['Discount Stores', 'Department Stores'], ['Discount Stores', 'Grocery Stores'],
  ['Internet Retail', 'Specialty Retail'],
  ['Steel', 'Other Industrial Metals & Mining'], ['Aluminum', 'Other Industrial Metals & Mining'],
  ['Auto Manufacturers', 'Recreational Vehicles'],
  ['Asset Management', 'Capital Markets'],
  ['Real Estate—Development', 'Real Estate—Diversified'],
];

const norm = (s) => String(s || '').trim().toUpperCase();
const related = new Map();
for (const [a, b] of PAIRS) {
  for (const [x, y] of [[a, b], [b, a]]) {
    if (!related.has(norm(x))) related.set(norm(x), new Set());
    related.get(norm(x)).add(norm(y));
  }
}

/** Are two Yahoo industries closely related (not the same)? */
export const relatedIndustry = (a, b) => !!(a && b && related.get(norm(a))?.has(norm(b)));

/** The related industries of one industry (their Yahoo names). */
export const relatedIndustries = (industry) => PAIRS.flatMap(([a, b]) => (norm(a) === norm(industry) ? [b] : norm(b) === norm(industry) ? [a] : []));

/** Anchor tickers for an industry (exact Yahoo name, case aside). */
export const anchorsOf = (industry) => {
  const k = Object.keys(INDUSTRY_ANCHORS).find((x) => norm(x) === norm(industry));
  return k ? INDUSTRY_ANCHORS[k] : [];
};

/**
 * Sample / synthetic comparable-company input pages.
 *
 * Peers are described by a compact economic spec and expanded into full 3E
 * input pages. Expansion is deterministic and internally consistent:
 *   - the income statement ties to the chosen gross / EBIT margins
 *   - D&A sits inside COGS (as the template's "COGS (incl. D&A)" line) and is
 *     added back from the cash-flow statement to reach EBITDA
 *   - shareholders' equity is the balancing figure, so the balance check is 0
 *
 * Test fixture only — the app itself ships no sample data.
 */
import { blankCompany } from '../../src/lib/engine/compsCo.js';

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * Expand one spec into a company page.
 *
 * @param {object} s
 *   salesFY0      FY0 revenue (money units)
 *   histGrowth    y/y revenue growth applied backwards to FY-1 / FY-2
 *   estGrowth     y/y revenue growth applied to the current stub
 *   grossMargin   gross margin % (D&A already inside COGS)
 *   ebitMargin    reported EBIT margin %
 *   daPct         D&A as % of revenue (cash-flow statement)
 *   capexPct      capex as % of revenue
 *   debtEbitda    total debt as a multiple of LTM EBITDA
 *   cashPctSales  cash as % of revenue
 *   interestRate  % on total debt
 *   taxRate       marginal tax rate %
 *   price         share price
 *   basicShares   basic shares outstanding (same unit scale as money)
 */
export function expandPeer(s) {
  const g = 1 + s.histGrowth / 100;
  const ge = 1 + s.estGrowth / 100;
  const stub = 0.5;                       // half-year stub periods

  // --- revenue across the five input periods -------------------------------
  const salesFY = [s.salesFY0 / g ** 2, s.salesFY0 / g, s.salesFY0];
  const priorStub = s.salesFY0 * stub;
  const curStub = s.salesFY0 * stub * ge;
  const sales = [...salesFY, priorStub, curStub].map(r2);

  // --- income statement ----------------------------------------------------
  const gm = s.grossMargin / 100;
  const em = s.ebitMargin / 100;
  const cogs = sales.map((v) => r2(v * (1 - gm)));
  const sga = sales.map((v) => r2(v * (gm - em)));
  const otherExp = sales.map(() => 0);

  const ltm = (a) => a[2] + a[4] - a[3];
  const ltmSales = ltm(sales);
  const daRate = s.daPct / 100;
  const ltmEbitda = ltmSales * (em + daRate);
  const debt = r2(ltmEbitda * s.debtEbitda);
  const cash = r2(ltmSales * (s.cashPctSales / 100));

  // interest charged on total debt, split pro-rata across stub periods
  const yearFrac = [1, 1, 1, stub, stub];
  const interest = yearFrac.map((f) => r2(debt * (s.interestRate / 100) * f));

  const ebit = sales.map((v, i) => v - cogs[i] - sga[i] - otherExp[i]);
  const pretax = ebit.map((v, i) => v - interest[i]);
  const taxes = pretax.map((v) => r2(Math.max(0, v) * (s.taxRate / 100)));
  const nci = sales.map(() => 0);
  const prefDiv = sales.map(() => 0);

  const shares = [s.basicShares * 0.985, s.basicShares * 0.992, s.basicShares, s.basicShares * 0.992, s.basicShares]
    .map(r4);

  // --- non-recurring items (FY0 and the current stub only) -----------------
  const nr = (full, stubV) => [0, 0, full, 0, stubV];
  const adj = {
    nrCogs: nr(s.nrCogs ?? 0, (s.nrCogs ?? 0) * 0.4),
    nrOther: nr(s.nrOther ?? 0, (s.nrOther ?? 0) * 0.4),
    nrNonOp: nr(s.nrNonOp ?? 0, 0),
  };

  // --- cash flow -----------------------------------------------------------
  const da = sales.map((v) => r2(v * daRate));
  const capex = sales.map((v) => r2(v * (s.capexPct / 100)));
  // CFO = net income + D&A less a working-capital build scaled to growth
  const netIncome = pretax.map((v, i) => v - taxes[i] - nci[i] - prefDiv[i]);
  const cfo = netIncome.map((v, i) => r2(v + da[i] - sales[i] * 0.012));

  // --- balance sheet: equity is the plug so the check ties -----------------
  const bsSales = [salesFY[1], ltmSales];          // prior column / current column
  const bsDebt = [r2(debt * 1.06), debt];
  const bsCash = [r2(cash * 0.92), cash];
  const asset = (pct, i) => r2(bsSales[i] * pct);
  const two = (fn) => [fn(0), fn(1)];

  const bs = {
    cash: bsCash,
    ar: two((i) => asset(0.172, i)),
    inventory: two((i) => asset(0.148, i)),
    prepaid: two((i) => asset(0.026, i)),
    ppe: two((i) => asset(0.545, i)),
    goodwill: two((i) => asset(0.208, i)),
    otherAssets: two((i) => asset(0.047, i)),
    ap: two((i) => asset(0.118, i)),
    accrued: two((i) => asset(0.052, i)),
    otherCurLiab: two((i) => asset(0.021, i)),
    debt: bsDebt,
    otherLTLiab: two((i) => asset(0.063, i)),
    nci: [0, 0],
    preferred: [0, 0],
    equity: [0, 0],
  };
  for (const i of [0, 1]) {
    const assets = bs.cash[i] + bs.ar[i] + bs.inventory[i] + bs.prepaid[i] + bs.ppe[i] + bs.goodwill[i] + bs.otherAssets[i];
    const liabs = bs.ap[i] + bs.accrued[i] + bs.otherCurLiab[i] + bs.debt[i] + bs.otherLTLiab[i];
    bs.equity[i] = r2(assets - liabs - bs.nci[i] - bs.preferred[i]);
  }

  return blankCompany({
    id: s.id,
    name: s.name,
    ticker: s.ticker,
    exchange: s.exchange || 'NSE',
    tierId: s.tierId,
    description: s.description,
    fyEnd: s.fyEnd || '2025-03-31',
    stubEnd: s.stubEnd || '2025-09-30',
    moodys: s.moodys || 'NA',
    sp: s.sp || 'NA',
    beta: s.beta,
    taxRate: s.taxRate,
    price: s.price,
    high52: r2(s.price * (s.high52x ?? 1.24)),
    low52: r2(s.price * (s.low52x ?? 0.71)),
    dpsMRQ: s.dpsMRQ ?? 0,
    is: { sales, cogs, sga, otherExp, interest, taxes, nci, prefDiv, dilutedShares: shares },
    adj,
    cf: { cfo, capex, da },
    bs,
    basicShares: s.basicShares,
    options: s.options || [],
    converts: s.converts || [],
  });
}

export const SAMPLE_TIERS = [
  { id: 't1', name: 'Tier I: Specialty Chemicals' },
  { id: 't2', name: 'Tier II: Commodity / Diversified Chemicals' },
  { id: 't3', name: 'Tier III: Small-Cap Chemicals' },
];

const SPECS = [
  {
    id: 'p1', tierId: 't1', name: 'Meridian Specialty', ticker: 'MRDS',
    description: 'Performance additives, coating resins and electronic-grade chemicals for industrial end markets',
    salesFY0: 6842.4, histGrowth: 11.6, estGrowth: 10.4, grossMargin: 34.2, ebitMargin: 16.8,
    daPct: 5.1, capexPct: 6.4, debtEbitda: 1.42, cashPctSales: 8.6, interestRate: 8.4,
    taxRate: 25.2, price: 1284.5, basicShares: 9.42, beta: 1.06,
    moodys: 'Baa1', sp: 'BBB+', dpsMRQ: 4.25,
    nrCogs: 18.4, nrOther: 11.2, nrNonOp: -6.5,
    options: [{ shares: 0.128, strike: 742.0 }, { shares: 0.094, strike: 1105.5 }, { shares: 0.061, strike: 1420.0 }],
    converts: [{ amount: 185.0, price: 1024.0 }],
  },
  {
    id: 'p2', tierId: 't1', name: 'Alderforth Chemicals', ticker: 'ALDF',
    description: 'Specialty intermediates and custom synthesis for agrochemical and pharmaceutical customers',
    salesFY0: 4915.7, histGrowth: 13.8, estGrowth: 12.1, grossMargin: 36.8, ebitMargin: 18.4,
    daPct: 5.6, capexPct: 7.2, debtEbitda: 1.05, cashPctSales: 11.4, interestRate: 8.1,
    taxRate: 25.2, price: 2146.8, basicShares: 4.18, beta: 0.94,
    moodys: 'A3', sp: 'A-', dpsMRQ: 6.5,
    nrCogs: 9.7, nrOther: -14.3, nrNonOp: 0,
    options: [{ shares: 0.052, strike: 1310.0 }, { shares: 0.038, strike: 1985.0 }],
    converts: [],
  },
  {
    id: 'p3', tierId: 't1', name: 'Castleton Advanced Materials', ticker: 'CASTM',
    description: 'Engineered polymers, adhesives and high-purity solvents supplied to electronics and auto OEMs',
    salesFY0: 8226.9, histGrowth: 9.4, estGrowth: 8.8, grossMargin: 31.5, ebitMargin: 15.2,
    daPct: 4.8, capexPct: 5.9, debtEbitda: 1.88, cashPctSales: 6.2, interestRate: 8.9,
    taxRate: 25.2, price: 964.2, basicShares: 14.85, beta: 1.14,
    moodys: 'Baa2', sp: 'BBB', dpsMRQ: 3.1,
    nrCogs: 24.6, nrOther: 8.9, nrNonOp: 12.4,
    options: [{ shares: 0.215, strike: 605.0 }, { shares: 0.140, strike: 880.0 }, { shares: 0.088, strike: 1160.0 }],
    converts: [{ amount: 240.0, price: 812.5 }],
  },
  {
    id: 'p4', tierId: 't2', name: 'Brightwater Industries', ticker: 'BRWI',
    description: 'Commodity chlor-alkali, caustic soda and industrial gases with integrated logistics',
    salesFY0: 15840.2, histGrowth: 5.2, estGrowth: 4.6, grossMargin: 24.6, ebitMargin: 10.4,
    daPct: 6.2, capexPct: 7.8, debtEbitda: 2.64, cashPctSales: 4.8, interestRate: 9.2,
    taxRate: 25.2, price: 612.4, basicShares: 32.6, beta: 1.28,
    moodys: 'Baa3', sp: 'BBB-', dpsMRQ: 2.4,
    nrCogs: 46.2, nrOther: 31.8, nrNonOp: -18.6,
    options: [{ shares: 0.412, strike: 388.0 }, { shares: 0.266, strike: 560.0 }],
    converts: [{ amount: 520.0, price: 545.0 }],
  },
  {
    id: 'p5', tierId: 't2', name: 'Hollandale Polymers', ticker: 'HLPL',
    description: 'Vinyls, polymer resins and fabricated plastic products for construction and packaging',
    salesFY0: 11268.5, histGrowth: 6.8, estGrowth: 5.9, grossMargin: 22.8, ebitMargin: 9.6,
    daPct: 5.8, capexPct: 6.6, debtEbitda: 3.12, cashPctSales: 3.9, interestRate: 9.6,
    taxRate: 25.2, price: 428.6, basicShares: 28.4, beta: 1.35,
    moodys: 'Ba1', sp: 'BB+', dpsMRQ: 1.6,
    nrCogs: 38.4, nrOther: -22.5, nrNonOp: 9.2,
    options: [{ shares: 0.348, strike: 262.0 }, { shares: 0.202, strike: 395.0 }],
    converts: [],
  },
  {
    id: 'p6', tierId: 't2', name: 'Ferncliff Group', ticker: 'FRNC',
    description: 'Diversified basic chemicals, fertilisers and titanium dioxide pigments',
    salesFY0: 9642.8, histGrowth: 4.1, estGrowth: 3.8, grossMargin: 21.4, ebitMargin: 8.2,
    daPct: 6.6, capexPct: 8.4, debtEbitda: 3.48, cashPctSales: 5.4, interestRate: 9.9,
    taxRate: 25.2, price: 296.5, basicShares: 41.2, beta: 1.42,
    moodys: 'Ba2', sp: 'BB', dpsMRQ: 0.9,
    nrCogs: 52.8, nrOther: 19.4, nrNonOp: 0,
    options: [{ shares: 0.520, strike: 184.0 }, { shares: 0.310, strike: 268.0 }],
    converts: [{ amount: 380.0, price: 262.0 }],
  },
  {
    id: 'p7', tierId: 't3', name: 'Pemberly Fine Chemicals', ticker: 'PMBF',
    description: 'Fine chemicals and flavour & fragrance intermediates for regional formulators',
    salesFY0: 1486.3, histGrowth: 15.2, estGrowth: 13.6, grossMargin: 38.4, ebitMargin: 19.8,
    daPct: 4.4, capexPct: 6.8, debtEbitda: 0.86, cashPctSales: 12.8, interestRate: 8.8,
    taxRate: 25.2, price: 742.0, basicShares: 3.24, beta: 0.88,
    moodys: 'NA', sp: 'NA', dpsMRQ: 1.85,
    nrCogs: 4.2, nrOther: 3.1, nrNonOp: 0,
    options: [{ shares: 0.048, strike: 415.0 }, { shares: 0.031, strike: 690.0 }],
    converts: [],
  },
  {
    id: 'p8', tierId: 't3', name: 'Quarrington Industrial', ticker: 'QRIN',
    description: 'Carbon compounds, wood treatments and industrial preservatives',
    salesFY0: 2104.6, histGrowth: 8.6, estGrowth: 7.4, grossMargin: 28.2, ebitMargin: 12.6,
    daPct: 5.4, capexPct: 6.2, debtEbitda: 2.18, cashPctSales: 6.8, interestRate: 9.4,
    taxRate: 25.2, price: 385.4, basicShares: 6.12, beta: 1.18,
    moodys: 'NA', sp: 'BB-', dpsMRQ: 1.2,
    nrCogs: 8.6, nrOther: -5.4, nrNonOp: 3.8,
    options: [{ shares: 0.086, strike: 232.0 }],
    converts: [{ amount: 64.0, price: 340.0 }],
  },
  {
    id: 'p9', tierId: 't3', name: 'Silverbeck Chemicals', ticker: 'SLVB',
    description: 'Water-treatment chemicals and specialty surfactants for municipal and industrial clients',
    salesFY0: 1742.9, histGrowth: 12.4, estGrowth: 11.2, grossMargin: 33.6, ebitMargin: 16.2,
    daPct: 4.9, capexPct: 7.4, debtEbitda: 1.34, cashPctSales: 9.2, interestRate: 9.1,
    taxRate: 25.2, price: 528.7, basicShares: 4.86, beta: 1.02,
    moodys: 'NA', sp: 'NA', dpsMRQ: 1.45,
    nrCogs: 6.8, nrOther: 4.2, nrNonOp: -2.1,
    options: [{ shares: 0.064, strike: 318.0 }, { shares: 0.042, strike: 495.0 }],
    converts: [],
  },
];

export const samplePeers = () => SPECS.map(expandPeer);

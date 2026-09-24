/**
 * Sample / synthetic precedent transactions.
 *
 * Each deal is described by a compact economic spec and expanded into a full
 * 3E input page: the target's reported financials (with the LTM stub bridge)
 * plus deal terms. Expansion is deterministic and internally consistent — the
 * offer price is back-solved so the transaction prices at the intended
 * EV/EBITDA, and the unaffected prices are back-solved from the premiums, so
 * every multiple and premium on the output page ties to the input page.
 *
 * These are the shipped defaults and the fixture the verification suite runs
 * against; nothing here is used once a user enters their own deals.
 */
import { blankCompany } from './compsCo.js';
import { blankDeal } from './precedentDeal.js';

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * @param {object} s
 *   salesFY0 / histGrowth / grossMargin / ebitMargin / daPct / capexPct
 *   debtEbitda / cashPctSales / interestRate / taxRate / basicShares
 *   evEbitda   the multiple the deal should price at
 *   prem1/prem7/prem30  premiums to the unaffected price, %
 */
export function expandDeal(s) {
  const g = 1 + s.histGrowth / 100;
  const stub = 0.5;

  const salesFY = [s.salesFY0 / g ** 2, s.salesFY0 / g, s.salesFY0];
  const sales = [...salesFY, s.salesFY0 * stub, s.salesFY0 * stub * g].map(r2);

  const gm = s.grossMargin / 100, em = s.ebitMargin / 100;
  const cogs = sales.map((v) => r2(v * (1 - gm)));
  const sga = sales.map((v) => r2(v * (gm - em)));
  const zero = sales.map(() => 0);

  const ltm = (a) => a[2] + a[4] - a[3];
  const ltmSales = ltm(sales);
  const daRate = s.daPct / 100;
  const ltmEbitda = ltmSales * (em + daRate);
  const debt = r2(ltmEbitda * s.debtEbitda);
  const cash = r2(ltmSales * (s.cashPctSales / 100));

  const yearFrac = [1, 1, 1, stub, stub];
  const interest = yearFrac.map((f) => r2(debt * (s.interestRate / 100) * f));
  const ebit = sales.map((v, i) => v - cogs[i] - sga[i]);
  const pretax = ebit.map((v, i) => v - interest[i]);
  const taxes = pretax.map((v) => r2(Math.max(0, v) * (s.taxRate / 100)));
  const da = sales.map((v) => r2(v * daRate));
  const capex = sales.map((v) => r2(v * (s.capexPct / 100)));
  const netIncome = pretax.map((v, i) => v - taxes[i]);
  const cfo = netIncome.map((v, i) => r2(v + da[i] - sales[i] * 0.012));
  const shares = sales.map(() => s.basicShares);

  // back-solve the offer so the deal prices at the intended EV/EBITDA
  const ev = ltmEbitda * s.evEbitda;
  const equity = ev - debt + cash;
  const offer = r2(equity / s.basicShares);
  const unaff = (p) => (isFinite(p) ? r2(offer / (1 + p / 100)) : 0);

  const bsSales = [salesFY[1], ltmSales];
  const asset = (pct, i) => r2(bsSales[i] * pct);
  const two = (fn) => [fn(0), fn(1)];
  const bs = {
    cash: [r2(cash * 0.92), cash],
    ar: two((i) => asset(0.168, i)),
    inventory: two((i) => asset(0.142, i)),
    prepaid: two((i) => asset(0.024, i)),
    ppe: two((i) => asset(0.532, i)),
    goodwill: two((i) => asset(0.196, i)),
    otherAssets: two((i) => asset(0.045, i)),
    ap: two((i) => asset(0.112, i)),
    accrued: two((i) => asset(0.049, i)),
    otherCurLiab: two((i) => asset(0.02, i)),
    debt: [r2(debt * 1.05), debt],
    otherLTLiab: two((i) => asset(0.06, i)),
    nci: [0, 0], preferred: [0, 0], equity: [0, 0],
  };
  for (const i of [0, 1]) {
    const assets = bs.cash[i] + bs.ar[i] + bs.inventory[i] + bs.prepaid[i] + bs.ppe[i] + bs.goodwill[i] + bs.otherAssets[i];
    const liabs = bs.ap[i] + bs.accrued[i] + bs.otherCurLiab[i] + bs.debt[i] + bs.otherLTLiab[i];
    bs.equity[i] = r2(assets - liabs);
  }

  return blankDeal({
    id: s.id,
    acquirer: s.acquirer,
    acquirerTicker: s.acquirerTicker || '',
    acquirerPrice: 0,
    dateAnnounced: s.dateAnnounced,
    dateEffective: s.dateEffective || 'Pending',
    transactionType: s.transactionType,
    consideration: s.consideration,
    targetDescription: s.targetDescription || '',
    acquirerDescription: s.acquirerDescription || '',
    cashOffer: offer,          // all-cash sample deals: the whole offer is cash
    exchangeRatio: 0,
    unaffected: { 1: unaff(s.prem1), 7: unaff(s.prem7), 30: unaff(s.prem30) },
    target: blankCompany({
      name: s.target,
      ticker: s.targetTicker || '',
      exchange: s.exchange || 'NSE',
      description: s.targetDescription || '',
      fyEnd: s.fyEnd || '2025-03-31',
      stubEnd: s.stubEnd || '2025-09-30',
      taxRate: s.taxRate,
      basicShares: s.basicShares,
      is: { sales, cogs, sga, otherExp: zero, interest, taxes, nci: zero, prefDiv: zero, dilutedShares: shares },
      adj: { nrCogs: zero.slice(), nrOther: zero.slice(), nrNonOp: zero.slice() },
      cf: { cfo, capex, da },
      bs,
      options: s.options || [],
      converts: [],
    }),
  });
}

const SPECS = [
  {
    id: 'd1', acquirer: 'Ardleigh Chemical Holdings', acquirerTicker: 'ARDH',
    target: 'Westmoor Specialties', targetTicker: 'WSTM',
    targetDescription: 'Performance coatings and speciality resins for industrial and architectural end markets',
    dateAnnounced: '2025-09-12', dateEffective: 'Pending',
    transactionType: 'Public / Public', consideration: 'Cash',
    salesFY0: 3240.0, histGrowth: 9.4, grossMargin: 33.5, ebitMargin: 16.4,
    daPct: 5.2, capexPct: 6.1, debtEbitda: 1.55, cashPctSales: 7.4, interestRate: 8.6,
    taxRate: 25.2, basicShares: 6.4, evEbitda: 16.0, prem1: 32, prem7: 34, prem30: 36,
    options: [{ shares: 0.09, strike: 380 }],
  },
  {
    id: 'd2', acquirer: 'Northgate Industrial Partners', acquirerTicker: '',
    target: 'Calderwood Polymers', targetTicker: 'CLDW',
    targetDescription: 'Engineered polymers and compounding for automotive and packaging customers',
    dateAnnounced: '2025-04-28', dateEffective: '2025-11-04',
    transactionType: 'Sponsor / Public', consideration: 'Cash',
    salesFY0: 5810.0, histGrowth: 6.2, grossMargin: 27.8, ebitMargin: 12.1,
    daPct: 5.9, capexPct: 6.8, debtEbitda: 2.35, cashPctSales: 5.1, interestRate: 9.1,
    taxRate: 25.2, basicShares: 18.2, evEbitda: 14.5, prem1: 24, prem7: 26, prem30: 29,
  },
  {
    id: 'd3', acquirer: 'Halewood Materials Group', acquirerTicker: 'HLWD',
    target: 'Stanmere Fine Chemicals', targetTicker: 'STMR',
    targetDescription: 'Custom synthesis and fine chemicals for pharmaceutical and agrochemical clients',
    dateAnnounced: '2024-11-19', dateEffective: '2025-05-30',
    transactionType: 'Public / Public', consideration: 'Cash / Stock',
    salesFY0: 2180.0, histGrowth: 12.8, grossMargin: 37.2, ebitMargin: 18.9,
    daPct: 4.8, capexPct: 6.6, debtEbitda: 1.12, cashPctSales: 10.2, interestRate: 8.2,
    taxRate: 25.2, basicShares: 3.9, evEbitda: 17.5, prem1: 38, prem7: 41, prem30: 44,
    options: [{ shares: 0.05, strike: 520 }, { shares: 0.03, strike: 760 }],
  },
  {
    id: 'd4', acquirer: 'Brookvale Capital', acquirerTicker: '',
    target: 'Elderfield Industries', targetTicker: '',
    targetDescription: 'Basic chemicals, industrial gases and integrated logistics',
    dateAnnounced: '2024-06-05', dateEffective: '2024-12-18',
    transactionType: 'Sponsor / Private', consideration: 'Cash',
    salesFY0: 7420.0, histGrowth: 4.1, grossMargin: 23.4, ebitMargin: 9.6,
    daPct: 6.4, capexPct: 7.9, debtEbitda: 2.95, cashPctSales: 4.2, interestRate: 9.5,
    taxRate: 25.2, basicShares: 24.6, evEbitda: 13.5, prem1: NaN, prem7: NaN, prem30: NaN,
  },
  {
    id: 'd5', acquirer: 'Tarnwick Group', acquirerTicker: 'TRNW',
    target: 'Ashcombe Surfactants', targetTicker: 'ASHC',
    targetDescription: 'Surfactants and water-treatment chemicals for municipal and industrial clients',
    dateAnnounced: '2023-10-02', dateEffective: '2024-03-22',
    transactionType: 'Public / Private', consideration: 'Cash',
    salesFY0: 1560.0, histGrowth: 11.2, grossMargin: 32.1, ebitMargin: 15.8,
    daPct: 5.0, capexPct: 7.1, debtEbitda: 1.28, cashPctSales: 8.8, interestRate: 8.9,
    taxRate: 25.2, basicShares: 4.2, evEbitda: 15.0, prem1: 27, prem7: 28, prem30: 31,
  },
];

export const sampleDeals = () => SPECS.map(expandDeal);

/**
 * Sample data for the Comparable Company and Precedent Transactions templates:
 * the template's own "Example (Illustrative)" company page (every figure is
 * the template's), and peers / deal targets derived from it deterministically
 * (scaled and tilted) so the statistics have real spread. Includes a
 * loss-maker, a peer excluded from the statistics, blank YTD columns and an
 * interim balance sheet, so the NM, include and LTM rules are all exercised.
 */
import { blankPage } from '../../src/lib/engine/companyPage.js';

const L = (fy, p = null, c = null) => ({ fy, p, c });

/** The template's Example (Illustrative) page: FY24, FY25, FY26, Q1 FY26, Q1 FY27. */
export const EXAMPLE_LINES = {
  rev: L([4200, 4750, 5300], 1250, 1420), otherInc: L([45, 52, 60], 13, 16), materials: L([2520, 2800, 3100], 740, 830),
  employee: L([420, 470, 520], 125, 140), otherExp: L([630, 700, 780], 185, 205), da: L([150, 170, 190], 46, 50),
  finance: L([60, 55, 48], 12, 11), exceptional: L([0, 0, -15], 0, 0), tax: L([117, 153, 178], 39, 50), assoc: L([5, 6, 8], 2, 2),
  nciProfit: L([10, 12, 14], 3, 4), shares: L([20, 20, 20], 20, 20),
  ppe: L([1800, 1950, 2150]), rou: L([120, 115, 130]), intangibles: L([250, 245, 240]), ncInvest: L([150, 180, 220]), otherNca: L([90, 100, 110]),
  inventories: L([620, 690, 760]), receivables: L([580, 650, 720]), cash: L([180, 240, 310]), otherBank: L([60, 70, 80]), curInvest: L([150, 200, 260]),
  otherCa: L([140, 155, 170]), shareCap: L([20, 20, 20]), otherEquity: L([2305, 2743, 3259]), nci: L([60, 72, 86]), ltBorrow: L([450, 380, 300]),
  leaseNc: L([100, 95, 105]), otherNcl: L([80, 90, 100]), stBorrow: L([250, 220, 200]), leaseCur: L([25, 25, 30]), payables: L([520, 580, 640]), otherCl: L([330, 370, 410]),
  cfPbt: L([465, 607, 707]), cfDa: L([150, 170, 190]), cfFinance: L([60, 55, 48]), cfOther: L([-40, 20, 10]), cfWc: L([-90, -40, -60]), cfTax: L([-110, -150, -175]),
  capex: L([-300, -320, -390]), ppeSale: L([10, 8, 12]), investNet: L([26, -80, -95]), acquisitions: L([0, 0, 0]), intDivRecd: L([35, 24, 63]),
  borrowNet: L([-60, -100, -100]), intPaid: L([-58, -54, -47]), divPaid: L([-40, -50, -60]), leasePay: L([-28, -30, -33]), equityIssue: L([0, 0, 0]), otherFin: L([0, 0, 0]),
};

const round1 = (x) => Math.round(x * 10) / 10;
/** A page from the example: every money line × `scale`, costs tilted by `tilt` (a margin shift). */
export function derivedPage({ scale = 1, tilt = 0, interim = false, noYtd = false, loss = false } = {}) {
  const pg = blankPage();
  for (const [k, l] of Object.entries(EXAMPLE_LINES)) {
    const f = k === 'shares' ? 1 : scale;
    const t = ['materials', 'otherExp'].includes(k) ? 1 + tilt : 1;
    const m = (v) => (v === null ? null : round1(v * f * t * (loss && k === 'materials' ? 1.45 : 1)));
    pg.lines[k] = { fy: l.fy.map(m), p: noYtd ? null : m(l.p), c: noYtd ? null : m(l.c) };
  }
  if (interim) {
    // an interim balance sheet in the current-YTD column (balanced: cash and other equity move together)
    for (const k of ['ppe', 'receivables', 'cash', 'otherEquity', 'payables', 'ltBorrow', 'leaseNc', 'nci', 'curInvest']) {
      const v = pg.lines[k].fy[2];
      pg.lines[k].c = v;
    }
    pg.lines.cash.c = round1(pg.lines.cash.c + 40 * scale);
    pg.lines.otherEquity.c = round1(pg.lines.otherEquity.c + 40 * scale);
  }
  return pg;
}

export const TEMPLATE_TIERS = [{ id: 't1', name: 'Large caps' }, { id: 't2', name: 'Mid caps' }];

export function sampleCompsData() {
  const peer = (i, name, ticker, o, extra = {}) => ({
    id: `p${i}`, name, ticker, sector: 'Specialty Chemicals', include: 1, tierId: o.tier,
    price: o.price, shares: 20 * (o.shareScale || 1), page: derivedPage(o), ...extra,
  });
  return {
    settings: {
      priceDate: '2026-06-30', lease: 1, years: 3, ytd: true,
      labels: { fy: ['FY24', 'FY25', 'FY26'], p: 'Q1 FY26', c: 'Q1 FY27', ltm: 'LTM Jun-26' },
      stats: null, multiples: null,
    },
    peerCount: 7,
    target: { ticker: 'EXMFG', sector: 'Specialty Chemicals', price: 620, shares: 20, page: derivedPage() },
    peers: [
      peer(1, 'Alpha Chem Ltd', 'ALPHA', { scale: 1.8, tilt: -0.05, price: 1350, tier: 't1' }),
      peer(2, 'Beta Polymers', 'BETA', { scale: 2.4, tilt: 0.02, price: 1650, tier: 't1', interim: true }),
      peer(3, 'Gamma Colours', 'GAMMA', { scale: 0.7, tilt: 0.04, price: 380, tier: 't2', noYtd: true }),
      peer(4, 'Delta Fine Chem', 'DELTA', { scale: 0.9, tilt: -0.08, price: 760, tier: 't2' }),
      peer(5, 'Epsilon Loss Co', 'EPSI', { scale: 0.6, loss: true, price: 120, tier: 't2' }),
      peer(6, 'Zeta Excluded', 'ZETA', { scale: 1.2, tilt: 0, price: 900, tier: 't1' }, { include: 0 }),
      peer(7, 'Eta Unassigned', 'ETA', { scale: 1.1, tilt: -0.02, price: 640, tier: null }),
    ],
    tiers: TEMPLATE_TIERS,
    headline: 'evEbitdaLtm',
  };
}

export function samplePrecedentData() {
  const deal = (i, o) => {
    const pg = derivedPage(o);
    pg.labels = { fy: [`FY${20 + i}`, `FY${21 + i}`, `FY${22 + i}`], p: null, c: null, ltm: null };
    return {
      id: `d${i}`, date: `202${i}-0${i + 2}-15`, target: `Target ${i} Ltd`, acquirer: `Acquirer ${i}`,
      acquirerType: i % 2 ? 'Strategic' : 'Financial', stakePct: o.stake, consideration: o.consideration,
      form: o.form || 'Cash', status: 'Completed', listed: o.listed ? 'Yes' : 'No',
      offerPrice: o.offer ?? null, unaffectedPrice: o.unaffected ?? null, include: o.include ?? 1,
      source: `Open offer letter ${i}`, ticker: '', page: pg,
    };
  };
  return {
    settings: { valDate: '2026-06-30', lease: 1, years: 3, ytd: true, stats: null, multiples: null },
    dealCount: 5,
    company: { ticker: 'EXMFG', price: 620, shares: 20, page: derivedPage() },
    deals: [
      deal(1, { scale: 1.3, tilt: -0.03, stake: 51, consideration: 9200, listed: true, offer: 850, unaffected: 680 }),
      deal(2, { scale: 0.8, tilt: 0.02, stake: 100, consideration: 11800, listed: false }),
      deal(3, { scale: 1.6, tilt: -0.06, stake: 74, consideration: 17500, listed: true, offer: 1240, unaffected: 1010, interim: true }),
      deal(4, { scale: 0.5, tilt: 0.05, stake: 26, consideration: 1150, listed: true, offer: 410, unaffected: 390, include: 0 }),
      deal(5, { scale: 1.1, tilt: 0, stake: 60, consideration: 8900, listed: true, offer: 700, unaffected: 540, noYtd: true }),
    ],
    headline: 'evEbitda',
  };
}

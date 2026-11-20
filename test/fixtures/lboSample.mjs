/**
 * Sample data for the template LBO: the comps template's Example company page
 * as the Historicals (FY24–FY26), five years of drivers, the template's own
 * example debt package (Senior A 2.5x / Senior B 1.5x / Mezzanine 1.0x) and
 * deal terms, so every repayment type produces a finite IRR.
 */
import { derivedPage } from './templateSample.mjs';
import { blankLboT } from '../../src/lib/engine/lboTemplate.js';

export function sampleLboData(over = {}) {
  const d = blankLboT();
  d.settings = {
    ...d.settings,
    repay: 'both', histYears: 3, holdYears: 5,
    labels: { hist: ['FY24', 'FY25', 'FY26'], fcst: ['FY27E', 'FY28E', 'FY29E', 'FY30E', 'FY31E'] },
    lease: 1, exitStep: 1, entryStep: 1, growthStep: 2,
    ...(over.settings || {}),
  };
  d.company = { page: derivedPage() };
  d.drivers = {
    gRev: [12, 11, 10, 9, 8],
    materials: [58, 58, 57.5, 57.5, 57],
    employee: [10, 10, 10, 10, 10],
    otherExp: [14.5, 14.5, 14.2, 14, 14],
    da: [3.6, 3.6, 3.7, 3.7, 3.8],
    tax: [25.2, 25.2, 25.2, 25.2, 25.2],
    capex: [7, 7, 6.5, 6.5, 6],
    invDays: [90, 90, 88, 88, 86],
    recDays: [50, 50, 49, 49, 48],
    payDays: [75, 75, 75, 74, 74],
    oca: [3.2, 3.2, 3.2, 3.2, 3.2],
    ocl: [7.7, 7.7, 7.7, 7.7, 7.7],
    leasePay: [0.6, 0.6, 0.6, 0.6, 0.6],
  };
  d.deal = { entryMultiple: 10, cashUsed: 250, txnFeePct: 2, exitMultiple: 10 };
  d.debt = {
    senA: { x: 2.5, rate: 9, amort: 10, tenor: 5, feePct: 1.5 },
    senB: { x: 1.5, rate: 10, amort: 1, tenor: 7, feePct: 2 },
    mezz: { x: 1, rate: 12, pik: 3, tenor: 8, feePct: 2.5 },
  };
  d.cash = { sweepPct: 100, minCash: 150, rcf: 300, rcfRate: 9, rcfFee: 0.5 };
  return d;
}

/**
 * Sample data for the template DCF: the comps template's Example company page
 * as the Historicals (FY24–FY26), five years of drivers near its history, and
 * both costs of equity and a WACC filled, so every one of the twelve
 * combinations values to a finite price.
 */
import { derivedPage } from './templateSample.mjs';
import { blankDcfT } from '../../src/lib/engine/dcfTemplate.js';

export function sampleDcfData(over = {}) {
  const d = blankDcfT();
  d.settings = {
    ...d.settings,
    cf: 'fcff', tv: 'gordon', coe: 'capm',
    histYears: 3, fcstYears: 5,
    labels: { hist: ['FY24', 'FY25', 'FY26'], fcst: ['FY27E', 'FY28E', 'FY29E', 'FY30E', 'FY31E'] },
    valDate: '2026-03-31', lease: 1,
    growth: 5, exitMultiple: 12, rateStep: 0.5, tvStep: null,
    ...(over.settings || {}),
  };
  d.company = { ticker: 'EXMFG', price: 620, shares: 20, page: derivedPage() };
  d.drivers = {
    gRev: [12, 11, 10, 9, 8],
    materials: [58, 58, 57.5, 57.5, 57],
    employee: [10, 10, 10, 10, 10],
    otherExp: [14.5, 14.5, 14.2, 14, 14],
    da: [3.6, 3.6, 3.7, 3.7, 3.8],
    otherInc: [1.1, 1.1, 1.1, 1.1, 1.1],
    tax: [25.2, 25.2, 25.2, 25.2, 25.2],
    capex: [7, 7, 6.5, 6.5, 6],
    invDays: [90, 90, 88, 88, 86],
    recDays: [50, 50, 49, 49, 48],
    payDays: [75, 75, 75, 74, 74],
    oca: [3.2, 3.2, 3.2, 3.2, 3.2],
    ocl: [7.7, 7.7, 7.7, 7.7, 7.7],
    netBorrow: [-100, -80, -60, -40, -20],
    intRate: [8.5, 8.5, 8.4, 8.3, 8.2],
    payout: [12, 14, 16, 18, 20],
  };
  d.capm = { rf: 6.5, beta: 1.05, erp: 7, betaMode: 'direct', peerBeta: 0.85, targetDe: 15, taxRate: 25.2, peers: [
    { id: 'b1', name: 'Alpha Chem', beta: 1.1, de: 20, taxRate: 25.2 },
    { id: 'b2', name: 'Beta Polymers', beta: 0.95, de: 10, taxRate: 25.2 },
    { id: 'b3', name: 'Gamma Colours', beta: 1.3, de: 45, taxRate: 30 },
  ] };
  d.buildup = { rf: 6.5, erp: 7, size: 2, industry: 1, specific: 1.5, country: 0 };
  d.wacc = { kd: 8.5, taxRate: 25.2, targetWd: 15 };
  return d;
}

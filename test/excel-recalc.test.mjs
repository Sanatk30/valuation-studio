/**
 * Every method's Excel file, recalculated with HyperFormula, reproduces the
 * engine the app runs — cell for cell (relative error ≤ 1e-9) — on the sample
 * model. Edge cases (tax losses, blanks, options) are in excel-variants.
 */
import { SAMPLE_MODEL as A } from './fixtures/model.mjs';
import { checkDcf, checkTs, checkLbo, checkIpo, checkComps, checkPrecedent, checkCombined } from './helpers/excelChecks.mjs';

const runs = [
  checkDcf(A),
  checkTs(A, {}, 'ts'),
  checkTs(A, {}, 'ratios'),
  checkLbo(A),
  checkIpo(A),
  checkComps(A),
  checkPrecedent(A),
  checkCombined(A, {
    rows: [
      { method: 'Discounted Cash Flow', figureLabel: 'DCF — FCFF, perpetuity growth', value: 912.4, low: 801.2, high: 1043.9, weight: 60 },
      { method: 'Comparable Companies', figureLabel: 'Comps — EV / EBITDA median', value: 701.5, low: 655.0, high: 752.3, weight: 40 },
    ],
    marketPrice: 850,
  }),
];

let failures = 0, checks = 0;
for (const T of runs) {
  checks += T.checks;
  failures += T.failures.length;
  for (const f of T.failures) console.error('FAIL:', f);
}
console.log(`excel-recalc: ${checks} checks, ${failures} failures`);
if (failures) process.exit(1);

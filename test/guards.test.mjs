/* Three rules: Excel's power of a negative base (CAGR), the blank latest actual
   year that would zero a DCF / LBO, and history averages that skip empty years. */
import { xlPow } from '../src/lib/engine/xlPow.js';
import { importJsx } from './helpers/bundleJsx.mjs';
let checks = 0, failures = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; console.error('FAIL', m); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// real Excel: (−0.8)^(1/3) = −0.9283; (−0.8)^(1/2) = #NUM!
ok(near(xlPow(-0.8, 1 / 3), -Math.cbrt(0.8)), 'odd root of a negative base is signed, as in Excel');
ok(near(xlPow(-1.8012, 1 / 5), -Math.pow(1.8012, 0.2)), 'fifth root of a negative base is signed');
ok(Number.isNaN(xlPow(-0.8, 1 / 2)), 'even root of a negative base is #NUM! (NaN)');
ok(near(xlPow(1.21, 1 / 2), 1.1), 'a positive base is unchanged');

const dcf = await importJsx('src/methods/steps/dcfSteps.jsx');
const grid = await importJsx('src/components/DriversGrid.jsx');
const r = { n: 5, F: { rev: [1804.6, 2721.8, 3626.4, 0, 0] }, labels: { hist: ['FY24', 'FY25', 'FY26', 'FY27', 'FY28'] } };
const e = dcf.latestYearErrors(r, { startYear: 2029 }, 'the forecast');
ok(e.length === 1 && /FY27, FY28/.test(e[0]) && /set Year 1 to 2027/.test(e[0]), 'blank FY27–FY28: stop and suggest Year 1 = 2027');
ok(dcf.latestYearErrors({ ...r, F: { rev: [1, 2, 3, 4, 5] } }, { startYear: 2029 }, 'x').length === 0, 'a filled latest year passes');
ok(/No historical year/.test(dcf.latestYearErrors({ ...r, F: { rev: [0, 0, 0, 0, 0] } }, {}, 'x')[0] || ''), 'no revenue anywhere: asks for historicals');
const skip = dcf.emptyHistYears(r);
ok(JSON.stringify(skip) === '[false,false,false,true,true]', 'empty years are the ones without revenue');
// growth refs as the template computes them: FY27 blank → −100 %
const growth = ['n.a.', 0.5082, 0.3323, -1, ''];
ok(near(grid.histAverage(growth, 'pct', skip), (0.5082 + 0.3323) / 2 * 100), 'the average leaves the empty FY27 out (was −5.3 %)');
ok(near(grid.histAverage(growth, 'pct'), (0.5082 + 0.3323 - 1) / 3 * 100), 'without the skip list the old average is unchanged');

// the latest completed fiscal year from the date and the year-end month
const { latestCompletedFy, impliedYear1 } = await import('../src/lib/period.js');
const nov20 = new Date(2026, 10, 20);
ok(latestCompletedFy(3, nov20) === 2026 && impliedYear1(3, nov20) === 2027, 'March year end on 20 Nov 2026: latest FY26, Year 1 = 2027');
ok(latestCompletedFy(12, nov20) === 2025 && impliedYear1(12, nov20) === 2026, 'December year end on 20 Nov 2026: latest FY25, Year 1 = 2026');
ok(latestCompletedFy(12, new Date(2027, 0, 2)) === 2026, 'December year end on 2 Jan 2027: FY26 has ended');
ok(latestCompletedFy(3, new Date(2026, 2, 31, 12)) === 2025, 'on the year-end day itself the year has not ended');
ok(latestCompletedFy(null) === null, 'no year-end month: null');

console.log(`guards: ${checks} checks, ${failures} failures`);
if (failures) process.exit(1);

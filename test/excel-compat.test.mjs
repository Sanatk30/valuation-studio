/**
 * What real Excel needs from a saved file that HyperFormula does not check:
 *   - functions added after the 2007 file format (QUARTILE.EXC, IFNA, …) are
 *     saved with Excel's _xlfn. prefix — written bare, Excel reads an unknown
 *     name (#NAME?), and an IFERROR around it silently turns into NM;
 *   - the LBO IRR carries a guess (real Excel's IRR returns #NUM! on deep
 *     losses from its default 10% start; checked in Excel for Mac 16);
 *   - the multi-variable regression statistics that can divide by zero read NA.
 */
import { withModel } from './fixtures/model.mjs';
import { sampleDcfData } from './fixtures/dcfSample.mjs';
import { sampleLboData } from './fixtures/lboSample.mjs';
import { buildWorkbook, EXPORT_METHODS } from '../src/lib/excel/exportExcel.js';
import { MULTI_REG_SHEET } from '../src/lib/excel/templateWorkbooks.js';
import { statFormula } from '../src/lib/excel/templateXlsx.js';

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } };

/** Excel 2010+ worksheet functions that must be saved as _xlfn.NAME. */
const FUTURE = new Set(['IFNA', 'IFS', 'SWITCH', 'MAXIFS', 'MINIFS', 'CONCAT', 'TEXTJOIN', 'XLOOKUP', 'XMATCH', 'FILTER', 'SORT', 'SORTBY',
  'UNIQUE', 'SEQUENCE', 'LET', 'LAMBDA', 'DAYS', 'AGGREGATE', 'ISOWEEKNUM', 'RRI', 'PDURATION', 'NUMBERVALUE', 'XOR', 'SHEET', 'SHEETS']);
/** Every function name a formula calls that needs the prefix but lacks it. */
function bareFuture(formula) {
  const out = [];
  const f = formula.replace(/"[^"]*"/g, '""');
  for (const m of f.matchAll(/(_xlfn\.)?([A-Z][A-Z0-9]*(?:\.[A-Z0-9]+)*)\(/g)) {
    const [, pre, name] = m;
    if (!pre && (name.includes('.') || FUTURE.has(name))) out.push(name);
  }
  return out;
}
function scan(wb, tag) {
  const bad = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => {
    const f = c.value && typeof c.value === 'object' ? c.value.formula : null;
    if (f) for (const name of bareFuture(f)) bad.push(`${ws.name}!${c.address} ${name}`);
  })));
  ok(bad.length === 0, `${tag}: every post-2007 function carries _xlfn. (${bad.slice(0, 3).join(' | ')})`);
}

console.log('=== _xlfn. prefix on post-2007 functions ===');
ok(bareFuture('IFERROR(QUARTILE.EXC(A1:A5,1),"NM")').join() === 'QUARTILE.EXC' && bareFuture('IFERROR(_xlfn.QUARTILE.EXC(A1:A5,1),"NM")').length === 0
  && bareFuture('IFNA(A1,0)+QUARTILE(A1:A5,1)').join() === 'IFNA', 'the scanner itself');
ok(statFormula('q1', '$AN$7:$AN$13', 'exc') === 'IF(COUNT($AN$7:$AN$13)=0,"NM",IFERROR(_xlfn.QUARTILE.EXC($AN$7:$AN$13,1),"NM"))', 'exclusive quartile saved as _xlfn.QUARTILE.EXC');
ok(statFormula('q3', '$AN$7:$AN$13', 'inc') === 'IF(COUNT($AN$7:$AN$13)=0,"NM",QUARTILE($AN$7:$AN$13,3))', 'inclusive quartile: the template\'s QUARTILE (a 2007 function, no prefix)');
const COMBINED = { rows: [{ key: 'dcfFcff', figureLabel: 'FCFF', value: 900, low: 800, high: 1000, weight: 100 }], marketPrice: 850 };
for (const m of EXPORT_METHODS) {
  const a = withModel();
  if (m === 'dcf') a.dcf = sampleDcfData();
  if (m === 'lbo') a.lbo = sampleLboData();
  scan(buildWorkbook(a, m, m === 'combined' ? { combined: COMBINED } : {}), m);
}
{
  const a = withModel();
  a.comps.settings.stats = { method: 'exc' };
  const wb = buildWorkbook(a, 'comps');
  scan(wb, 'comps, exclusive percentiles');
  let n = 0;
  wb.getWorksheet('Comps Summary').eachRow((row) => row.eachCell((c) => { if (c.value?.formula?.includes('_xlfn.QUARTILE.EXC(')) n++; }));
  ok(n > 0, `comps, exclusive: the statistics rows use _xlfn.QUARTILE.EXC (${n} cells)`);
  const p = withModel();
  p.precedent.settings.stats = { method: 'exc' };
  scan(buildWorkbook(p, 'precedent'), 'precedent, exclusive percentiles');
}

console.log('\n=== LBO IRR guess ===');
for (const m of [1, 3, 5, 10]) {
  const d = sampleLboData({ settings: { holdYears: m, labels: null } });
  for (const k of Object.keys(d.drivers)) d.drivers[k] = Array.from({ length: m }, (_, j) => d.drivers[k][j % 5]);
  const wb = buildWorkbook({ settings: { currency: 'INR', unit: 'Cr', period: { startYear: 2027 } }, company: { name: 'X' }, lbo: d }, 'lbo');
  const last = String.fromCharCode(66 + m);
  ok(wb.getWorksheet('Returns').getCell('B25').value?.formula === `IF(AND(B22>0,B23>0),IRR(B20:${last}20,B24^(1/${m})-1),"NM")`, `${m}-year hold: IRR over B20:${last}20 guessed from the MOIC`);
}

console.log('\n=== regression statistics that can divide by zero read NA ===');
{
  const ws = buildWorkbook(withModel(), 'comps').getWorksheet(MULTI_REG_SHEET);
  const at = (label) => { let f = null; ws.eachRow((row) => { if (row.getCell(1).value === label) f = row.getCell(2).value?.formula; }); return f; };
  for (const label of ['R²', 'Adjusted R²', 'F-statistic']) ok(/^IFERROR\(/.test(at(label) || ''), `${label} wrapped in IFERROR(…,"NA")`);
  let coef = 0;
  ws.eachRow((row) => { if (row.getCell(1).value === 'Intercept') coef = row.number; });
  ok(coef > 0 && ['C', 'D', 'E'].every((c) => /^IFERROR\(/.test(ws.getCell(`${c}${coef}`).value?.formula || '')), 'coefficient SE, t-stat and p-value wrapped in IFERROR(…,"NA")');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`${failures} FAILED`); process.exit(1); }

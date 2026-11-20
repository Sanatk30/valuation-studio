/**
 * European number format: one rule for "." and "," (lib/format.js unSeparate)
 * in every number parser — the number boxes (parseInputNumber, Field.jsx's
 * parseNum), the year-grid paste (YearGrid.jsx pasteBlock) and the template /
 * company-list paste (lib/templatePaste.js parseNum, splitBlock,
 * parsePageGrid, parseCompanyList).
 */
import { unSeparate, parseInputNumber } from '../src/lib/format.js';
import { parseNum as pasteNum, splitBlock, parsePageGrid, parseCompanyList } from '../src/lib/templatePaste.js';
import { importJsx } from './helpers/bundleJsx.mjs';

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Object.is(a, b) || a === b;

const { parseNum: fieldNum } = await importJsx('src/wizard/Field.jsx');
const { pasteBlock } = await importJsx('src/wizard/YearGrid.jsx');

/** [typed, value]; NaN = not a number. Every parser must agree on these. */
const SEPARATORS = [
  // both "." and ",": the last one is the decimal point
  ['1.234,5', 1234.5], ['1,234.5', 1234.5], ['1.234.567,89', 1234567.89], ['1,234,567.89', 1234567.89],
  ['1.234,567', 1234.567], ['0,5', 0.5], ['1.000,00', 1000], ['1,000.00', 1000], ['1.234,', 1234], ['1,234.', 1234],
  ['1,23,456.78', 123456.78], ['12.34.567,8', 1234567.8],
  // several of one separator: thousands in threes, or Indian lakh / crore groups
  ['1.234.567', 1234567], ['1,234,567', 1234567], ['12,34,567', 1234567], ['1,23,456', 123456],
  ['1,23,45,678', 12345678], ['100.000.000', 100000000],
  // one comma: thousands only before exactly three digits with a 1–3 digit lead
  ['12,5', 12.5], ['0,25', 0.25], ['3,14159', 3.14159], ['12,50', 12.5], ['1,234', 1234], ['999,999', 999999],
  ['0,250', 0.25], [',5', 0.5], ['1234,567', 1234.567], ['12,', 12],
  // one dot: the decimal point
  ['1.234', 1.234], ['12.5', 12.5], ['.5', 0.5], ['12.', 12], ['0.250', 0.25],
  // plain and exponent
  ['1234', 1234], ['0', 0], ['1e3', 1000], ['1.5e3', 1500], ['1,5e3', 1500], ['2.5E-2', 0.025],
  // separators in the wrong places, or doubled decimal points
  ['1,2,3', NaN], ['1,234,5', NaN], ['1.2.3', NaN], ['1.234,5,6', NaN], ['1,234.5.6', NaN], ['1,2.5', NaN],
  ['1.23.4567', NaN], ['12.03.2024', NaN], ['1,,234', NaN], [',', NaN], ['.', NaN], ['1,234,56', NaN],
];

console.log('=== unSeparate: the shared rule ===');
for (const [s, v] of SEPARATORS) {
  const got = unSeparate(s);
  ok(Number.isNaN(v) ? got === null : Number(got) === v, `unSeparate("${s}") → ${Number.isNaN(v) ? 'null' : v} (got ${got})`);
}
ok(unSeparate('') === null && unSeparate('abc') === null && unSeparate('0x10') === null && unSeparate('Infinity') === null, 'unSeparate: no digits, hex and Infinity are not numbers');
ok(unSeparate('-1') === null && unSeparate('1%') === null, 'unSeparate takes the bare number (sign and % are the callers\')');

console.log('\n=== number boxes (parseInputNumber, Field parseNum) ===');
for (const [s, v] of SEPARATORS) {
  ok(same(parseInputNumber(s), v), `box "${s}" → ${v} (got ${parseInputNumber(s)})`);
  ok(same(fieldNum(s), parseInputNumber(s)), `Field parseNum agrees on "${s}"`);
}
{
  const P = parseInputNumber;
  ok(P('-1.234,5') === -1234.5 && P('−1.234,5') === -1234.5 && P('–1.234,5') === -1234.5, 'minus, typographic minus, en dash');
  ok(P('(1.234,5)') === -1234.5 && P('(12,5)') === -12.5 && P('(1,234)') === -1234, 'accounting negatives in brackets');
  ok(P('(−12,5)') === 12.5, 'a minus inside brackets cancels (as in the paste parser)');
  ok(P('+12,5') === 12.5, 'a leading plus');
  ok(P('12,5%') === 12.5 && P('12,5 %') === 12.5 && P('12,5 %') === 12.5 && P('(4,25%)') === -4.25 && P('(4,25)%') === -4.25, 'percent: the boxes hold percent, so "%" is dropped');
  ok(P('1 234,5') === 1234.5 && P('1 234,5') === 1234.5 && P('1 234 567,89') === 1234567.89, 'spaces, non-breaking and narrow non-breaking spaces as thousands separators');
  ok(P('  1.234,5  ') === 1234.5, 'surrounding spaces');
  ok(P('') === null && P('  ') === null && P(null) === null && P(undefined) === null, 'blank → null');
  ok(['-', '−', '(', '()', '%', '1(2)3', '(12', '12)', '€5', '₹5', '1.234,5x', '--5', '12%5', 'NM', 'n.a.'].every((x) => Number.isNaN(P(x))), 'junk, unbalanced brackets and currency symbols are not numbers in a box (as before)');
  ok(Object.is(P('0,0'), 0) && P('-0,5') === -0.5, 'zero and small negatives with a decimal comma');
}

console.log('\n=== template / company-list paste (templatePaste parseNum) ===');
for (const [s, v] of SEPARATORS) {
  const r = pasteNum(s);
  ok(Number.isNaN(v) ? !r.ok : r.ok && r.value === v, `paste "${s}" → ${Number.isNaN(v) ? 'not a value' : v} (got ${r.ok ? r.value : 'not ok'})`);
}
{
  const N = (s) => pasteNum(s);
  ok(N('€ 1.234,50').value === 1234.5 && N('1.234,50 €').value === 1234.5 && N('₹ 12,34,567').value === 1234567 && N('$1,234.50').value === 1234.5, 'currency symbols before or after');
  ok(N('(1.234,5)').value === -1234.5 && N('-1.234,5').value === -1234.5 && N('−1.234,5').value === -1234.5 && N('(−1.234,5)').value === 1234.5, 'negatives');
  ok(N('12,5%').value === 0.125 && N('12,5 %').value === 0.125 && N('(4,25%)').value === -0.0425, 'percent converts to a fraction, decimal comma or not');
  ok(N('1 234,5').value === 1234.5 && N('1 234 567').value === 1234567, 'non-breaking and plain spaces');
  for (const s of ['NA', 'n/a', 'n.a.', 'NM', 'nmf', '-', '–', '—', '...', '', '%', '12%5', '%12']) ok(!N(s).ok, `"${s}" is not a value`);
}

console.log('\n=== splitting a pasted block ===');
{
  // Excel / Sheets copy cells tab-separated: the separators inside a European number never split a cell
  const rows = splitBlock('Umsatzerlöse\t1.234,5\t2.345,6\r\nSonstige Erträge\t12,5\t(3,4)\r\n');
  ok(rows.length === 2 && rows[0].length === 3 && rows[0][1] === '1.234,5' && rows[1][2] === '(3,4)', 'tabs: "1.234,5" stays one cell');
  ok(rows[0].slice(1).map((c) => pasteNum(c).value).join('|') === '1234.5|2345.6' && pasteNum(rows[1][2]).value === -3.4, 'and reads as 1234.5, 2345.6, −3.4');
  // the CSV of a decimal-comma locale uses semicolons
  const semi = splitBlock('Revenue;1.234,5;2.345,6\nOther income;12,5;"1.000,0"');
  ok(semi.length === 2 && semi[0].length === 3 && semi[0][1] === '1.234,5' && semi[1][2] === '1.000,0', 'semicolon CSV: split on ";" and the commas stay in the numbers');
  const comma = splitBlock('Revenue,"1,234.5","2,345"\nOther Income,10,20');
  ok(comma[0].length === 3 && comma[0][1] === '1,234.5' && pasteNum(comma[0][2]).value === 2345, 'comma CSV still splits on "," with quoted cells kept whole');
  ok(splitBlock('Revenue,"a;b",5')[0].length === 3, 'a ";" inside quotes does not switch a comma CSV to semicolons');
}

console.log('\n=== page grid and company list with European numbers ===');
{
  const columns = [{ id: 0, label: 'FY24' }, { id: 1, label: 'FY25' }, { id: 2, label: 'FY26' }];
  const block = [
    'Particulars\tFY25\tFY26',
    'Revenue from operations\t1.234,5\t2.345.678,9',
    'Other income\t12,5\t(3,4)',
    'Trade receivables\t1.000\t2.500,25',
  ].join('\n');
  const g = parsePageGrid(block, { columns });
  const m = Object.fromEntries((g.matched || []).map((x) => [x.key, x.values]));
  ok(g.ok && g.slots.map((s) => s?.id).join(',') === '1,2', 'header FY25 / FY26 lines the block up');
  ok(m.rev?.join('|') === '1234.5|2345678.9', 'revenue 1.234,5 and 2.345.678,9');
  ok(m.otherInc?.join('|') === '12.5|-3.4', 'other income 12,5 and (3,4)');
  ok(m.receivables?.join('|') === '1|2500.25', 'a lone "1.000" is the decimal 1 (one dot is a decimal point), 2.500,25 → 2500.25');

  const list = parseCompanyList(['Company Name\tShare Price\tDiluted Shares\tInclude', 'Alpha AG\t1.234,50\t12,5\t1', 'Beta SA\t€ 87,20\t1.234.567\t0'].join('\n'));
  ok(list.ok && list.companies[0].price === 1234.5 && list.companies[0].shares === 12.5 && list.companies[0].include === 1, 'company list: 1.234,50 and 12,5');
  ok(list.companies[1].price === 87.2 && list.companies[1].shares === 1234567 && list.companies[1].include === 0, 'company list: € 87,20 and 1.234.567');
  const semiList = parseCompanyList('Company Name;Share Price;Diluted Shares\nAlpha AG;1.234,50;12,5');
  ok(semiList.ok && semiList.companies[0].price === 1234.5 && semiList.companies[0].shares === 12.5, 'company list as semicolon CSV');
}

console.log('\n=== year-grid paste (YearGrid pasteBlock) ===');
{
  const eq = (a, b) => JSON.stringify(a.map((r) => r.map((v) => (Number.isNaN(v) ? 'NaN' : v)))) === JSON.stringify(b);
  ok(pasteBlock('1.234,5') === null && pasteBlock('12,5\r\n') === null, 'a single value is an ordinary paste into the box');
  ok(eq(pasteBlock('1.234,5\t2.345,6\t12,5\r\n0,25\t(1.000,5)\t−3,5\r\n'), [[1234.5, 2345.6, 12.5], [0.25, -1000.5, -3.5]]), 'tab-separated European figures, CRLF: each cell whole');
  ok(eq(pasteBlock('1,234.5\t1,23,456\t1.234\n'), [[1234.5, 123456, 1.234]]), 'English and Indian figures; one dot is a decimal point');
  ok(eq(pasteBlock('Umsatz\t1.234,5\t2.345,6\nEBITDA\t12,5\t13,5'), [[1234.5, 2345.6], [12.5, 13.5]]), 'a leading label is dropped');
  ok(eq(pasteBlock('-\t1.234,5\t2.345,6\nNM\t5\t6\nn.a.\t7\t8'), [['NaN', 1234.5, 2345.6], ['NaN', 5, 6], ['NaN', 7, 8]]), 'an Excel accounting zero "-" or "NM" / "n.a." in the first cell is a skipped cell, not a label (the row is not shifted left)');
  ok(eq(pasteBlock('Revenue\t-\t5\n\t1\t2'), [['NaN', 5], [null, 1, 2]]), 'label then a "-" cell; a blank first cell stays a blank cell');
  ok(eq(pasteBlock('12,5 %\t(4,25%)\t1 234,5'), [[12.5, -4.25, 1234.5]]), 'percent cells and non-breaking-space thousands');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('NUMBER FORMAT OK');

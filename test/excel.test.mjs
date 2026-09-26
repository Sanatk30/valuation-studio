/**
 * Structure of every method's Excel file: it writes and reads back, carries
 * exactly Cover + Inputs + its own calculation sheets (comps and precedent:
 * the user's template set — Instructions, Inputs, Summary, Implied Valuation,
 * company sheets), the Inputs sheet holds
 * only that method's inputs, every formula's references resolve to a sheet in
 * the file (and, across sheets, to a non-empty cell), parentheses balance,
 * inputs are blue, and nothing writes NaN / Infinity into a cell.
 */
import ExcelJS from 'exceljs';
import { SAMPLE_MODEL as A, withModel } from './fixtures/model.mjs';
import { buildWorkbook, EXPORT_METHODS } from '../src/lib/excel/exportExcel.js';
import { C_INPUT } from '../src/lib/excel/xlsxUtil.js';

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } };

const COMBINED = { rows: [{ method: 'DCF', figureLabel: 'FCFF', value: 900, low: 800, high: 1000, weight: 100 }], marketPrice: 850 };
const EXPECT = {
  dcf: ['Cover', 'Inputs', 'DCF', 'WACC'],
  lbo: ['Cover', 'Inputs', 'Projection', 'LBO'],
  ipo: ['Cover', 'Inputs', 'Projection', '3 Statement', 'IPO'],
  ts: ['Cover', 'Inputs', 'Projection', '3 Statement'],
  ratios: ['Cover', 'Inputs', 'Projection', '3 Statement'],
  combined: ['Cover', 'Combined'],
};
/** Inputs-sheet labels that must NOT appear in a method's file (another method's inputs). */
const FOREIGN = {
  dcf: ['Entry EV / LTM EBITDA', 'Pricing basis ("pe" or "evEbitda")', 'LTM EBIT', "Opening shareholders' equity (reported)"],
  lbo: ['WACC', 'Terminal growth rate', 'Pricing basis ("pe" or "evEbitda")', 'Interest rate on debt'],
  ipo: ['WACC', 'Entry EV / LTM EBITDA', 'Opening net PP&E'],
  ts: ['WACC', 'Entry EV / LTM EBITDA', 'Primary raise (fresh capital)'],
  ratios: ['WACC', 'Sponsor IRR hurdle', 'Offer P/E'],
  comps: ['Tax rate', 'WACC', 'Opening net working capital', 'Projection years', 'Opening tax-loss carryforward (NOL)', 'Valuation date'],
  precedent: ['Tax rate', 'WACC', 'LTM EBIT', 'Projection years', 'Share price date'],
};

function* extractRefs(formula) {
  const re1 = /'((?:[^']|'')+)'!(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/g;
  const re2 = /\b([A-Za-z][A-Za-z0-9_]*)!(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/g;
  let f = formula.replace(/"[^"]*"/g, '""');          // drop string literals
  let m;
  const src = f;
  while ((m = re1.exec(src))) yield { sheet: m[1].replace(/''/g, "'"), a: m[2], b: m[3] };
  f = f.replace(re1, ' ');
  const src2 = f;
  while ((m = re2.exec(src2))) yield { sheet: m[1], a: m[2], b: m[3] };
  f = f.replace(re2, ' ');
  f = f.replace(/[A-Z][A-Z0-9.]*\(/g, '(');
  const re3 = /(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/g;
  while ((m = re3.exec(f))) yield { sheet: null, a: m[1], b: m[2] };
}
const norm = (addr) => addr.replace(/\$/g, '');

async function checkFile(a, method, opts = {}, expect = EXPECT[method]) {
  const wb = buildWorkbook(a, method, { ...opts, combined: COMBINED });
  ok(wb.calcProperties?.fullCalcOnLoad, `${method}: fullCalcOnLoad`);
  const buf = await wb.xlsx.writeBuffer();
  const rb = new ExcelJS.Workbook();
  await rb.xlsx.load(buf);
  const names = rb.worksheets.map((w) => w.name);
  if (expect) ok(names.join('|') === expect.join('|'), `${method}: sheets [${names.join(', ')}]`);
  const template = method === 'comps' || method === 'precedent';
  ok(names[0] === (template ? 'Instructions' : 'Cover'), `${method}: ${template ? 'Instructions' : 'Cover'} first`);
  if (method !== 'combined') ok(names[1] === 'Inputs', `${method}: Inputs second`);
  ok(!names.includes('Assumptions') && !names.includes('Summary'), `${method}: no legacy Assumptions / Summary sheet`);

  const sheets = Object.fromEntries(rb.worksheets.map((w) => [w.name, w]));
  // Inputs: only this method's inputs, all blue
  if (sheets.Inputs) {
    const labels = [];
    sheets.Inputs.eachRow((row) => { const v = row.getCell(1).value; if (typeof v === 'string') labels.push(v.trim()); });
    for (const bad of FOREIGN[method] || []) ok(!labels.includes(bad.trim()), `${method}: Inputs has no foreign input "${bad}"`);
    let blue = 0;
    sheets.Inputs.eachRow((row) => {
      for (const c of [row.getCell(2), row.getCell(3)]) {
        const isBlue = template ? c.font?.color?.argb === 'FF0000FF' && c.fill?.fgColor?.argb === 'FFFFF2CC' : c.font?.color?.argb === C_INPUT;
        if (c.value !== null && c.value !== undefined && !(c.value && c.value.formula) && isBlue) blue++;
      }
    });
    ok(blue >= 5, `${method}: Inputs carries blue input cells (${blue})`);
  }

  let nFormulas = 0;
  rb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (typeof v === 'number') ok(Number.isFinite(v), `${method}: ${ws.name}!${cell.address} holds ${v}`);
        const f = cell.formula || (v && v.formula);
        if (!f) return;
        nFormulas++;
        const bare = f.replace(/"[^"]*"/g, '""');
        ok((bare.match(/\(/g) || []).length === (bare.match(/\)/g) || []).length, `${method}: ${ws.name}!${cell.address} parens balance`);
        for (const ref of extractRefs(f)) {
          const target = ref.sheet ? sheets[ref.sheet] : ws;
          ok(!!target, `${method}: ${ws.name}!${cell.address} → unknown sheet '${ref.sheet}'`);
          if (!target || !ref.sheet || ref.b) continue;
          const c = target.getCell(norm(ref.a));
          ok(c.value !== null && c.value !== undefined, `${method}: ${ws.name}!${cell.address} → ${ref.sheet}!${norm(ref.a)} is empty`);
        }
      });
    });
  });
  ok(nFormulas > (method === 'combined' ? 3 : 40), `${method}: live formulas (${nFormulas})`);
  return { names, nFormulas, kb: buf.byteLength / 1024 };
}

for (const m of EXPORT_METHODS) {
  const r = await checkFile(A, m);
  console.log(`${m.padEnd(9)} ${r.names.length} sheets, ${r.nFormulas} formulas, ${r.kb.toFixed(0)} KB`);
}

// optional steps change the sheet set
{
  const noFcfe = buildWorkbook(A, 'dcf', { skipped: { fcfe: true } });
  const labels = [];
  noFcfe.getWorksheet('Inputs').eachRow((row) => labels.push(String(row.getCell(1).value || '')));
  ok(!labels.includes('Exit P/E multiple (FCFE)') && !labels.some((l) => l.startsWith('Cost of equity step')), 'dcf without FCFE: no FCFE inputs');
  const noReg = buildWorkbook(A, 'comps', { skipped: { regression: true } });
  ok(!noReg.worksheets.some((w) => w.name === 'Regression'), 'comps without regression: no Regression sheet');
  ok(buildWorkbook(A, 'comps', {}).worksheets.some((w) => w.name === 'Regression'), 'comps with regression: Regression sheet');
  const hist = withModel({ history: { source: 'manual', label: 'typed', annual: { dates: ['2023-12-31', '2024-12-31'], lines: { revenue: [4200, 4600] } }, quarterly: null, statements: null } });
  ok(buildWorkbook(hist, 'ratios', {}).worksheets.some((w) => w.name === 'Past Ratios'), 'ratios with history: Past Ratios sheet');
  ok(!buildWorkbook(hist, 'ratios', { skipped: { history: true } }).worksheets.some((w) => w.name === 'Past Ratios'), 'ratios with history skipped: no Past Ratios');
  await checkFile(hist, 'dcf');
  await checkFile(hist, 'ratios', {}, [...EXPECT.ratios, 'Past Ratios']);
  let threw = false;
  try { buildWorkbook(A, 'full'); } catch { threw = true; }
  ok(threw, 'an unknown method id is refused');
}

console.log(`excel: ${checks} checks, ${failures} failures`);
if (failures) process.exit(1);

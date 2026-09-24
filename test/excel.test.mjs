import { DEFAULT_ASSUMPTIONS as A } from '../src/lib/defaults.js';
import { buildWorkbook, EXPORT_METHODS, resolveSheets } from '../src/lib/excel/exportExcel.js';
import ExcelJS from 'exceljs';
import fs from 'node:fs';

const OUT = '/tmp/valuation_studio_test.xlsx';

let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL:', msg); };

const wb = buildWorkbook(A);
if (!wb.calcProperties?.fullCalcOnLoad) fail('fullCalcOnLoad not set');
await wb.xlsx.writeFile(OUT);

// re-read the file we actually produced
const rb = new ExcelJS.Workbook();
await rb.xlsx.readFile(OUT);

const sheets = {};
rb.eachSheet((ws) => { sheets[ws.name] = ws; });
const expectSheets = ['Cover', 'Assumptions', 'DCF', '3 Statement', 'LBO', 'Benchmarking 1', 'Benchmarking 2', 'Comps Analysis', 'Implied Valuation', 'List', 'Regression', 'Precedent', 'IPO', 'Summary'];
for (const s of expectSheets) if (!sheets[s]) fail(`missing sheet ${s}`);

function cellHasContent(ws, addr) {
  const c = ws.getCell(addr);
  return c.value !== null && c.value !== undefined;
}

function* extractRefs(formula) {
  // quoted sheet refs: '3 Statement'!$B$5 or ranges
  const re1 = /'([^']+)'!(\$?[A-Z]{1,2}\$?\d+)(?::(\$?[A-Z]{1,2}\$?\d+))?/g;
  // unquoted sheet refs: DCF!C5
  const re2 = /\b([A-Za-z][A-Za-z0-9_]*)!(\$?[A-Z]{1,2}\$?\d+)(?::(\$?[A-Z]{1,2}\$?\d+))?/g;
  let f = formula;
  let m;
  while ((m = re1.exec(formula))) yield { sheet: m[1], a: m[2], b: m[3] };
  f = f.replace(re1, ' ');
  while ((m = re2.exec(f))) yield { sheet: m[1], a: m[2], b: m[3] };
  f = f.replace(re2, ' ');
  // local refs (strip function names: letters followed by '(' )
  f = f.replace(/[A-Z][A-Z0-9.]*\(/g, '(');
  const re3 = /(\$?[A-Z]{1,2}\$?\d+)(?::(\$?[A-Z]{1,2}\$?\d+))?/g;
  while ((m = re3.exec(f))) yield { sheet: null, a: m[1], b: m[2] };
}

const norm = (addr) => addr.replace(/\$/g, '');

let nFormulas = 0, nRefs = 0;
rb.eachSheet((ws) => {
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const f = cell.formula || (cell.value && cell.value.formula);
      if (!f) return;
      nFormulas++;
      const open = (f.match(/\(/g) || []).length;
      const close = (f.match(/\)/g) || []).length;
      if (open !== close) fail(`${ws.name}!${cell.address}: unbalanced parens in =${f}`);
      for (const ref of extractRefs(f)) {
        nRefs++;
        const target = ref.sheet ? sheets[ref.sheet] : ws;
        if (!target) { fail(`${ws.name}!${cell.address}: unknown sheet '${ref.sheet}' in =${f}`); continue; }
        for (const addr of [ref.a, ref.b].filter(Boolean)) {
          if (!cellHasContent(target, norm(addr))) {
            fail(`${ws.name}!${cell.address}: ref ${ref.sheet || ws.name}!${norm(addr)} is EMPTY in =${f}`);
          }
        }
      }
    });
  });
});

// spot-checks: key cells exist and are formulas
const mustBeFormula = [
  ['Summary', 'B'],
];
const sm = sheets['Summary'];
let smFormulas = 0;
sm.eachRow({ includeEmpty: false }, (row) => row.eachCell((c) => { if (c.formula || c.value?.formula) smFormulas++; }));
if (smFormulas < 15) fail(`Summary has only ${smFormulas} formulas`);

// single-method exports: right sheets present, and no formula references a removed sheet
for (const [method, def] of Object.entries(EXPORT_METHODS)) {
  if (!def.sheets) continue;
  const mwb = buildWorkbook(A, method);
  const expected = resolveSheets(def, A);
  const names = [...mwb.worksheets].sort((x, y) => x.orderNo - y.orderNo).map((ws) => ws.name);
  if (names.join('|') !== expected.join('|')) fail(`${method} export sheets: got [${names}] expected [${expected}]`);
  const present = new Set(names);
  mwb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const f = cell.formula || (cell.value && cell.value.formula);
        if (!f) return;
        for (const ref of extractRefs(f)) {
          if (ref.sheet && !present.has(ref.sheet)) fail(`${method} export: ${ws.name}!${cell.address} refs removed sheet '${ref.sheet}'`);
        }
      });
    });
  });
}
console.log(`method exports OK: ${Object.keys(EXPORT_METHODS).filter((k) => EXPORT_METHODS[k].sheets).join(', ')}`);

// regression export with y = P/E must carry 3 Statement (NTM net income link) — and only then
{
  const aPe = structuredClone(A);
  aPe.regression = { ...aPe.regression, yVar: 'pe' };
  const names = buildWorkbook(aPe, 'reg').worksheets.map((ws) => ws.name);
  if (!names.includes('3 Statement')) fail(`reg(pe) export missing 3 Statement: [${names}]`);
  const namesDefault = buildWorkbook(A, 'reg').worksheets.map((ws) => ws.name);
  if (namesDefault.includes('3 Statement')) fail(`reg(evEbitda) export should not carry 3 Statement: [${namesDefault}]`);
}

const stats = fs.statSync(OUT);
console.log(`workbook: ${expectSheets.length} sheets, ${nFormulas} formulas, ${nRefs} refs checked, ${(stats.size / 1024).toFixed(0)} KB`);
console.log(failures ? `${failures} FAILURES` : 'EXCEL STRUCTURE OK');
process.exit(failures ? 1 : 0);

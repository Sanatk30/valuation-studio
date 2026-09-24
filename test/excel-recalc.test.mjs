/**
 * Numerically recalculate the exported workbook with HyperFormula and compare
 * key outputs against the JS engines. Cells using functions HyperFormula
 * lacks (#NAME?) are reported separately and excluded from the failure count.
 */
import { DEFAULT_ASSUMPTIONS as A } from '../src/lib/defaults.js';
import { buildWorkbook } from '../src/lib/excel/exportExcel.js';
import { computeDcf, dcfSensitivity, dcfHistory } from '../src/lib/engine/dcf.js';
import { computeThreeStatement } from '../src/lib/engine/threeStatement.js';
import { computeLbo, lboHoldSensitivity } from '../src/lib/engine/lbo.js';
import { computeComps } from '../src/lib/engine/comps.js';
import { computeRegression } from '../src/lib/engine/regression.js';
import { computePrecedent } from '../src/lib/engine/precedent.js';
import { computeIpo } from '../src/lib/engine/ipo.js';
import { HyperFormula } from 'hyperformula';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };
const rel = (x, y) => Math.abs(x - y) / Math.max(1e-9, Math.abs(y));

const wb = buildWorkbook(A);

const hfSheets = {};
wb.eachSheet((ws) => {
  const grid = [];
  ws.eachRow({ includeEmpty: true }, (row, rn) => {
    while (grid.length < rn - 1) grid.push([]);
    const arr = [];
    row.eachCell({ includeEmpty: true }, (cell, cn) => {
      while (arr.length < cn - 1) arr.push(null);
      let v = cell.value;
      if (v && typeof v === 'object' && v.formula) v = '=' + v.formula;
      arr.push(v === undefined ? null : v);
    });
    grid.push(arr);
  });
  hfSheets[ws.name] = grid;
});

const hf = HyperFormula.buildFromSheets(hfSheets, {
  licenseKey: 'gpl-v3',
  useArrayArithmetic: true,
  smartRounding: false,
});

function colNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function get(sheet, addr) {
  const m = addr.match(/^([A-Z]+)(\d+)$/);
  return hf.getCellValue({ sheet: hf.getSheetId(sheet), col: colNum(m[1]) - 1, row: parseInt(m[2]) - 1 });
}
function findRow(sheet, label, labelCol = 'A') {
  const sid = hf.getSheetId(sheet);
  const { height } = hf.getSheetDimensions(sid);
  const c0 = colNum(labelCol) - 1;
  for (let r0 = 0; r0 < height; r0++) {
    const v = hf.getCellValue({ sheet: sid, col: c0, row: r0 });
    if (typeof v === 'string' && v.trim() === label) return r0 + 1;
  }
  return -1;
}
/** Last row whose label column equals `label` — banners repeat their text
 *  across the merged span, so a total row has to be matched from the bottom. */
function findRowLast(sheet, label, labelCol = 'A') {
  const sid = hf.getSheetId(sheet);
  const { height } = hf.getSheetDimensions(sid);
  const c0 = colNum(labelCol) - 1;
  let found = -1;
  for (let r0 = 0; r0 < height; r0++) {
    const v = hf.getCellValue({ sheet: sid, col: c0, row: r0 });
    if (typeof v === 'string' && v.trim() === label) found = r0 + 1;
  }
  return found;
}
/** All rows on a sheet whose label column starts with `prefix`. */
function findRows(sheet, prefix, labelCol = 'A') {
  const sid = hf.getSheetId(sheet);
  const { height } = hf.getSheetDimensions(sid);
  const c0 = colNum(labelCol) - 1;
  const out = [];
  for (let r0 = 0; r0 < height; r0++) {
    const v = hf.getCellValue({ sheet: sid, col: c0, row: r0 });
    if (typeof v === 'string' && v.startsWith(prefix)) out.push(r0 + 1);
  }
  return out;
}

// evaluation errors
let nameErrs = 0, hardErrs = [];
for (const name of Object.keys(hfSheets)) {
  const sid = hf.getSheetId(name);
  const { height, width } = hf.getSheetDimensions(sid);
  for (let r0 = 0; r0 < height; r0++) {
    for (let c0 = 0; c0 < width; c0++) {
      const v = hf.getCellValue({ sheet: sid, col: c0, row: r0 });
      if (v && typeof v === 'object' && v.type) {
        const f = hf.getCellFormula({ sheet: sid, col: c0, row: r0 }) || '';
        if (String(v.value).includes('NAME') || v.type === 'NAME') nameErrs++;
        else hardErrs.push({ sheet: name, r: r0 + 1, c: c0 + 1, err: v.value || v.type, f });
      }
    }
  }
}
console.log(`evaluation errors: ${hardErrs.length} hard, ${nameErrs} #NAME (functions HyperFormula lacks)`);
for (const e of hardErrs.slice(0, 12)) console.log('   err:', e.sheet, `r${e.r}c${e.c}`, e.err, '=', e.f.slice(0, 100));
ok(hardErrs.length === 0, 'no hard evaluation errors');

// ---- engines ----
const dcf = computeDcf(A);
const sens = dcfSensitivity(A);
const ts = computeThreeStatement(A);
const lbo = computeLbo(A);
const hsens = lboHoldSensitivity(A);
const comps = computeComps(A);
const reg = computeRegression(A);
const prec = computePrecedent(A);
const ipo = computeIpo(A);

// ---- DCF (3E layout: labels in column B) ----
// unlevered block: implied share price at I (perpetuity growth) and J (exit multiple)
const priceRow = findRow('DCF', 'Implied Share Price', 'G');
ok(rel(get('DCF', `I${priceRow}`), dcf.gordon.price) < 1e-9, `DCF FCFF gordon: xl=${get('DCF', `I${priceRow}`)?.toFixed?.(2)} eng=${dcf.gordon.price.toFixed(2)}`);
ok(rel(get('DCF', `J${priceRow}`), dcf.exit.price) < 1e-9, 'DCF FCFF exit price matches');
// levered block below: D (perpetuity growth) and E (exit P/E)
const fcfePriceRow = findRow('DCF', 'Implied Share Price', 'B');
ok(rel(get('DCF', `D${fcfePriceRow}`), dcf.fcfeGordon.price) < 1e-9, `DCF FCFE gordon: xl=${get('DCF', `D${fcfePriceRow}`)?.toFixed?.(2)} eng=${dcf.fcfeGordon.price.toFixed(2)}`);
ok(rel(get('DCF', `E${fcfePriceRow}`), dcf.fcfeExit.price) < 1e-9, 'DCF FCFE exit-P/E price matches');

// enterprise value, both terminal-value methods
const evRow = findRowLast('DCF', 'Enterprise Value', 'B');
ok(rel(get('DCF', `D${evRow}`), dcf.gordon.ev) < 1e-9, 'DCF enterprise value (perpetuity growth) matches');
ok(rel(get('DCF', `E${evRow}`), dcf.exit.ev) < 1e-9, 'DCF enterprise value (exit multiple) matches');

// the back-cast historical columns reproduce engine dcfHistory() exactly
{
  const hist = dcfHistory(A, 3);
  const salesRow = findRow('DCF', 'Sales', 'B');
  const ebitdaRow = findRow('DCF', 'EBITDA', 'B');
  let histOk = true;
  for (let i = 0; i < hist.n; i++) {
    const col = String.fromCharCode(67 + i);          // C, D, E
    if (rel(get('DCF', `${col}${salesRow}`), hist.revenue[i]) > 1e-9) histOk = false;
    if (rel(get('DCF', `${col}${ebitdaRow}`), hist.ebitda[i]) > 1e-9) histOk = false;
  }
  ok(histOk, `DCF: ${hist.n} back-cast historical columns match the engine`);
  // the LTM column is the model's own Year 0, so it ties to the LBO entry EBITDA
  ok(rel(get('DCF', `G${salesRow}`), A.drivers.revenue0) < 1e-9, 'DCF LTM sales = base-year revenue');
  ok(rel(get('DCF', `G${ebitdaRow}`), dcf.ops.ebitda0) < 1e-9, 'DCF LTM EBITDA = ops.ebitda0 (ties to the LBO)');
}

// terminal-value cross-check carries the mid-year gross-up
{
  const gRow = findRow('DCF', 'Exit-multiple TV → implied perpetuity growth', 'B');
  ok(rel(get('DCF', `E${gRow}`) * 100, dcf.impliedPerpGrowth) < 1e-9,
    `implied perpetuity growth: xl=${(get('DCF', `E${gRow}`) * 100).toFixed(4)} eng=${dcf.impliedPerpGrowth.toFixed(4)}`);
}

// levered beta via Hamada on Assumptions
const betaRow = findRow('Assumptions', 'Levered beta βL (Hamada)');
ok(rel(get('Assumptions', `B${betaRow}`), dcf.leveredBeta) < 1e-9, `Hamada beta: xl=${get('Assumptions', `B${betaRow}`)?.toFixed?.(4)} eng=${dcf.leveredBeta.toFixed(4)}`);
const coeRow = findRow('Assumptions', 'Cost of equity (CAPM)');
ok(rel(get('Assumptions', `B${coeRow}`) * 100, dcf.costEquity) < 1e-9, 'CoE matches');

// sensitivity grids: centers
// grids sit two across: left block labelled in B (values C..G), right block in I (values J..N)
const leftGrids = findRows('DCF', 'SENSITIVITY', 'B');
const rightGrids = findRows('DCF', 'SENSITIVITY', 'I');
ok(leftGrids.length === 3, `DCF: three left-hand sensitivity grids (got ${leftGrids.length})`);
ok(rightGrids.length === 2, `DCF: two right-hand sensitivity grids (got ${rightGrids.length})`);
ok(rel(get('DCF', `E${leftGrids[0] + 4}`), sens.gordonGrid[2][2]) < 1e-9, 'FCFF gordon grid center = base');
ok(rel(get('DCF', `L${rightGrids[0] + 4}`), sens.exitGrid[2][2]) < 1e-9, 'FCFF exit grid center = base');
ok(rel(get('DCF', `E${leftGrids[2] + 4}`), sens.fcfeGrid[2][2]) < 1e-9, 'FCFE grid center = base');
// the implied-perpetuity-growth grid centre is the same cross-check as above
ok(rel(get('DCF', `E${leftGrids[1] + 4}`) * 100, dcf.impliedPerpGrowth) < 1e-9, 'implied perpetuity-growth grid center = the cross-check');

// ---- WACC sheet ----
{
  const wRow = findRow('WACC', 'WACC', 'B');
  ok(rel(get('WACC', `D${wRow}`) * 100, dcf.wacc) < 1e-9, `WACC page rebuilds the discount rate: xl=${(get('WACC', `D${wRow}`) * 100).toFixed(4)} eng=${dcf.wacc.toFixed(4)}`);
  const cRow = findRow('WACC', 'Cost of Equity (CAPM)', 'B');
  ok(rel(get('WACC', `D${cRow}`) * 100, dcf.costEquity) < 1e-9, 'WACC page cost of equity matches');
}

// ---- 3 Statement ----
const niRow = findRow('3 Statement', 'Net income');
const checkRow = findRow('3 Statement', 'Balance check (must be 0)');
let ts3ok = true;
for (let i = 0; i < ts.ops.n; i++) {
  const col = String.fromCharCode(67 + i);
  if (rel(get('3 Statement', `${col}${niRow}`), ts.netIncome[i]) > 1e-9) ts3ok = false;
  if (Math.abs(get('3 Statement', `${col}${checkRow}`)) > 1e-6) ts3ok = false;
}
ok(ts3ok, `3S: NI matches and balance ties for all ${ts.ops.n} years`);

// ---- LBO ----
ok(rel(get('LBO', `B${findRow('LBO', 'Sponsor equity (plug)')}`), lbo.sponsorEquity) < 1e-9, 'LBO sponsor equity matches');
ok(rel(get('LBO', `B${findRow('LBO', 'MOIC')}`), lbo.moic) < 1e-9, `LBO MOIC: xl=${get('LBO', `B${findRow('LBO', 'MOIC')}`)?.toFixed?.(4)} eng=${lbo.moic.toFixed(4)}`);
ok(rel(get('LBO', `B${findRow('LBO', 'IRR (no interim distributions)')}`) * 100, lbo.irr) < 1e-9, `LBO IRR: ${lbo.irr.toFixed(2)}%`);
const irrXl = get('LBO', `B${findRow('LBO', 'IRR (Excel IRR on equity CF)')}`);
ok(Math.abs(irrXl * 100 - lbo.irr) < 0.05, `LBO IRR() cross-check: ${(irrXl * 100).toFixed(2)}%`);
ok(rel(get('LBO', `B${findRow('LBO', 'Net debt at exit')}`), lbo.netDebtExit) < 1e-9, 'LBO net debt at exit matches');
ok(rel(get('LBO', `B${findRow('LBO', 'Exit equity (check)')}`), lbo.exitEquity) < 1e-9, 'LBO value-creation bridge check = exit equity');
ok(rel(get('LBO', `B${findRow('LBO', 'Implied max offer price per share')}`), lbo.floorPrice) < 1e-9, `LBO floor price: xl=${get('LBO', `B${findRow('LBO', 'Implied max offer price per share')}`)?.toFixed?.(2)} eng=${lbo.floorPrice.toFixed(2)}`);
// hold x exit grid center
const lboSensRows = [];
{
  const sid = hf.getSheetId('LBO');
  const { height } = hf.getSheetDimensions(sid);
  for (let r0 = 0; r0 < height; r0++) {
    const v = hf.getCellValue({ sheet: sid, col: 0, row: r0 });
    if (typeof v === 'string' && v.startsWith('SENSITIVITY')) lboSensRows.push(r0 + 1);
  }
}
ok(lboSensRows.length === 2, 'LBO: two sensitivity grids');
ok(rel(get('LBO', `D${lboSensRows[0] + 4}`) * 100, lbo.irr) < 1e-9, 'LBO entry x exit grid center = base IRR');
const holdCenterRow = lboSensRows[1] + 2 + hsens.years.indexOf(lbo.exitYear);
ok(rel(get('LBO', `D${holdCenterRow}`) * 100, lbo.irr) < 1e-9, 'LBO hold x exit grid center = base IRR');

// PIK variant workbook
{
  const aPik = structuredClone(A);
  aPik.lbo.mezzPIK = true;
  const wb2 = buildWorkbook(aPik);
  const sheets2 = {};
  wb2.eachSheet((ws) => {
    const grid = [];
    ws.eachRow({ includeEmpty: true }, (row, rn) => {
      while (grid.length < rn - 1) grid.push([]);
      const arr = [];
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        while (arr.length < cn - 1) arr.push(null);
        let v = cell.value;
        if (v && typeof v === 'object' && v.formula) v = '=' + v.formula;
        arr.push(v === undefined ? null : v);
      });
      grid.push(arr);
    });
    sheets2[ws.name] = grid;
  });
  const hf2 = HyperFormula.buildFromSheets(sheets2, { licenseKey: 'gpl-v3', useArrayArithmetic: true, smartRounding: false });
  const lboPik = computeLbo(aPik);
  const sid2 = hf2.getSheetId('LBO');
  const { height } = hf2.getSheetDimensions(sid2);
  let moicRow2 = -1;
  for (let r0 = 0; r0 < height; r0++) {
    const v = hf2.getCellValue({ sheet: sid2, col: 0, row: r0 });
    if (v === 'MOIC') { moicRow2 = r0; break; }
  }
  const xlMoic2 = hf2.getCellValue({ sheet: sid2, col: 1, row: moicRow2 });
  ok(rel(xlMoic2, lboPik.moic) < 1e-9, `LBO PIK variant MOIC: xl=${xlMoic2?.toFixed?.(4)} eng=${lboPik.moic.toFixed(4)}`);
}

// ---- Comps ----
// The comps package is verified exhaustively in comps.test.mjs (every company
// page and every benchmarking cell); here we just confirm the implied-price
// block on the output page still ties to the engine.
{
  const sid = hf.getSheetId('Implied Valuation');
  const { height } = hf.getSheetDimensions(sid);
  const lastRowIn = (label) => {
    let last = -1;
    for (let r0 = 0; r0 < height; r0++) if (hf.getCellValue({ sheet: sid, col: 1, row: r0 }) === label) last = r0;
    return last;
  };
  for (const [i, label] of [[0, 'EV / Sales'], [1, 'EV / EBITDA'], [2, 'P / E']]) {
    const r0 = lastRowIn(label);
    ok(r0 >= 0, `Implied Valuation has an implied-price row for ${label}`);
    if (r0 < 0) continue;
    const mid = hf.getCellValue({ sheet: sid, col: 3, row: r0 });
    ok(rel(mid, comps.rows[i].impliedMedian) < 1e-9, `Comps ${label} median implied price matches`);
  }
}

// ---- Regression workbench sheet (Gauss-Jordan solve, live formulas) ----
{
  const { runRegression } = await import('../src/lib/engine/regressionModel.js');
  const RW = runRegression(A);
  if (RW.fit?.ok) {
    ok(rel(get('Regression', `B${findRow('Regression', 'R²')}`), RW.fit.r2) < 1e-9, 'Regression sheet R² matches engine');
    ok(rel(get('Regression', `B${findRow('Regression', 'SE of regression')}`), RW.fit.seReg) < 1e-9, 'Regression sheet SE matches engine');
    const coHdr = findRow('Regression', 'Term');
    for (let i = 0; i < RW.fit.beta.length; i++) {
      ok(rel(get('Regression', `B${coHdr + 1 + i}`), RW.fit.beta[i]) < 1e-9, `Regression β${i} matches engine`);
      ok(rel(get('Regression', `C${coHdr + 1 + i}`), RW.fit.se[i]) < 1e-9, `Regression SE(β${i}) matches engine`);
    }
    const predRow = findRow('Regression', `Predicted ${RW.yDef.label}`);
    ok(rel(get('Regression', `B${predRow}`), RW.pred.yHat) < 1e-9, 'Regression prediction matches engine');
    if (RW.price) {
      ok(rel(get('Regression', `B${findRow('Regression', 'Implied share price')}`), RW.price.mid) < 1e-8, `Regression implied price: xl=${get('Regression', `B${findRow('Regression', 'Implied share price')}`)?.toFixed?.(2)} eng=${RW.price.mid.toFixed(2)}`);
    }
  }
}

const numOfP = (v) => (typeof v === 'number' ? v : NaN);
// ---- Precedent (bottom-up deal pages; labels in column B, median in D) ----
{
  const evRow = findRow('Precedent', 'EV / LTM EBITDA', 'B');
  ok(rel(get('Precedent', `D${evRow}`), prec.rows[1].impliedMedian) < 1e-9,
    `Precedent EV/EBITDA median implied: xl=${get('Precedent', `D${evRow}`)?.toFixed?.(2)} eng=${prec.rows[1].impliedMedian.toFixed(2)}`);
  const salesRow = findRow('Precedent', 'EV / LTM Sales', 'B');
  ok(rel(get('Precedent', `D${salesRow}`), prec.rows[0].impliedMedian) < 1e-9, 'Precedent EV/Sales median implied matches');
  const premRow = findRow('Precedent', 'Premia analysis (on the current share price)', 'B');
  ok(rel(get('Precedent', `D${premRow}`), prec.premia.impliedMedian) < 1e-9, 'Precedent premia implied matches');

  // every deal row on the output page links live to its own input page
  const sid = hf.getSheetId('Precedent');
  const { height, width } = hf.getSheetDimensions(sid);
  // locate each column by its header on the label row, rather than hardcoding
  const hcol = (label) => {
    for (let c0 = 0; c0 < width; c0++) {
      const v = hf.getCellValue({ sheet: sid, col: c0, row: 7 });
      if (typeof v === 'string' && v.trim() === label) return c0;
    }
    return -1;
  };
  let matched = 0;
  for (let r0 = 0; r0 < height; r0++) {
    const acq = hf.getCellValue({ sheet: sid, col: 2, row: r0 });   // column C = acquirer
    const d = prec.deals.find((x) => x.deal.acquirer === acq);
    if (!d) continue;
    matched++;
    const at = (c0) => numOfP(hf.getCellValue({ sheet: sid, col: c0, row: r0 }));
    if (rel(at(hcol('Equity Value')), d.equityValue) > 1e-7) { failures++; console.error(`FAIL: Precedent equity value ${acq}`); }
    if (rel(at(hcol('Enterprise Value')), d.enterpriseValue) > 1e-7) { failures++; console.error(`FAIL: Precedent EV ${acq}`); }
    if (rel(at(hcol('Sales')), d.evSales) > 1e-7) { failures++; console.error(`FAIL: Precedent EV/Sales ${acq}`); }
    if (rel(at(hcol('EBITDA')), d.evEbitda) > 1e-7) { failures++; console.error(`FAIL: Precedent EV/EBITDA ${acq}`); }
    if (rel(at(hcol('EBITDA Margin')), d.ebitdaMargin) > 1e-7) { failures++; console.error(`FAIL: Precedent EBITDA margin ${acq}`); }
  }
  ok(matched === prec.deals.length, `Precedent: all ${prec.deals.length} deal rows recalculate from their input pages (${matched} matched)`);
}

// ---- IPO ----
ok(rel(get('IPO', `B${findRow('IPO', 'OFFER PRICE')}`), ipo.offerPrice) < 1e-9, `IPO offer: xl=${get('IPO', `B${findRow('IPO', 'OFFER PRICE')}`)?.toFixed?.(2)} eng=${ipo.offerPrice.toFixed(2)}`);
ok(rel(get('IPO', `B${findRow('IPO', 'Post-IPO shares outstanding')}`), ipo.postShares) < 1e-9, 'IPO post shares match');
ok(rel(get('IPO', `B${findRow('IPO', 'Net debt post-IPO')}`), ipo.netDebtPost) < 1e-9, 'IPO net debt post matches');
ok(rel(get('IPO', `B${findRow('IPO', 'Market cap at offer (post-greenshoe)')}`), ipo.mktCapAtOffer) < 1e-9, 'IPO market cap matches');
ok(rel(get('IPO', `B${findRow('IPO', 'Uplift when the discount unwinds')}`) * 100, ipo.uplift) < 1e-9, 'IPO uplift matches');
ok(rel(get('IPO', `B${findRow('IPO', 'NTM EPS post-IPO')}`), ipo.epsPost) < 1e-9, 'IPO pro-forma EPS matches');

// ---- Summary football field ----
const sgRow = findRow('Summary', 'DCF — FCFF Gordon');
ok(rel(get('Summary', `C${sgRow}`), dcf.gordon.price) < 1e-9, 'Summary FCFF gordon mid matches');
ok(rel(get('Summary', `B${sgRow}`), Math.min(...sens.gordonGrid.flat())) < 1e-9, 'Summary FCFF low = grid min');
const feRow = findRow('Summary', 'DCF — FCFE @ CoE');
ok(rel(get('Summary', `C${feRow}`), dcf.fcfeGordon.price) < 1e-9, 'Summary FCFE mid matches');
const lfRow = findRow('Summary', 'LBO floor (hurdle ±2.5%)');
ok(rel(get('Summary', `C${lfRow}`), lbo.floorPrice) < 1e-9, 'Summary LBO floor mid matches');
ok(rel(get('Summary', `B${lfRow}`), lbo.floorAt(A.lbo.hurdleRate + 2.5)) < 1e-9, 'Summary LBO floor low = hurdle+2.5%');
const ipRow = findRow('Summary', 'IPO — offer → fair');
ok(rel(get('Summary', `C${ipRow}`), ipo.offerPrice) < 1e-9, 'Summary IPO mid = offer');
ok(rel(get('Summary', `D${ipRow}`), ipo.fairPricePost) < 1e-9, 'Summary IPO high = fair post');

console.log(failures ? `\n${failures} FAILURES` : '\nEXCEL RECALC MATCHES ENGINES');
process.exit(failures ? 1 : 0);

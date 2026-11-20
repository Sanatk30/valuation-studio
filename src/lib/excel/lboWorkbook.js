/**
 * The LBO workbook, laid out like the user's three LBO templates
 * (LBO_Mandatory_Repayment_Only, LBO_Mandatory_Plus_CashSweep,
 * LBO_CashSweep_Only):
 *
 *   Instructions · Inputs · Sources & Uses · Returns · Sensitivity ·
 *   LBO Model · Historicals · Assumptions · Sensitivity Engine
 *
 * for the chosen repayment type and N historical / M holding-period years
 * (template: 3 and 5 — at those sizes every cell sits where the template has
 * it). Every derived cell is the template's live formula; inputs are blue on
 * cream. The Sensitivity Engine repeats the LBO Model five times, each with
 * every forecast year's revenue growth shifted by a multiple of the step.
 */
import ExcelJS from 'exceljs';
import { computeLboT, LBO_DRIVERS, repayKind } from '../engine/lboTemplate.js';
import { colL } from './xlsxUtil.js';
import { T, NF, w, fx, title, note, hdr } from './templateXlsx.js';
import { unitNames, writeHistoricals, writeAssumptions } from './dcfWorkbook.js';

const KEY = 'FFEAF1DD';                 // the templates' key-result fill (Free Cash Flow, exit equity, MOIC, IRR)
const RED = 'FFC00000';
const NFM = '0.00x';                    // MOIC
const NFG = '+0.0%;-0.0%;0.0%';         // growth shift headers
const NFT = '0.0';                      // tenor (years)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : null);
const pc = (v) => (isNum(v) ? v / 100 : null);
const KS = [-2, -1, 0, 1, 2];
const TYPE_NAME = { mandatory: 'Mandatory Repayment Only', both: 'Mandatory Repayment + Cash Sweep', sweep: 'Cash Sweep Only' };

export function buildLboWorkbook(a) {
  const r = computeLboT(a);
  const d = a.lbo;
  const { n, m, repay } = r;
  const sweepOn = repay !== 'mandatory';
  const { sym, unitShort, unitLabel, unit } = unitNames(a);
  const ENG = "'Sensitivity Engine'";
  const MOD = "'LBO Model'";
  const SU = "'Sources & Uses'";

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Quant Value';
  wb.calcProperties = { fullCalcOnLoad: true };

  /* ---------------- Inputs rows (template: 3 + 5 years; later rows shift with the period count) ---------------- */
  const dl = n + m - 8;
  const IN = {
    name: 5, lease: 6, label: (k) => 9 + k,
    entryHead: 18 + dl, ebitda: 19 + dl, entryMult: 20 + dl, ev: 21 + dl,
    bsHead: 23 + dl, borrow: 24 + dl, leases: 25 + dl, cash: 26 + dl, nci: 27 + dl, eqPrice: 28 + dl,
    cashUsed: 29 + dl, feePct: 30 + dl, fees: 31 + dl,
    debtHead: 33 + dl, trHead: 34 + dl, senA: 35 + dl, senB: 36 + dl, mezz: 37 + dl, total: 38 + dl, trEg: 39 + dl,
    cashHead: 41 + dl, sweep: 42 + dl, minCash: 43 + dl, rcf: 44 + dl, rcfRate: 45 + dl, rcfFee: 46 + dl,
  };
  IN.exitHead = 48 + dl;
  IN.exitMult = IN.exitHead + 1;
  IN.stepHead = IN.exitHead + 3;
  IN.exitStep = IN.stepHead + 1;
  IN.entryStep = IN.stepHead + 2;
  IN.growthStep = IN.stepHead + 3;
  const inB = (row) => `Inputs!$B$${row}`;
  const label = (k) => inB(IN.label(k));

  /* ---------------- LBO Model rows ---------------- */
  const R = {
    rev: 7, growth: 8, materials: 9, employee: 10, otherExp: 11, ebitda: 12, margin: 13, da: 14, ebit: 15,
    intA: 16, intB: 17, intM: 18, intR: 19, pik: 20, fee: 21, pbt: 22, tax: 23, ni: 24,
    inv: 26, rec: 27, oca: 28, pay: 29, ocl: 30, nwc: 31, dNwc: 32, capex: 33,
    fNi: 35, fDa: 36, fPik: 37, fFee: 38, fCapex: 39, fNwc: 40, fLease: 41, fcf: 42, cashTitle: 44,
    cashOpen: 45, cashFcf: 46, cashMand: 47, cashAfter: 48, rDraw: 49, rRepay: 50, minCash: 51, avail: 52, cashSweep: 53, cashClose: 54,
    rHead: 55, rOpen: 56, rDraw2: 57, rRepay2: 58, rClose: 59, rUndrawn: 60,
    aHead: 61, aOpen: 62, aMand: 63, aSweep: 64, aClose: 65,
    bHead: 66, bOpen: 67, bMand: 68, bSweep: 69, bClose: 70,
    mHead: 71, mOpen: 72, mPik: 73, mClose: 74,
    credit: 75, totalDebt: 76, leaseRow: 77, nd: 78, dE: 79, ndE: 80, cover: 81, repaid: 82, shortfall: 83, headroom: 84,
  };
  const LAST = R.headroom;
  const X = (k) => colL(2 + k);            // model column k: 0…n−1 actual (n−1 = entry), n…n+m−1 the hold
  const E0 = X(n - 1);                     // entry column (Year 0)
  const XL = X(n + m - 1);                 // exit column (Year m)
  const blockBase = (k) => 4 + k * LAST;                // Sensitivity Engine: first row of case k (0…4), as the revised template
  const engRow = (row, k) => row + 1 + k * LAST;        // Sensitivity Engine row of an LBO Model row

  /* ============================== Instructions ============================== */
  {
    const ws = wb.addWorksheet('Instructions');
    ws.getColumn(1).width = 3; ws.getColumn(2).width = 34; ws.getColumn(3).width = 110;
    title(ws, 'B1', `LBO Model – ${TYPE_NAME[repay]}`);
    note(ws, 'B2', `All amounts in ${unitLabel} unless stated. ${m}-year hold: entry at the end of the latest actual year, exit at the end of forecast Year ${m}.`);
    w(ws, 'B4', 'Colour legend', { bold: true });
    w(ws, 'B5', 'Blue text, cream fill', { input: true }); w(ws, 'C5', 'Input – type your data here');
    w(ws, 'B6', 'Black text'); w(ws, 'C6', 'Formula – do not overwrite');
    w(ws, 'B7', 'Green text', { link: true }); w(ws, 'C7', 'Link from another sheet – do not overwrite');
    w(ws, 'B8', 'Grey fill', { fill: T.na }); w(ws, 'C8', 'Not applicable');
    let row = 10;
    const head = (text) => { w(ws, `B${row++}`, text, { bold: true }); };
    const pair = ([k, v]) => { w(ws, `B${row}`, k, { bold: true }); w(ws, `C${row}`, v, { wrap: true }); row++; };
    head('Order of work');
    [
      ['1. Inputs', `Company name, period labels, entry multiple, fees, debt tranches (size, rates, amortisation, tenor, fees), ${sweepOn ? 'cash sweep %, minimum cash, revolver, ' : ''}exit multiple, sensitivity steps.`],
      ['2. Historicals', `${n} year${n === 1 ? '' : 's'} of consolidated P&L, balance sheet and cash flow (same layout as the CCA and DCF workbooks).`],
      ['3. Assumptions', `${m}-year operating drivers. Historical ratios on the left of each row as a guide.`],
      ['4. Sources & Uses', 'Calculated. Sponsor equity is the balancing figure. Check must show 0.'],
      ['5. LBO Model', 'Calculated: operating model, free cash flow, cash and debt schedule, credit statistics.'],
      ['6. Returns', 'Exit waterfall, IRR, MOIC and the value creation bridge.'],
      ['7. Sensitivity', 'IRR and MOIC tables: exit multiple vs revenue growth, and entry vs exit multiple.'],
      ['8. Sensitivity Engine', 'Re-runs the full model for five growth cases. Do not edit.'],
    ].forEach(pair);
    row++;
    head('Structure & conventions');
    [
      ['Debt repayment', repayKind(repay).note],
      ['Interest', "Calculated on each tranche's opening balance (no circular reference). Revolver: interest on the opening drawn balance plus a commitment fee on the opening undrawn amount."],
      ['Mezzanine', 'Cash interest plus PIK interest. PIK accrues to the mezzanine balance and is repaid at exit. Set either rate to 0% if not used.'],
      ['Fees', "Transaction (deal) fees are paid at entry and funded in Sources & Uses. Financing fees are also funded at entry and amortised straight-line over each tranche's tenor in the P&L (non-cash, tax-deductible)."],
      ['Entry price', 'Entry EV = Latest actual EBITDA × Entry multiple. Equity purchase price = Entry EV − Existing borrowings − Lease liabilities (per toggle) + Existing cash − NCI. Existing borrowings are refinanced.'],
      ['Leases & NCI', 'Lease liabilities and NCI are held constant at the latest balance sheet and deducted at entry and exit. Lease cash payments (Assumptions row 23) are deducted from free cash flow every year, because Ind AS 116 EBITDA excludes rent.'],
      ['Other income', 'Not forecast in the LBO (existing treasury income largely disappears once cash is used in the deal).'],
      ['IRR / MOIC', `Single sponsor investment at entry and single exit proceeds at the end of Year ${m}; no interim dividends.`],
      ['Shortfall check', 'A revolving credit facility (Inputs) draws automatically to keep cash at the minimum balance and is repaid first from excess cash. The model flags SHORTFALL only if the revolver is fully drawn and cash still goes negative.'],
    ].forEach(pair);
    row++;
    head('Value creation bridge');
    [
      ['EBITDA growth', '(Exit EBITDA − Entry EBITDA) × Exit multiple'],
      ['Multiple expansion', 'Entry EBITDA × (Exit multiple − Entry multiple)'],
      ['Net debt reduction', 'Net debt at entry (post-deal) − Net debt at exit. PIK accrual reduces this.'],
      ['Fees', 'Transaction + financing fees paid at entry are a cost to the sponsor.'],
      ['Check', 'EBITDA growth + Multiple expansion + Net debt reduction − Fees = Exit equity − Entry equity. These pairings add up exactly with no double counting.'],
    ].forEach(pair);
  }

  /* ============================== Inputs ============================== */
  {
    const ws = wb.addWorksheet('Inputs');
    [40, 13, 13, 13, 13, 15, 12, 13, 14, 60].forEach((wd, i) => { ws.getColumn(i + 1).width = wd; });
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3, topLeftCell: 'A4' }];
    title(ws, 'A1', 'Transaction Inputs');
    note(ws, 'A2', 'Fill cream cells. Grey notes give a format example.');
    const SUBI = { bold: true, fill: T.sub };
    const input = (rr, lab, value, fmt, eg) => {
      w(ws, `A${rr}`, lab);
      w(ws, `B${rr}`, value, { input: true, fmt });
      if (eg) note(ws, `C${rr}`, eg);
    };
    const calc = (rr, lab, f, o = {}) => {
      w(ws, `A${rr}`, lab, o.sub ? SUBI : {});
      w(ws, `B${rr}`, fx(f), { fmt: NF.n1, ...(o.sub ? SUBI : o.link ? { link: true } : {}) });
      if (o.eg) note(ws, `C${rr}`, o.eg);
    };
    const L = colL(1 + n);        // Historicals column of the latest actual year
    w(ws, 'A4', 'Company & settings', { bold: true });
    input(IN.name, 'Company name', a.company?.name || null, undefined, 'e.g. ABC Industries Ltd');
    input(IN.lease, 'Treat lease liabilities as debt? (1/0)', r.toggle, undefined, '1 = deducted at entry and exit');
    w(ws, 'A8', 'Period labels', { bold: true });
    const labs = [...r.labels.hist, ...r.labels.fcst];
    labs.forEach((l, k) => {
      const lab = k < n
        ? (k === n - 1 ? 'Latest actual year (entry)' : `Historical year ${k + 1}`)
        : `Forecast year ${k - n + 1}${k === n + m - 1 ? ' (exit)' : ''}`;
      input(IN.label(k), lab, l, undefined, k === 0 ? 'Label only' : null);
    });
    w(ws, `A${IN.entryHead}`, 'Entry valuation', { bold: true });
    calc(IN.ebitda, 'Entry EBITDA (latest actual year)', `Historicals!$${L}$13`, { link: true, eg: 'Linked from Historicals' });
    input(IN.entryMult, 'Entry EV / EBITDA multiple', num(d.deal?.entryMultiple), NF.x, 'e.g. 10.0x');
    calc(IN.ev, 'Entry Enterprise Value', `B${IN.ebitda}*B${IN.entryMult}`, { sub: true });
    w(ws, `A${IN.bsHead}`, 'Existing balance sheet at entry (latest actual)', { bold: true });
    calc(IN.borrow, 'Existing borrowings (refinanced)', `Historicals!$${L}$52+Historicals!$${L}$57`, { link: true });
    calc(IN.leases, 'Lease liabilities (per toggle)', `(Historicals!$${L}$53+Historicals!$${L}$58)*$B$${IN.lease}`, { link: true });
    calc(IN.cash, 'Existing cash, bank balances & current investments', `Historicals!$${L}$38+Historicals!$${L}$39+Historicals!$${L}$40`, { link: true });
    calc(IN.nci, 'Non-controlling interest', `Historicals!$${L}$49`, { link: true });
    calc(IN.eqPrice, 'Equity purchase price', `B${IN.ev}-B${IN.borrow}-B${IN.leases}+B${IN.cash}-B${IN.nci}`, { sub: true, eg: 'EV − borrowings − leases + cash − NCI' });
    input(IN.cashUsed, 'Existing cash used to fund the deal', num(d.deal?.cashUsed), NF.n1, 'e.g. 400.0 – must not exceed existing cash');
    w(ws, `F${IN.cashUsed}`, fx(`IF(B${IN.cashUsed}>B${IN.cash},"⚠ exceeds existing cash","")`), { bold: true, color: RED });
    input(IN.feePct, 'Transaction fees (% of Entry EV)', pc(d.deal?.txnFeePct), NF.pct, 'e.g. 2.0% – advisory, legal, due diligence, stamp duty');
    w(ws, `A${IN.fees}`, 'Transaction fees');
    w(ws, `B${IN.fees}`, fx(`B${IN.ev}*B${IN.feePct}`), { fmt: NF.n1 });

    w(ws, `A${IN.debtHead}`, 'Debt financing', { bold: true });
    ['Tranche', 'x Entry EBITDA', 'Amount', 'Cash Interest', 'PIK Interest', 'Mandatory Amort. (% of original p.a.)', 'Tenor (years) – repaid at maturity', 'Financing Fee %', `Financing Fee (${unitShort})`]
      .forEach((h, i) => hdr(ws, `${colL(1 + i)}${IN.trHead}`, h));
    const NAN = (addr, text) => w(ws, addr, text, { italic: true, size: 9, color: T.grey, fill: T.na, align: 'center' });
    const S11 = { size: 11, fmt: NF.n1 };
    [['senA', IN.senA, 'Senior A (Term Loan A)'], ['senB', IN.senB, 'Senior B (Term Loan B)'], ['mezz', IN.mezz, 'Mezzanine']].forEach(([key, rr, lab]) => {
      const t = d.debt?.[key] || {};
      w(ws, `A${rr}`, lab, { bold: true });
      w(ws, `B${rr}`, num(t.x), { input: true, fmt: NF.x });
      w(ws, `C${rr}`, fx(`B${rr}*$B$${IN.ebitda}`), S11);
      w(ws, `D${rr}`, pc(t.rate), { input: true, fmt: NF.pct });
      if (key === 'mezz') w(ws, `E${rr}`, pc(t.pik), { input: true, fmt: NF.pct });
      else NAN(`E${rr}`, 'n.a.');
      if (key === 'mezz') NAN(`F${rr}`, 'Bullet at exit');
      else if (repay === 'sweep') NAN(`F${rr}`, 'n.a. (sweep only)');
      else w(ws, `F${rr}`, pc(t.amort), { input: true, fmt: NF.pct });
      w(ws, `G${rr}`, num(t.tenor), { input: true, fmt: NFT });
      w(ws, `H${rr}`, pc(t.feePct), { input: true, fmt: NF.pct });
      w(ws, `I${rr}`, fx(`C${rr}*H${rr}`), S11);
    });
    w(ws, `A${IN.total}`, 'Total debt', { bold: true });
    w(ws, `B${IN.total}`, fx(`SUM(B${IN.senA}:B${IN.mezz})`), { ...SUBI, fmt: NF.x });
    w(ws, `C${IN.total}`, fx(`SUM(C${IN.senA}:C${IN.mezz})`), { ...SUBI, fmt: NF.n1 });
    w(ws, `I${IN.total}`, fx(`SUM(I${IN.senA}:I${IN.mezz})`), { ...SUBI, fmt: NF.n1 });
    note(ws, `A${IN.trEg}`, repay === 'sweep'
      ? 'e.g. Senior A 2.5x, 9.0%, 5 yrs, 1.5% | Senior B 1.5x, 10.0%, 7 yrs, 2.0% | Mezz 1.0x, 12.0% cash, 3.0% PIK, 8 yrs, 2.5%'
      : 'e.g. Senior A 2.5x, 9.0%, 15.0% p.a., 5 yrs, 1.5% | Senior B 1.5x, 10.0%, 1.0% p.a., 7 yrs, 2.0% | Mezz 1.0x, 12.0% cash, 3.0% PIK, 8 yrs, 2.5%');
    w(ws, `F${IN.trEg}`, fx(`IF(AND(ISNUMBER(G${IN.mezz}),G${IN.mezz}<${m},C${IN.mezz}>0),"⚠ Mezzanine tenor is shorter than the ${m}-year hold – it is repaid at exit in this model","")`), { bold: true, color: RED });

    w(ws, `A${IN.cashHead}`, 'Cash management', { bold: true });
    if (sweepOn) {
      input(IN.sweep, 'Cash sweep (% of excess cash)', pc(d.cash?.sweepPct), NF.pct, 'e.g. 100.0% – share of excess cash used to prepay senior debt');
      input(IN.minCash, 'Minimum cash balance', num(d.cash?.minCash), NF.n1, 'e.g. 150.0 – operating cash kept in the business');
    } else {
      note(ws, `A${IN.sweep}`, 'No cash sweep – excess cash above the minimum repays any revolver, then builds up and is added to equity at exit.');
      input(IN.minCash, 'Minimum cash balance', num(d.cash?.minCash), NF.n1, 'e.g. 150.0 – operating cash kept in the business; the revolver draws to protect it');
    }
    input(IN.rcf, `Revolving credit facility – commitment (${unitShort})`, num(d.cash?.rcf), NF.n1, 'e.g. 300.0 – undrawn at close; draws automatically to cover shortfalls (0 = no revolver)');
    input(IN.rcfRate, 'Revolver interest rate (on drawn balance)', pc(d.cash?.rcfRate), NF.pct, 'e.g. 9.0% – on the opening drawn balance');
    input(IN.rcfFee, 'Revolver commitment fee (on undrawn amount)', pc(d.cash?.rcfFee), NF.pct, 'e.g. 0.5% – on the opening undrawn commitment');
    w(ws, `A${IN.exitHead}`, 'Exit', { bold: true });
    input(IN.exitMult, `Exit EV / EBITDA multiple (end of Year ${m})`, num(d.deal?.exitMultiple), NF.x, 'e.g. 10.0x – often set equal to entry multiple as a base case');
    w(ws, `A${IN.stepHead}`, 'Sensitivity step sizes', { bold: true });
    input(IN.exitStep, 'Exit multiple step', r.sens.steps.exitStep, NF.x, 'e.g. 1.0x');
    input(IN.entryStep, 'Entry multiple step', r.sens.steps.entryStep, NF.x, 'e.g. 1.0x');
    input(IN.growthStep, 'Revenue growth shift step (applied to every year)', r.sens.steps.growthStep, NF.pct, "e.g. 2.0% – shifts each year's growth by ± this amount");
  }

  /* ============================== Sources & Uses ============================== */
  {
    const ws = wb.addWorksheet('Sources & Uses');
    [40, 14, 12, 12, 4, 40, 14, 12, 12].forEach((wd, i) => { ws.getColumn(i + 1).width = wd; });
    title(ws, 'A1', 'Sources & Uses of Funds (at entry)');
    note(ws, 'A2', `${unitLabel}. Sponsor equity is the balancing figure.`);
    ['Uses', unitShort, '% of total', 'x EBITDA', null, 'Sources', unitShort, '% of total', 'x EBITDA']
      .forEach((h, i) => { if (h) hdr(ws, `${colL(1 + i)}4`, h, { wrap: false }); });
    const S11P = { size: 11, fmt: NF.pct };
    const S11X = { size: 11, fmt: NF.x };
    const SUBT = { bold: true, fill: T.sub, top: true };
    const uses = [['Equity purchase price', inB(IN.eqPrice)], ['Refinance existing borrowings', inB(IN.borrow)], ['Transaction fees', inB(IN.fees)], ['Financing fees', `Inputs!$I$${IN.total}`]];
    const sources = [['Senior A (Term Loan A)', `Inputs!$C$${IN.senA}`], ['Senior B (Term Loan B)', `Inputs!$C$${IN.senB}`], ['Mezzanine', `Inputs!$C$${IN.mezz}`], ['Existing cash used', inB(IN.cashUsed)]];
    for (let i = 0; i < 6; i++) {
      const rr = 5 + i;
      const tot = rr === 10;
      if (i < 4) { w(ws, `A${rr}`, uses[i][0]); w(ws, `B${rr}`, fx(uses[i][1]), { link: true, fmt: NF.n1 }); }
      if (tot) { w(ws, `A${rr}`, 'Total uses', SUBT); w(ws, `B${rr}`, fx('SUM(B5:B8)'), { ...SUBT, fmt: NF.n1 }); }
      w(ws, `C${rr}`, fx(`IFERROR(B${rr}/B$10,0)`), S11P);
      w(ws, `D${rr}`, fx(`IFERROR(B${rr}/${inB(IN.ebitda)},0)`), S11X);
      if (i < 4) { w(ws, `F${rr}`, sources[i][0], { size: 11 }); w(ws, `G${rr}`, fx(sources[i][1]), { link: true, fmt: NF.n1 }); }
      if (i === 4) { w(ws, `F${rr}`, 'Sponsor equity (balancing figure)', { bold: true }); w(ws, `G${rr}`, fx('B10-SUM(G5:G8)'), { bold: true, fmt: NF.n1 }); }
      if (tot) { w(ws, `F${rr}`, 'Total sources', SUBT); w(ws, `G${rr}`, fx('SUM(G5:G9)'), { ...SUBT, fmt: NF.n1 }); }
      w(ws, `H${rr}`, fx(`IFERROR(G${rr}/G$10,0)`), S11P);
      w(ws, `I${rr}`, fx(`IFERROR(G${rr}/${inB(IN.ebitda)},0)`), S11X);
    }
    w(ws, 'A12', 'Check: Sources − Uses (must be 0)'); w(ws, 'B12', fx('ROUND(G10-B10,1)'), { bold: true, fmt: NF.n1, align: 'right' });
    w(ws, 'A13', 'Sponsor equity < 0? (structure over-levered)'); w(ws, 'B13', fx('IF(G9<0,"CHECK","OK")'), { bold: true, align: 'right' });
    w(ws, 'A15', 'Key entry statistics', { bold: true });
    [
      ['Entry EV / EBITDA', inB(IN.entryMult), S11X],
      ['Total debt / EBITDA', inB(IN.total), S11X],
      ['Senior debt / EBITDA', `${inB(IN.senA)}+${inB(IN.senB)}`, S11X],
      ['Equity contribution (% of total sources)', 'H9', S11P],
      ['Debt / (Debt + Sponsor equity)', 'IFERROR(SUM(G5:G7)/(SUM(G5:G7)+G9),0)', S11P],
    ].forEach(([lab, f, st], i) => { w(ws, `A${16 + i}`, lab); w(ws, `B${16 + i}`, fx(f), st); });
  }

  /* ============================== Returns ============================== */
  {
    const ws = wb.addWorksheet('Returns');
    ws.getColumn(1).width = 44; ws.getColumn(2).width = 13; ws.getColumn(3).width = 16;
    for (let c = 4; c <= 3 + m; c++) ws.getColumn(c).width = 13;
    title(ws, 'A1', 'Exit, Sponsor Returns & Value Creation');
    note(ws, 'A2', `${unitLabel}. Exit at the end of forecast Year ${m}.`);
    const LNK = { link: true, fmt: NF.n1 };
    const S11 = { size: 11, fmt: NF.n1 };
    const SUBT = { bold: true, fill: T.sub, top: true };
    const KEYT = { bold: true, fill: KEY, top: true };
    const M = (row, col = XL) => `${MOD}!$${col}$${row}`;
    hdr(ws, 'A4', 'Exit waterfall', { align: 'left', wrap: false }); hdr(ws, 'B4', unitShort, { wrap: false });
    [
      ['Exit-year EBITDA', M(R.ebitda), LNK],
      ['Exit EV / EBITDA multiple', inB(IN.exitMult), { link: true, fmt: NF.x }],
      ['Exit Enterprise Value', 'B5*B6', { ...SUBT, fmt: NF.n1 }, SUBT],
      ['(−) Senior A outstanding', M(R.aClose), LNK],
      ['(−) Senior B outstanding', M(R.bClose), LNK],
      ['(−) Mezzanine outstanding (incl. PIK)', M(R.mClose), LNK],
      ['(−) Revolver outstanding', M(R.rClose), LNK],
      ['(−) Lease liabilities', M(R.leaseRow), LNK],
      ['(−) Non-controlling interest', inB(IN.nci), LNK],
      ['(+) Cash on balance sheet', M(R.cashClose), LNK],
      ['Exit Equity Value (to sponsor)', 'B7-B8-B9-B10-B11-B12-B13+B14', { ...KEYT, fmt: NF.n1 }, KEYT],
    ].forEach(([lab, f, st, lst], i) => { w(ws, `A${5 + i}`, lab, lst || {}); w(ws, `B${5 + i}`, fx(f), st); });

    const RC = (j) => colL(2 + j);             // returns column of year j (0 = entry)
    hdr(ws, 'A18', 'Sponsor returns', { align: 'left', wrap: false });
    for (let j = 0; j <= m; j++) hdr(ws, `${RC(j)}18`, fx(label(n - 1 + j)), { wrap: false });
    w(ws, 'A19', 'Year');
    for (let j = 0; j <= m; j++) w(ws, `${RC(j)}19`, j, { italic: true, size: 9, color: T.grey });
    w(ws, 'A20', 'Sponsor cash flows');
    for (let j = 0; j <= m; j++) {
      const v = j === 0 ? fx(`-${SU}!$G$9`) : j === m ? fx('B15') : 0;
      w(ws, `${RC(j)}20`, v, S11);
    }
    w(ws, 'A22', 'Sponsor equity invested'); w(ws, 'B22', fx(`${SU}!$G$9`), LNK);
    w(ws, 'A23', 'Exit equity value'); w(ws, 'B23', fx('B15'), S11);
    const KEYS = { bold: true, fill: KEY };
    w(ws, 'A24', 'MOIC', KEYS); w(ws, 'B24', fx('IF(B22>0,B23/B22,"NM")'), { ...KEYS, fmt: NFM });
    w(ws, 'A25', 'IRR', KEYS); w(ws, 'B25', fx(`IF(AND(B22>0,B23>0),IRR(B20:${RC(m)}20),"NM")`), { ...KEYS, fmt: NF.pct });
    note(ws, 'C25', 'IRR function on the cash flow row above');

    hdr(ws, 'A28', 'Value creation bridge', { align: 'left', wrap: false }); hdr(ws, 'B28', unitShort, { wrap: false }); hdr(ws, 'C28', '% of value created', { wrap: false });
    w(ws, 'A29', 'Sponsor equity at entry', SUBT); w(ws, 'B29', fx('B22'), { ...SUBT, fmt: NF.n1 });
    [
      ['(+) EBITDA growth', `(${M(R.ebitda)}-${inB(IN.ebitda)})*${inB(IN.exitMult)}`],
      ['(+) Multiple expansion / (contraction)', `${inB(IN.ebitda)}*(${inB(IN.exitMult)}-${inB(IN.entryMult)})`],
      ['(+) Net debt reduction', `${M(R.nd, E0)}-${M(R.nd)}`],
      ['(−) Transaction & financing fees', `-(${inB(IN.fees)}+Inputs!$I$${IN.total})`],
    ].forEach(([lab, f], i) => {
      const rr = 30 + i;
      w(ws, `A${rr}`, lab); w(ws, `B${rr}`, fx(f), S11);
      w(ws, `C${rr}`, fx(`IFERROR(B${rr}/SUM($B$30:$B$33),0)`), { size: 11, fmt: NF.pct });
    });
    w(ws, 'A34', 'Sponsor equity at exit', SUBT); w(ws, 'B34', fx('B29+SUM(B30:B33)'), { ...SUBT, fmt: NF.n1 });
    w(ws, 'A36', 'Check: bridge vs exit waterfall (must be 0)'); w(ws, 'B36', fx('ROUND(B34-B15,1)'), { bold: true, fmt: NF.n1 });
    note(ws, 'A37', 'EBITDA growth uses the exit multiple; multiple expansion uses entry EBITDA – this pairing adds up exactly.');
    w(ws, 'A39', 'Returns summary', { bold: true });
    [
      ['Entry EV', inB(IN.ev), S11],
      ['Exit EV', 'B7', S11],
      ['Entry → exit EBITDA CAGR', `IFERROR((${M(R.ebitda)}/${inB(IN.ebitda)})^(1/${m})-1,0)`, { size: 11, fmt: NF.pct }],
      ['Net debt / EBITDA at entry', M(R.ndE, E0), { size: 11, fmt: NF.x }],
      ['Net debt / EBITDA at exit', M(R.ndE), { size: 11, fmt: NF.x }],
    ].forEach(([lab, f, st], i) => { w(ws, `A${40 + i}`, lab); w(ws, `B${40 + i}`, fx(f), st); });
  }

  /* ============================== Sensitivity ============================== */
  {
    const ws = wb.addWorksheet('Sensitivity');
    ws.getColumn(1).width = 30;
    for (let c = 2; c <= 7; c++) ws.getColumn(c).width = 13;
    title(ws, 'A1', 'Returns Sensitivity');
    note(ws, 'A2', 'Growth tables re-run the full model (debt paydown, interest, tax) for each case via the Sensitivity Engine.');
    const C = (i) => colL(3 + i);                 // table column i (C…G)
    const ROWH = { bold: true, fill: T.sec, fmt: NF.x, align: 'center' };
    const cell = (addr, f, fmt, centre) => w(ws, addr, fx(f), centre ? { bold: true, fill: KEY, fmt, align: 'right' } : { size: 11, fmt, align: 'right' });
    const exitRow = (k) => `${inB(IN.exitMult)}+(${k})*${inB(IN.exitStep)}`;
    const entryRow = (k) => `${inB(IN.entryMult)}+(${k})*${inB(IN.entryStep)}`;
    const nci = inB(IN.nci);
    const E = (row, k, col = XL) => `${ENG}!$${col}$${engRow(row, k)}`;
    /* tables 1 & 2: exit multiple vs revenue growth (Sensitivity Engine) */
    const growthTable = (top, heading, kind) => {
      w(ws, `A${top}`, heading, { bold: true });
      hdr(ws, `A${top + 1}`, 'Growth shift →'); hdr(ws, `B${top + 1}`, 'Exit multiple ↓');
      KS.forEach((_, i) => hdr(ws, `${C(i)}${top + 1}`, fx(`${ENG}!$B$${blockBase(i)}`), { fmt: NFG, wrap: false }));
      w(ws, `B${top + 2}`, 'EBITDA CAGR', { italic: true, size: 9, color: T.grey });
      KS.forEach((_, i) => w(ws, `${C(i)}${top + 2}`, fx(`IFERROR((${E(R.ebitda, i)}/${E(R.ebitda, i, E0)})^(1/${m})-1,0)`), { italic: true, size: 9, color: T.grey, fmt: NF.pct }));
      KS.forEach((k, ri) => {
        const rr = top + 3 + ri;
        w(ws, `B${rr}`, fx(exitRow(k)), ROWH);
        KS.forEach((_, i) => {
          const eq = `($B${rr}*${E(R.ebitda, i)}-${E(R.nd, i)}-${nci})`;
          const f = kind === 'irr'
            ? `IFERROR(IF(OR(${SU}!$G$9<=0,${eq}<=0),"NM",(${eq}/${SU}!$G$9)^(1/${m})-1),"NM")`
            : `IFERROR(IF(${SU}!$G$9<=0,"NM",${eq}/${SU}!$G$9),"NM")`;
          cell(`${C(i)}${rr}`, f, kind === 'irr' ? NF.pct : NFM, ri === 2 && i === 2);
        });
      });
    };
    growthTable(4, 'Table 1: IRR – Exit multiple vs Revenue growth', 'irr');
    growthTable(14, 'Table 2: MOIC – Exit multiple vs Revenue growth', 'moic');
    /* tables 3 & 4: entry vs exit multiple (base-case operations) */
    const multTable = (top, heading, kind) => {
      w(ws, `A${top}`, heading, { bold: true });
      const hr = top + 1;
      hdr(ws, `A${hr}`, 'Exit multiple →'); hdr(ws, `B${hr}`, 'Entry multiple ↓');
      KS.forEach((k, i) => hdr(ws, `${C(i)}${hr}`, fx(exitRow(k)), { fmt: NF.x, wrap: false }));
      KS.forEach((k, ri) => {
        const rr = hr + 1 + ri;
        w(ws, `B${rr}`, fx(entryRow(k)), ROWH);
        const en = `($B${rr}*${inB(IN.ebitda)}*(1+${inB(IN.feePct)})+Inputs!$I$${IN.total}-${MOD}!$${E0}$${R.nd}-${nci})`;
        KS.forEach((_, i) => {
          const ex = `(${C(i)}$${hr}*${MOD}!$${XL}$${R.ebitda}-${MOD}!$${XL}$${R.nd}-${nci})`;
          const f = kind === 'irr'
            ? `IFERROR(IF(OR(${en}<=0,${ex}<=0),"NM",(${ex}/${en})^(1/${m})-1),"NM")`
            : `IFERROR(IF(${en}<=0,"NM",${ex}/${en}),"NM")`;
          cell(`${C(i)}${rr}`, f, kind === 'irr' ? NF.pct : NFM, ri === 2 && i === 2);
        });
      });
    };
    multTable(24, 'Table 3: IRR – Entry multiple vs Exit multiple (base-case operations)', 'irr');
    multTable(33, 'Table 4: MOIC – Entry multiple vs Exit multiple (base-case operations)', 'moic');
    note(ws, 'A41', 'Shaded centre cells equal the base-case IRR / MOIC on the Returns sheet. Step sizes are set on Inputs.');
    w(ws, 'A42', 'Check: engine base case vs LBO Model exit net debt (must be 0)', { bold: true });
    w(ws, 'E42', fx(`ROUND(${E(R.nd, 2)}-${MOD}!$${XL}$${R.nd},1)`), { bold: true, fmt: NF.n1 });
    note(ws, 'A43', 'Growth shift changes revenue growth in every forecast year; costs, capex and working capital follow their % drivers, so EBITDA CAGR is shown under each case.');
  }

  /* ============================== LBO Model (and the Sensitivity Engine blocks) ============================== */
  /**
   * One copy of the model. off: row offset (0 on the LBO Model; the engine
   * block's offset otherwise). engine: only the entry and hold columns are
   * written, and revenue growth adds the case shift (shiftRef).
   */
  const writeModel = (ws, off, engine, shiftRef) => {
    const c = (col, row) => `${col}${row + off}`;
    const A = (row) => (Y) => `Assumptions!${Y}${row}`;
    const Hs = (row) => (Xc) => `Historicals!${Xc}${row}`;
    const inv = (row) => `Inputs!$B$${row}`;
    const all = n + m;
    const SUB = { bold: true, fill: T.sub, top: true };
    const SMALL = { italic: true, size: 9, color: T.grey };
    const sec = (row, text) => {
      w(ws, `A${row + off}`, text, { bold: true, fill: T.sec });
      for (let k = 0; k < all; k++) w(ws, c(X(k), row), null, { size: 11, fill: T.sec });
    };
    /**
     * A model row. o: fmt · st ('sub' | 'key' | 'small') · hist(Xc, P) for the
     * actual columns (holdOnly: grey n.a. there) · entry(Xc) / entryStyle for the
     * entry column alone · hold(Y, P) · histLink · firstNa · holdStyle.
     */
    const line = (row, lab, o) => {
      const fmt = o.fmt === undefined ? NF.n1 : o.fmt;
      const st = o.st === 'sub' ? SUB : o.st === 'key' ? { bold: true, fill: KEY } : o.st === 'small' ? SMALL : {};
      w(ws, `A${row + off}`, lab, st);
      for (let k = 0; k < all; k++) {
        const Xc = X(k);
        const P = k > 0 ? X(k - 1) : null;
        const isEntry = k === n - 1;
        if (k < n) {
          if (engine && !isEntry) continue;
          if (o.entry && isEntry) { const ev = o.entry(Xc); w(ws, c(Xc, row), typeof ev === 'number' ? ev : fx(ev), { fmt, ...(o.entryStyle || st) }); continue; }
          if (o.holdOnly || o.entry) {
            if (engine) { if (fmt) w(ws, c(Xc, row), null, { size: 11, fmt }); } else w(ws, c(Xc, row), null, { size: 11, fill: T.na, fmt: fmt || undefined });
            continue;
          }
          if (o.firstNa && k === 0) { w(ws, c(Xc, row), 'n.a.', { ...SMALL, fmt, align: 'right' }); continue; }
          const eP = P || 'A';
          w(ws, c(Xc, row), fx(o.hist(Xc, eP)), { fmt, ...st, ...(o.histLink ? { link: true } : {}) });
        } else {
          w(ws, c(Xc, row), fx(o.hold(Xc, P)), { ...(fmt ? { fmt } : {}), ...(o.holdStyle || st) });
        }
      }
    };
    const rc = (row) => (Y) => c(Y, row);          // same-column ref

    sec(6, 'OPERATING MODEL');
    line(R.rev, 'Revenue from Operations', { hist: Hs(7), histLink: true, hold: (Y, P) => `${c(P, R.rev)}*(1+${A(7)(Y)}+${shiftRef})` });
    line(R.growth, '  Revenue growth', { st: 'small', fmt: NF.pct, firstNa: true, hist: (Y, P) => `IFERROR(${c(Y, R.rev)}/${c(P, R.rev)}-1,0)`, hold: (Y, P) => `IFERROR(${c(Y, R.rev)}/${c(P, R.rev)}-1,0)` });
    line(R.materials, 'Cost of Materials', { hist: Hs(9), histLink: true, hold: (Y) => `${c(Y, R.rev)}*${A(8)(Y)}` });
    line(R.employee, 'Employee Benefits Expense', { hist: Hs(10), histLink: true, hold: (Y) => `${c(Y, R.rev)}*${A(9)(Y)}` });
    line(R.otherExp, 'Other Expenses', { hist: Hs(11), histLink: true, hold: (Y) => `${c(Y, R.rev)}*${A(10)(Y)}` });
    const ebitdaF = (Y) => `${c(Y, R.rev)}-${c(Y, R.materials)}-${c(Y, R.employee)}-${c(Y, R.otherExp)}`;
    line(R.ebitda, 'EBITDA', { st: 'sub', hist: ebitdaF, hold: ebitdaF });
    const marginF = (Y) => `IFERROR(${c(Y, R.ebitda)}/${c(Y, R.rev)},0)`;
    line(R.margin, '  EBITDA margin', { st: 'small', fmt: NF.pct, hist: marginF, hold: marginF });
    line(R.da, 'Depreciation & Amortisation', { hist: Hs(14), histLink: true, hold: (Y) => `${c(Y, R.rev)}*${A(11)(Y)}` });
    const ebitF = (Y) => `${c(Y, R.ebitda)}-${c(Y, R.da)}`;
    line(R.ebit, 'EBIT', { st: 'sub', hist: ebitF, hold: ebitF });
    line(R.intA, 'Interest – Senior A', { holdOnly: true, hold: (Y) => `${c(Y, R.aOpen)}*Inputs!$D$${IN.senA}` });
    line(R.intB, 'Interest – Senior B', { holdOnly: true, hold: (Y) => `${c(Y, R.bOpen)}*Inputs!$D$${IN.senB}` });
    line(R.intM, 'Interest – Mezzanine (cash)', { holdOnly: true, hold: (Y) => `${c(Y, R.mOpen)}*Inputs!$D$${IN.mezz}` });
    line(R.intR, 'Interest – Revolver (drawn) + commitment fee', { holdOnly: true, hold: (Y) => `${c(Y, R.rOpen)}*${inv(IN.rcfRate)}+${c(Y, R.rUndrawn)}*${inv(IN.rcfFee)}` });
    line(R.pik, 'Interest – Mezzanine (PIK, non-cash)', { holdOnly: true, hold: (Y) => `${c(Y, R.mOpen)}*Inputs!$E$${IN.mezz}` });
    line(R.fee, 'Amortisation of financing fees (non-cash)', {
      holdOnly: true,
      hold: (Y) => [IN.senA, IN.senB, IN.mezz].map((t) => `IFERROR(IF(${c(Y, 5)}<=Inputs!$G$${t},Inputs!$I$${t}/Inputs!$G$${t},0),0)`).join('+'),
    });
    line(R.pbt, 'Profit Before Tax', { st: 'sub', holdOnly: true, hold: (Y) => `${c(Y, R.ebit)}-${c(Y, R.intA)}-${c(Y, R.intB)}-${c(Y, R.intM)}-${c(Y, R.intR)}-${c(Y, R.pik)}-${c(Y, R.fee)}` });
    line(R.tax, 'Tax', { holdOnly: true, hold: (Y) => `MAX(0,${c(Y, R.pbt)})*${A(12)(Y)}` });
    line(R.ni, 'Net Income', { st: 'sub', holdOnly: true, hold: (Y) => `${c(Y, R.pbt)}-${c(Y, R.tax)}` });

    sec(25, 'WORKING CAPITAL & CAPEX');
    line(R.inv, 'Inventories', { hist: Hs(36), histLink: true, hold: (Y) => `${c(Y, R.materials)}*${A(16)(Y)}/365` });
    line(R.rec, 'Trade Receivables', { hist: Hs(37), histLink: true, hold: (Y) => `${c(Y, R.rev)}*${A(17)(Y)}/365` });
    line(R.oca, 'Other Current Assets', { hist: Hs(41), histLink: true, hold: (Y) => `${c(Y, R.rev)}*${A(19)(Y)}` });
    line(R.pay, 'Trade Payables', { hist: Hs(59), histLink: true, hold: (Y) => `${c(Y, R.materials)}*${A(18)(Y)}/365` });
    line(R.ocl, 'Other Current Liabilities & Provisions', { hist: Hs(60), histLink: true, hold: (Y) => `${c(Y, R.rev)}*${A(20)(Y)}` });
    const nwcF = (Y) => `${c(Y, R.inv)}+${c(Y, R.rec)}+${c(Y, R.oca)}-${c(Y, R.pay)}-${c(Y, R.ocl)}`;
    line(R.nwc, 'Net Working Capital', { st: 'sub', hist: nwcF, hold: nwcF });
    const dF = (Y, P) => `${c(Y, R.nwc)}-${c(P, R.nwc)}`;
    line(R.dNwc, 'Increase / (Decrease) in NWC', { firstNa: true, hist: dF, hold: dF });
    line(R.capex, 'Capex', { hist: (Xc) => `-Historicals!${Xc}73`, histLink: true, hold: (Y) => `${c(Y, R.rev)}*${A(15)(Y)}` });

    sec(34, 'FREE CASH FLOW AVAILABLE FOR DEBT REPAYMENT');
    line(R.fNi, 'Net Income', { holdOnly: true, hold: rc(R.ni) });
    line(R.fDa, '(+) Depreciation & Amortisation', { holdOnly: true, hold: rc(R.da) });
    line(R.fPik, '(+) PIK interest (non-cash)', { holdOnly: true, hold: rc(R.pik) });
    line(R.fFee, '(+) Financing fee amortisation (non-cash)', { holdOnly: true, hold: rc(R.fee) });
    line(R.fCapex, '(−) Capex', { holdOnly: true, hold: rc(R.capex) });
    line(R.fNwc, '(−) Increase in NWC', { holdOnly: true, hold: rc(R.dNwc) });
    line(R.fLease, '(−) Lease payments (Ind AS 116)', { holdOnly: true, hold: (Y) => `${c(Y, R.rev)}*${A(23)(Y)}` });
    line(R.fcf, 'Free Cash Flow', { st: 'key', holdOnly: true, hold: (Y) => `${c(Y, R.fNi)}+${c(Y, R.fDa)}+${c(Y, R.fPik)}+${c(Y, R.fFee)}-${c(Y, R.fCapex)}-${c(Y, R.fNwc)}-${c(Y, R.fLease)}` });

    sec(43, 'CASH & DEBT SCHEDULE');
    const bold = (row, text) => w(ws, `A${row + off}`, text, { bold: true });
    const closeEntry = { link: true, fill: T.sub, top: true };
    bold(R.cashTitle, 'Cash');
    line(R.cashOpen, 'Opening cash', { holdOnly: true, hold: (Y, P) => c(P, R.cashClose) });
    line(R.cashFcf, '(+) Free cash flow', { holdOnly: true, hold: rc(R.fcf) });
    line(R.cashMand, '(−) Mandatory repayments (incl. balloon at maturity)', { holdOnly: true, hold: (Y) => `${c(Y, R.aMand)}+${c(Y, R.bMand)}` });
    line(R.cashAfter, 'Cash after mandatory repayments', { holdOnly: true, hold: (Y) => `${c(Y, R.cashOpen)}+${c(Y, R.cashFcf)}-${c(Y, R.cashMand)}` });
    line(R.rDraw, '(+) Revolver draw', { holdOnly: true, hold: (Y) => `MIN(MAX(0,${inv(IN.rcf)}-${c(Y, R.rOpen)}),MAX(0,${inv(IN.minCash)}-${c(Y, R.cashAfter)}))` });
    line(R.rRepay, '(−) Revolver repayment', { holdOnly: true, hold: (Y) => `MIN(${c(Y, R.rOpen)},MAX(0,${c(Y, R.cashAfter)}-${inv(IN.minCash)}))` });
    line(R.minCash, '(−) Minimum cash balance', { holdOnly: true, hold: () => inv(IN.minCash) });
    line(R.avail, sweepOn ? 'Cash available for sweep' : 'Cash available for sweep (none in this structure)', {
      holdOnly: true,
      hold: (Y) => (sweepOn ? `MAX(0,${c(Y, R.cashAfter)}+${c(Y, R.rDraw)}-${c(Y, R.rRepay)}-${c(Y, R.minCash)})*${inv(IN.sweep)}` : '0'),
    });
    line(R.cashSweep, '(−) Cash sweep', { holdOnly: true, hold: (Y) => `${c(Y, R.aSweep)}+${c(Y, R.bSweep)}` });
    line(R.cashClose, 'Closing cash', {
      st: 'sub', entry: () => `${inv(IN.cash)}-${inv(IN.cashUsed)}`, entryStyle: closeEntry,
      hold: (Y) => `${c(Y, R.cashAfter)}+${c(Y, R.rDraw)}-${c(Y, R.rRepay)}-${c(Y, R.cashSweep)}`,
    });
    bold(R.rHead, 'Revolving credit facility (RCF)');
    line(R.rOpen, 'Opening balance', { holdOnly: true, hold: (Y, P) => c(P, R.rClose) });
    line(R.rDraw2, '(+) Draw', { holdOnly: true, hold: rc(R.rDraw) });
    line(R.rRepay2, '(−) Repayment', { holdOnly: true, hold: rc(R.rRepay) });
    line(R.rClose, 'Closing balance', { st: 'sub', entry: () => 0, entryStyle: closeEntry, hold: (Y) => `${c(Y, R.rOpen)}+${c(Y, R.rDraw2)}-${c(Y, R.rRepay2)}` });
    line(R.rUndrawn, 'Undrawn commitment (opening)', { holdOnly: true, hold: (Y) => `MAX(0,${inv(IN.rcf)}-${c(Y, R.rOpen)})` });
    const yr = (Y) => `${Y}$${5 + off}`;                 // the year number of column Y
    const tranche = (head, lab, t, rows) => {
      bold(rows.head, lab);
      const G = `Inputs!$G$${t}`;
      line(rows.open, 'Opening balance', { holdOnly: true, hold: (Y, P) => c(P, rows.close) });
      line(rows.mand, repay === 'sweep' ? '(−) Mandatory repayment (balloon at maturity)' : '(−) Mandatory repayment', {
        holdOnly: true,
        hold: (Y) => (repay === 'sweep'
          ? `IF(AND(ISNUMBER(${G}),${G}<${m},${yr(Y)}=${G}),${c(Y, rows.open)},0)`
          : `IF(AND(ISNUMBER(${G}),${yr(Y)}>${G}),0,IF(AND(ISNUMBER(${G}),${G}<${m},${yr(Y)}=${G}),${c(Y, rows.open)},MIN(${c(Y, rows.open)},Inputs!$C$${t}*Inputs!$F$${t})))`),
      });
      line(rows.sweep, '(−) Cash sweep', { holdOnly: true, hold: sweepOn ? rows.sweepF : () => '0' });
      line(rows.close, 'Closing balance', {
        st: 'sub', entry: () => `Inputs!$C$${t}`, entryStyle: closeEntry,
        hold: (Y) => `${c(Y, rows.open)}-${c(Y, rows.mand)}-${c(Y, rows.sweep)}`,
      });
    };
    tranche('a', 'Senior A (Term Loan A)', IN.senA, {
      head: R.aHead, open: R.aOpen, mand: R.aMand, sweep: R.aSweep, close: R.aClose,
      sweepF: (Y) => `MIN(${c(Y, R.avail)},${c(Y, R.aOpen)}-${c(Y, R.aMand)})`,
    });
    tranche('b', 'Senior B (Term Loan B)', IN.senB, {
      head: R.bHead, open: R.bOpen, mand: R.bMand, sweep: R.bSweep, close: R.bClose,
      sweepF: (Y) => `MIN(${c(Y, R.avail)}-${c(Y, R.aSweep)},${c(Y, R.bOpen)}-${c(Y, R.bMand)})`,
    });
    bold(R.mHead, 'Mezzanine (bullet, repaid at exit)');
    line(R.mOpen, 'Opening balance', { holdOnly: true, hold: (Y, P) => c(P, R.mClose) });
    line(R.mPik, '(+) PIK interest accrued', { holdOnly: true, hold: rc(R.pik) });
    line(R.mClose, 'Closing balance', { st: 'sub', entry: () => `Inputs!$C$${IN.mezz}`, entryStyle: closeEntry, hold: (Y) => `${c(Y, R.mOpen)}+${c(Y, R.mPik)}` });

    sec(R.credit, 'CREDIT STATISTICS');
    const tdF = (Y) => `${c(Y, R.aClose)}+${c(Y, R.bClose)}+${c(Y, R.mClose)}+${c(Y, R.rClose)}`;
    line(R.totalDebt, 'Total debt (incl. revolver)', { entry: tdF, entryStyle: {}, hold: tdF });
    line(R.leaseRow, 'Lease liabilities (held constant)', { entry: () => inv(IN.leases), entryStyle: { link: true }, hold: () => inv(IN.leases) });
    const ndF = (Y) => `${c(Y, R.totalDebt)}+${c(Y, R.leaseRow)}-${c(Y, R.cashClose)}`;
    line(R.nd, 'Net debt', { st: 'sub', entry: ndF, hold: ndF });
    const deF = (Y) => `IFERROR(${c(Y, R.totalDebt)}/${c(Y, R.ebitda)},0)`;
    line(R.dE, 'Total debt / EBITDA', { fmt: NF.x, entry: deF, entryStyle: {}, hold: deF });
    const ndeF = (Y) => `IFERROR(${c(Y, R.nd)}/${c(Y, R.ebitda)},0)`;
    line(R.ndE, 'Net debt / EBITDA', { fmt: NF.x, entry: ndeF, entryStyle: {}, hold: ndeF });
    line(R.cover, 'EBITDA / Cash interest', { fmt: NF.x, holdOnly: true, hold: (Y) => `IFERROR(${c(Y, R.ebitda)}/(${c(Y, R.intA)}+${c(Y, R.intB)}+${c(Y, R.intM)}+${c(Y, R.intR)}),0)` });
    line(R.repaid, 'Cumulative senior debt repaid (% of original)', { fmt: NF.pct, holdOnly: true, hold: (Y) => `IFERROR(1-(${c(Y, R.aClose)}+${c(Y, R.bClose)})/(Inputs!$C$${IN.senA}+Inputs!$C$${IN.senB}),0)` });
    line(R.shortfall, 'Cash shortfall check (after revolver)', { fmt: null, holdOnly: true, holdStyle: { align: 'center' }, hold: (Y) => `IF(${c(Y, R.cashClose)}<-0.001,"SHORTFALL","OK")` });
    line(R.headroom, 'Revolver headroom check', {
      fmt: null, holdOnly: true, holdStyle: { align: 'center' },
      hold: (Y) => `IF(${c(Y, R.rClose)}>${inv(IN.rcf)}+0.001,"OVER LIMIT",IF(AND(${inv(IN.rcf)}>0,${c(Y, R.rClose)}>=0.999*${inv(IN.rcf)}),"FULLY DRAWN","OK"))`,
    });
  };

  /* header rows of a model copy: period labels (row `lr`) and year numbers (row `lr + 1`) */
  const modelHeader = (ws, lr, from) => {
    for (let k = from; k < n + m; k++) hdr(ws, `${X(k)}${lr}`, fx(label(k)), { wrap: false });
    w(ws, `A${lr + 1}`, 'Year');
    for (let k = n - 1; k < n + m; k++) w(ws, `${X(k)}${lr + 1}`, k - (n - 1), { italic: true, size: 9, color: T.grey, align: 'right' });
  };
  const widths = (ws) => { ws.getColumn(1).width = 46; for (let k = 0; k < n + m; k++) ws.getColumn(2 + k).width = 12; };
  {
    const ws = wb.addWorksheet('LBO Model');
    widths(ws);
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4, topLeftCell: 'B5' }];
    w(ws, 'A1', fx('IF(Inputs!$B$5="","LBO Model",Inputs!$B$5&" – LBO Model")'), { bold: true, size: 14, link: true });
    note(ws, 'A2', `${unitLabel} | ${TYPE_NAME[repay]} | Revolver + interest on opening balances | Fully calculated – do not type here`);
    if (n > 1) w(ws, 'B3', 'Actual', { bold: true });
    w(ws, `${E0}3`, 'Entry', { bold: true });
    w(ws, `${X(n)}3`, 'Projection (holding period)', { bold: true });
    hdr(ws, 'A4', unitLabel, { align: 'left', wrap: false });
    modelHeader(ws, 4, 0);
    writeModel(ws, 0, false, '0');
  }

  writeHistoricals(wb, { page: d.company?.page, n, label, unitLabel, unit, sym });
  writeAssumptions(wb, { defs: LBO_DRIVERS, drivers: d.drivers, n, m, label, unitShort });

  {
    const ws = wb.addWorksheet('Sensitivity Engine');
    widths(ws);
    title(ws, 'A1', 'Sensitivity Engine – full model re-run for five revenue growth cases (do not edit)');
    note(ws, 'A2', "Each block repeats the LBO Model with every forecast year's revenue growth shifted by the amount shown.");
    KS.forEach((k, i) => {
      const base = blockBase(i);
      w(ws, `A${base}`, `Case ${i + 1}: revenue growth shift`, { bold: true });
      w(ws, `B${base}`, fx(`(${k})*${inB(IN.growthStep)}`), { bold: true, fmt: NF.pct });
      hdr(ws, `A${base + 1}`, unitLabel, { align: 'left', wrap: false });
      modelHeader(ws, base + 1, n - 1);
      writeModel(ws, engRow(0, i), true, `$B$${base}`);
    });
  }
  return wb;
}

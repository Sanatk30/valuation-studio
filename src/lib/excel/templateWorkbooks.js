/**
 * The Comparable Company Analysis and Precedent Transactions workbooks, laid
 * out like the user's templates (Instructions · Inputs · Summary · Implied
 * Valuation · one sheet per company), for the chosen number of fiscal years,
 * YTD columns, peers / deals, statistics and multiples. Every derived cell is
 * a live formula; inputs are blue on cream.
 */
import ExcelJS from 'exceljs';
import { computeComps, COMPS_MULTIPLES, COMPS_BENCH, CONSENSUS_KEYS, peerSlots } from '../engine/comps.js';
import { computePrecedent, DEAL_MULTIPLES, DEAL_BENCH, dealSlots } from '../engine/precedent.js';
import { STAT_SHORT } from '../engine/templateStats.js';
import { CURRENCIES, UNITS } from '../format.js';
import { colL } from './xlsxUtil.js';
import { writeRegressionSheet } from './regressionSheet.js';
import { simpleRegressionCodes } from '../engine/simpleRegression.js';
import {
  T, NF, w, fx, title, note, hdr, writeCompanySheet, writeStats, statFormula, writeInstructions, pageCols,
} from './templateXlsx.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : null);
const text = (v) => (v === null || v === undefined ? '' : String(v));
const q = (name) => `'${name.replace(/'/g, "''")}'!`;
/** An ISO date string → a Date for Excel (null when blank / invalid). */
const date = (s) => {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

function newBook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Quant Value';
  wb.calcProperties = { fullCalcOnLoad: true };
  return wb;
}
const unitsOf = (a) => {
  const sym = CURRENCIES[a.settings?.currency]?.symbol || '';
  const unit = UNITS[a.settings?.unit] || a.settings?.unit || '';
  return { sym, unit, unitLabel: `${sym} ${unit}`.trim() };
};

/* ==================================================================== */
/*                        Comparable companies                          */
/* ==================================================================== */

export function buildCompsWorkbook(a, { skipped = {} } = {}) {
  const c = computeComps(a);
  const s = c.settings;
  const n = c.n, ytd = c.ytd, lab = c.labels, sel = c.statSel;
  const { sym, unit, unitLabel } = unitsOf(a);
  const slots = peerSlots(a.comps);
  const tiersOn = c.tiers.length > 0;
  const multiReg = !skipped.regression && !!a.regression?.yVar;
  const wb = newBook();

  /* ---------------- Instructions ---------------- */
  writeInstructions(wb.addWorksheet('Instructions'), {
    heading: 'Comparable Company Analysis (Trading Comps)',
    units: `All amounts in ${unitLabel} unless stated (share price and EPS in ${sym}, share counts in ${unit}).`,
    steps: [
      ['1. Inputs sheet', `Price date, lease and investment toggles, period labels and, for the target + ${slots.length} peer${slots.length === 1 ? '' : 's'}: name, ticker, sector, include flag, share price and the share data for the treasury stock method (basic shares, options & exercise price, convertibles)${tiersOn ? ', and tier' : ''}.`],
      ['2. Company sheets', `'Target' and 'Peer 1'…'Peer ${slots.length}' share the same layout. Fill the Income Statement, Balance Sheet and Cash Flow from annual reports / exchange filings (consolidated figures).`],
      ['3. Columns', `${n} historical fiscal year${n === 1 ? '' : 's'}${ytd ? ', then Prior-Year YTD and Current YTD' : ''}, then LTM.`],
      ['4. How LTM works', ytd ? 'P&L and cash flow: LTM = Latest FY + Current YTD − Prior YTD. If YTD columns are left blank, LTM equals the latest FY. Balance sheet: the LTM column uses the interim balance sheet if you enter one, otherwise the latest FY.' : 'No YTD columns: LTM equals the latest fiscal year, for the P&L, cash flow and balance sheet.'],
      ['5. Sign convention', 'Income statement: enter expenses as POSITIVE numbers. Exceptional items: gain +, loss −. Cash flow: enter outflows as NEGATIVE numbers, exactly as reported.'],
      ['6. Checks', 'Each company sheet has a balance sheet check row – it must show 0.0. Compare the computed PBT and PAT with the reported figures.'],
      ['7. Comps Summary', `Pulls multiples and operating metrics for all companies. Peer statistics (${sel.show.map((k) => STAT_SHORT[k]).join(', ') || 'none shown'}; ${sel.method === 'exc' ? 'exclusive' : 'inclusive'} percentiles) use only peers flagged 1 in 'Include in Stats'; the target is always excluded.${tiersOn ? ' Statistics are also shown per tier.' : ''}`],
      ['8. Implied Valuation', `Applies the peer ${STAT_SHORT[sel.low]} / ${STAT_SHORT[sel.mid]} / ${STAT_SHORT[sel.high]} multiples (LTM, latest FY and forward) to the target to give implied equity value and share price. EV-based methods add back the target's non-operating investments.`],
      ['9. NM', "'NM' = not meaningful (negative or zero denominator, e.g. negative EBITDA or loss-making P/E). NM values are excluded from statistics."],
      ['10. Consensus', 'Enter consensus FY+1 / FY+2 Revenue, EBITDA and PAT for forward multiples – the primary basis in sell-side and banking comps.'],
      ['11. Regression', 'Optional OLS of a peer multiple on a value driver (e.g. EV/EBITDA vs EBITDA margin) with t-stat, p-value and a ±1 SE implied price range for the target.'],
      ...(multiReg ? [['12. Regression (multi-variable)', 'Explains a peer multiple with several operating metrics at once, solved live, and predicts the target’s multiple.']] : []),
    ],
    definitions: [
      ['EBITDA', 'Revenue from Operations − Operating Expenses (excludes Other Income).'],
      ['EBIT', 'EBITDA − Depreciation & Amortisation.'],
      ['Net Debt', 'Total Borrowings + Lease Liabilities (if toggle = 1) − Cash, Other Bank Balances and Current Investments.'],
      ['Enterprise Value', 'Market Cap (TSM diluted) + Net Debt + Non-controlling Interest − Non-operating investments (non-current investments, if the Inputs toggle = 1), all from the latest balance sheet.'],
      ['ROE / ROCE', 'Based on closing balances. ROCE = EBIT / (Total Equity + Borrowings + Lease Liabilities).'],
      ['Working capital days', 'Inventory & payable days on Cost of Materials; receivable days on Revenue; 365-day year.'],
    ],
  });

  /* ---------------- Inputs ---------------- */
  const inp = wb.addWorksheet('Inputs');
  [26, 34, 16, 24, 14, 16, 22, 16, 16, 16, 16, 18, 14, 14].forEach((wd, i) => { inp.getColumn(i + 1).width = wd; });
  title(inp, 'A1', 'Inputs – General Settings & Company List');
  note(inp, 'A2', `Fill cream cells only. ${unitLabel} unless stated.`);
  w(inp, 'A4', 'General Settings', { bold: true });
  w(inp, 'A5', 'Share price date');
  w(inp, 'B5', date(s.priceDate), { input: true, fmt: NF.date });
  w(inp, 'A6', 'Currency & units');
  w(inp, 'B6', `${unitLabel}; share price in ${sym}; shares in ${unit}`);
  w(inp, 'A7', 'Include lease liabilities in EV? (1=Yes, 0=No)');
  w(inp, 'B7', c.toggle, { input: true });
  note(inp, 'C7', 'Default 1: under Ind AS 116, rent is below EBITDA, so leases are debt-like.');
  w(inp, 'A8', 'Deduct non-current investments from EV? (1=Yes, 0=No)');
  w(inp, 'B8', c.inv, { input: true });
  note(inp, 'C8', 'Default 1: associates, JVs and strategic stakes are non-operating – their value is not earned through EBITDA, so leaving them in EV overstates EV/EBITDA. Set 0 if the investments are operating.');
  w(inp, 'A10', 'Period Labels (edit to match your data)', { bold: true });
  let r = 11;
  const labelRef = { fy: [] };
  lab.fy.forEach((l, i) => {
    w(inp, `A${r}`, i === n - 1 ? `Historical year ${i + 1} (latest FY)` : `Historical year ${i + 1}`);
    w(inp, `B${r}`, l, { input: true });
    if (i === 0) note(inp, `C${r}`, 'Labels only – change freely.');
    labelRef.fy.push(`Inputs!$B$${r}`);
    r++;
  });
  if (ytd) {
    w(inp, `A${r}`, 'Prior-year YTD'); w(inp, `B${r}`, lab.p, { input: true }); labelRef.p = `Inputs!$B$${r}`; r++;
    w(inp, `A${r}`, 'Current YTD'); w(inp, `B${r}`, lab.c, { input: true }); labelRef.c = `Inputs!$B$${r}`; r++;
  }
  w(inp, `A${r}`, 'LTM'); w(inp, `B${r}`, lab.ltm, { input: true }); labelRef.ltm = `Inputs!$B$${r}`; r++;
  w(inp, `A${r}`, 'Forecast year 1 (consensus)'); w(inp, `B${r}`, lab.f1, { input: true }); labelRef.f1 = `Inputs!$B$${r}`;
  note(inp, `C${r}`, 'Labels for the forward (consensus) columns – data goes on the Consensus sheet.'); r++;
  w(inp, `A${r}`, 'Forecast year 2 (consensus)'); w(inp, `B${r}`, lab.f2, { input: true }); labelRef.f2 = `Inputs!$B$${r}`; r++;
  r++;
  w(inp, `A${r}`, 'Company List', { bold: true }); r++;
  const listHead = r;
  ['Role', 'Company Name', 'NSE / BSE Ticker', 'Sector / Sub-sector', 'Include in Stats (1/0)', `Share Price (${sym})`, `Diluted Shares (${unit}) – TSM, calculated`, `Market Cap (${unitLabel})`,
    `Basic Shares Outstanding (${unit})`, `Options / ESOPs Outstanding (${unit})`, `Weighted Avg. Exercise Price (${sym})`, `Convertibles: Shares on Conversion (${unit})`, `Conversion Price (${sym})`, ...(tiersOn ? ['Tier'] : [])]
    .forEach((h, i) => hdr(inp, `${colL(i + 1)}${r}`, h));
  inp.getRow(r).height = 42;
  r++;
  const listRow = {};
  const listLine = (role, name, x, include, tier) => {
    w(inp, `A${r}`, role, { bold: true });
    w(inp, `B${r}`, text(name), { input: true });
    w(inp, `C${r}`, text(x.ticker), { input: true });
    w(inp, `D${r}`, text(x.sector), { input: true });
    if (include === 'n.a.') w(inp, `E${r}`, 'n.a.', { fill: T.na, align: 'center' });
    else w(inp, `E${r}`, include, { input: true, align: 'center' });
    w(inp, `F${r}`, num(x.price), { input: true, fmt: NF.n2 });
    // treasury stock method: basic + in-the-money options × (1 − exercise ÷ price) + in-the-money convertibles
    w(inp, `G${r}`, fx(`IF(ISNUMBER(I${r}),I${r}+IF(AND(ISNUMBER(J${r}),ISNUMBER(K${r}),F${r}>K${r}),J${r}*(1-K${r}/F${r}),0)+IF(AND(ISNUMBER(L${r}),ISNUMBER(M${r}),F${r}>M${r}),L${r},0),0)`), { fmt: NF.n2 });
    w(inp, `H${r}`, fx(`F${r}*G${r}`), { fmt: NF.n1 });
    w(inp, `I${r}`, num(x.shares), { input: true, fmt: NF.n2 });
    w(inp, `J${r}`, num(x.options), { input: true, fmt: NF.n2 });
    w(inp, `K${r}`, num(x.exPrice), { input: true, fmt: NF.n2 });
    w(inp, `L${r}`, num(x.convShares), { input: true, fmt: NF.n2 });
    w(inp, `M${r}`, num(x.convPrice), { input: true, fmt: NF.n2 });
    if (tiersOn) w(inp, `N${r}`, include === 'n.a.' ? '' : tier, { input: true });
    return r++;
  };
  const tCo = a.comps?.target || {};
  listRow.target = listLine('Target', a.company?.name, tCo, 'n.a.', '');
  listRow.peers = slots.map((p, k) => listLine(`Peer ${k + 1}`, p.name, p, p.include === 0 ? 0 : 1, c.peers[k].tier));
  inp.views = [{ state: 'frozen', xSplit: 0, ySplit: listHead, topLeftCell: `A${listHead + 1}` }];
  r++;
  note(inp, `A${r}`, 'Notes: Use consolidated financials for all companies. Diluted shares use the treasury stock method (TSM): basic shares + in-the-money options × (1 − exercise price ÷ share price) + in-the-money convertibles (if-converted – then remove that convertible from borrowings on the company sheet). Record your source for price and share data (e.g. NSE closing price on the price date).');

  /* ---------------- Consensus ---------------- */
  const cn = wb.addWorksheet('Consensus');
  cn.getColumn(1).width = 34;
  for (let i = 2; i <= 7; i++) cn.getColumn(i).width = 15;
  cn.getColumn(8).width = 30;
  title(cn, 'A1', 'Consensus Forecasts – for forward (NTM-style) multiples');
  note(cn, 'A2', `${unitLabel}. Enter broker-consensus (or management-case for the target) Revenue, EBITDA and PAT attributable to owners for the next two fiscal years, on the same accounting basis as the company sheets (Ind AS 116, consolidated).`);
  hdr(cn, 'A4', 'Company');
  CONSENSUS_KEYS.forEach((k) => hdr(cn, `${k.col}4`, fx(`"${k.name} "&${k.period === 'f1' ? labelRef.f1 : labelRef.f2}`)));
  hdr(cn, 'H4', 'Source / date');
  cn.getRow(4).height = 30;
  const consRow = { target: 5, peers: slots.map((_, k) => 6 + k) };
  const consLine = (rr, listR, x) => {
    w(cn, `A${rr}`, fx(`IF(Inputs!$B$${listR}="",Inputs!$A$${listR},Inputs!$B$${listR})`), { link: true });
    CONSENSUS_KEYS.forEach((k) => w(cn, `${k.col}${rr}`, num(x?.cons?.[k.key]), { input: true, fmt: NF.n1 }));
    w(cn, `H${rr}`, text(x?.cons?.source), { input: true });
  };
  consLine(consRow.target, listRow.target, tCo);
  slots.forEach((p, k) => consLine(consRow.peers[k], listRow.peers[k], p));
  note(cn, `A${6 + slots.length + 1}`, 'Blank cells give NM for that forward multiple. Keep the price date on Inputs consistent with the consensus date.');
  cn.views = [{ state: 'frozen', xSplit: 1, ySplit: 4, topLeftCell: 'B5' }];

  /* ---------------- company sheets ---------------- */
  const addCo = (name, rowNo, cRow, x, placeholder) => {
    const ws = wb.addWorksheet(name);
    const ref = writeCompanySheet(ws, {
      page: x.page, n, ytd,
      title: fx(`IF(Inputs!$B$${rowNo}="","${placeholder}",Inputs!$B$${rowNo})`),
      subtitle: `Consolidated financials, ${unitLabel} unless stated. Expenses positive in P&L; outflows negative in cash flow.`,
      labels: { link: labelRef }, lease: 'Inputs!$B$7', inv: 'Inputs!$B$8',
      market: { kind: 'listed', price: `Inputs!$F$${rowNo}`, shares: `Inputs!$G$${rowNo}` },
      unitLabel, sym, unitWord: unit,
    });
    ref.cons = cRow;
    return ref;
  };
  const tRef = addCo('Target', listRow.target, consRow.target, tCo, '[Enter company name in Inputs]');
  const pRefs = slots.map((p, k) => addCo(`Peer ${k + 1}`, listRow.peers[k], consRow.peers[k], p, `Peer ${k + 1}`));

  /* ---------------- Comps Summary ---------------- */
  const cs = wb.addWorksheet('Comps Summary');
  cs.getColumn(1).width = 30; cs.getColumn(2).width = 13; cs.getColumn(3).width = 9;
  for (let i = 4; i <= 24; i++) cs.getColumn(i).width = 12;
  title(cs, 'A1', 'Comparable Company Analysis – Summary');
  w(cs, 'A2', fx(`"${unitLabel} unless stated | Prices as of "&IF(Inputs!$B$5="","[enter date in Inputs]",TEXT(Inputs!$B$5,"dd-mmm-yyyy"))`), { italic: true, size: 9, color: T.grey });

  const latestFyLabel = labelRef.fy[n - 1], ltmLabel = labelRef.ltm;
  const periodRef = (p) => ({ fy: latestFyLabel, ltm: ltmLabel, f1: labelRef.f1, f2: labelRef.f2 }[p]);
  const multHdr = (m) => (m.period === 'book' ? `"${m.name}"` : `"${m.name} "&${periodRef(m.period)}`);
  const metricRowOf = { rev: 7, ebitda: 14, ebit: 16, patOwners: 24 };
  const t1Cols = [
    { col: 'D', head: `"Share Price (${sym})"`, get: (ref) => ref.mkt(5), fmt: NF.n2 },
    { col: 'E', head: '"Market Cap"', get: (ref) => ref.mkt(7), fmt: NF.n1 },
    { col: 'F', head: '"Net Debt"', get: (ref) => ref.mkt(11), fmt: NF.n1 },
    { col: 'G', head: '"Enterprise Value"', get: (ref) => ref.mkt(14), fmt: NF.n1 },
    { col: 'H', head: `"Revenue "&${ltmLabel}`, get: (ref) => ref.ltm(7), fmt: NF.n1 },
    { col: 'I', head: `"EBITDA "&${ltmLabel}`, get: (ref) => ref.ltm(14), fmt: NF.n1 },
    { col: 'J', head: `"PAT "&${ltmLabel}`, get: (ref) => ref.ltm(24), fmt: NF.n1 },
    ...COMPS_MULTIPLES.map((m) => ({
      col: m.col, key: m.key, head: multHdr(m), fmt: NF.x, stat: true,
      get: (ref) => {
        const base = m.ev ? ref.mkt(14) : ref.mkt(7);
        if (m.cons) {
          const cc = `Consensus!${m.cons}${ref.cons}`;
          return `IF(ISNUMBER(${cc}),IF(${cc}<=0,"NM",${base}/${cc}),"NM")`;
        }
        const metric = m.metric === 'book' ? ref.mkt(15) : m.period === 'fy' ? ref.fy(metricRowOf[m.metric]) : ref.ltm(metricRowOf[m.metric]);
        return `IF(${metric}<=0,"NM",${base}/${metric})`;
      },
    })),
  ];
  const tierCol1 = 'X', tierCol2 = 'Q';
  const ratioRow = Object.fromEntries([['gRev', 92], ['gEbitda', 93], ['gPat', 94], ['ebitdaMargin', 96], ['patMargin', 98], ['roe', 99], ['roce', 100], ['de', 104], ['ndEbitda', 105], ['intCover', 106], ['ccc', 112], ['cfoEbitda', 114], ['fcfMargin', 115]]);
  const t2Cols = COMPS_BENCH.map((b) => ({
    col: b.col, key: b.key, stat: true,
    head: `"${b.name} "&${b.period === 'fy' ? latestFyLabel : ltmLabel}`,
    fmt: b.fmt === 'pct' ? NF.pct : b.fmt === 'x' ? NF.x : NF.n0,
    get: (ref) => (b.period === 'fy' ? ref.fy(ratioRow[b.key]) : ref.ltm(ratioRow[b.key])),
  }));

  /**
   * One summary table: header, target row, peer rows, helper columns, overall
   * and per-tier statistics. Returns the stats row numbers.
   */
  const table = (startRow, heading, cols, helperStart, tierCol) => {
    w(cs, `A${startRow}`, heading, { bold: true });
    const h = startRow + 1;
    hdr(cs, `A${h}`, 'Company'); hdr(cs, `B${h}`, 'Ticker'); hdr(cs, `C${h}`, 'Include');
    cols.forEach((col) => hdr(cs, `${col.col}${h}`, fx(col.head)));
    if (tiersOn) hdr(cs, `${tierCol}${h}`, 'Tier');
    cs.getRow(h).height = 42;
    const tr = h + 1;
    const row = (rr, ref, listR, isTarget) => {
      const st = isTarget ? { fill: T.cream } : {};
      w(cs, `A${rr}`, fx(`IF(Inputs!$B$${listR}="","${isTarget ? 'Target' : ref.name}",Inputs!$B$${listR})`), { link: true, bold: isTarget, ...st });
      w(cs, `B${rr}`, fx(`IF(Inputs!$C$${listR}="","",Inputs!$C$${listR})`), { link: true, ...st });
      if (isTarget) w(cs, `C${rr}`, 'n.a.', { align: 'center', ...st });
      else w(cs, `C${rr}`, fx(`Inputs!$E$${listR}`), { link: true, align: 'center' });
      cols.forEach((col) => w(cs, `${col.col}${rr}`, fx(col.get(ref)), { fmt: col.fmt, align: 'right', ...st }));
      if (tiersOn) {
        if (isTarget) w(cs, `${tierCol}${rr}`, '', st);
        else w(cs, `${tierCol}${rr}`, fx(`IF(Inputs!$N$${listR}="","",Inputs!$N$${listR})`), { link: true });
      }
    };
    row(tr, tRef, listRow.target, true);
    const p0 = tr + 1, p1 = tr + slots.length;
    pRefs.forEach((ref, k) => row(p0 + k, ref, listRow.peers[k], false));
    // helper columns: the included peers' numeric values (hidden)
    const statCols = cols.filter((col) => col.stat);
    const helper = (i, base) => colL(base + i);
    pRefs.forEach((_, k) => {
      const rr = p0 + k;
      statCols.forEach((col, i) => w(cs, `${helper(i, helperStart)}${rr}`, fx(`IF(AND($C${rr}=1,ISNUMBER(${col.col}${rr})),${col.col}${rr},"")`)));
    });
    for (let i = 0; i < statCols.length; i++) cs.getColumn(helperStart + i).hidden = true;
    let rr = p1 + 1;
    note(cs, `A${rr}`, 'Peer statistics (included peers only; target excluded)');
    rr++;
    const fmtOf = (x) => x.fmt;
    const statsAt = slots.length
      ? writeStats(cs, rr, { show: sel.show, cols: statCols.map((col, i) => ({ ...col, helper: helper(i, helperStart) })), rows: [p0, p1], method: sel.method, fmtOf })
      : {};
    rr += sel.show.length;
    // per-tier blocks: helper columns further right, one block per tier
    c.tiers.forEach((tg, ti) => {
      rr++;
      const base = helperStart + 20 + ti * 20;
      w(cs, `A${rr}`, 'Tier', { italic: true, size: 9, color: T.grey });
      w(cs, `B${rr}`, tg.name, { bold: true });
      note(cs, `C${rr}`, 'statistics — included peers in this tier');
      const nameCell = `$B$${rr}`;
      pRefs.forEach((_, k) => {
        const pr = p0 + k;
        statCols.forEach((col, i) => w(cs, `${helper(i, base)}${pr}`, fx(`IF(AND($C${pr}=1,$${tierCol}${pr}=${nameCell},ISNUMBER(${col.col}${pr})),${col.col}${pr},"")`)));
      });
      for (let i = 0; i < statCols.length; i++) cs.getColumn(base + i).hidden = true;
      rr++;
      writeStats(cs, rr, { show: sel.show, cols: statCols.map((col, i) => ({ ...col, helper: helper(i, base) })), rows: [p0, p1], method: sel.method, fmtOf });
      rr += sel.show.length;
    });
    return { statsAt, end: rr, p0, p1, targetRow: tr, statCols, helperStart };
  };

  const T1 = table(4, 'Table 1: Market Data & Valuation Multiples', t1Cols, 40, tierCol1);
  const t2Start = T1.end + 2;
  const T2 = table(t2Start, 'Table 2: Operating & Financial Benchmarking', t2Cols, 60, tierCol2);
  note(cs, `A${T2.end + 1}`, "Growth & cash-flow quality use the latest fiscal year (LTM growth needs prior-LTM data). 'NM' = not meaningful. Hidden columns from AN onward are helper cells for the statistics – do not delete. Forward multiples (S–W) use the Consensus sheet; EV excludes non-operating investments when the Inputs toggle = 1.");
  cs.views = [{ state: 'frozen', xSplit: 1, ySplit: 5, topLeftCell: 'B6' }];

  /* ---------------- Implied Valuation ---------------- */
  const iv = wb.addWorksheet('Implied Valuation');
  iv.getColumn(1).width = 26;
  for (let i = 2; i <= 11; i++) iv.getColumn(i).width = 13;
  title(iv, 'A1', 'Implied Valuation of Target (from Peer Multiples)');
  note(iv, 'A2', `${unitLabel} unless stated. Multiples from Comps Summary peer statistics.`);
  w(iv, 'A4', 'Target Company'); w(iv, 'B4', fx(`IF(Inputs!$B$${listRow.target}="","[Target]",Inputs!$B$${listRow.target})`), { bold: true, link: true });
  const ivRow = [['A5', `Current Share Price (${sym})`, 5, NF.n2], ['A6', `Diluted Shares (${unit})`, 6, NF.n2], ['A7', 'Market Cap', 7, NF.n1], ['A8', 'Net Debt', 11, NF.n1], ['A9', 'Non-controlling Interest', 12, NF.n1], ['A10', 'Enterprise Value', 14, NF.n1], ['A11', 'Non-operating investments (added back to EV-based equity)', 13, NF.n1]];
  for (const [addr, label, mr, fmt] of ivRow) { w(iv, addr, label); w(iv, `B${addr.slice(1)}`, fx(tRef.mkt(mr)), { link: true, fmt }); }
  const S = STAT_SHORT;
  ['Method', 'Target Metric', `Peer ${S[sel.low]}`, `Peer ${S[sel.mid]}`, `Peer ${S[sel.high]}`,
    `Equity Value @${S[sel.low]}`, `Equity Value @${S[sel.mid]}`, `Equity Value @${S[sel.high]}`,
    `Price/Share @${S[sel.low]} (${sym})`, `Price/Share @${S[sel.mid]} (${sym})`, `Price/Share @${S[sel.high]} (${sym})`]
    .forEach((h, i) => hdr(iv, `${colL(i + 1)}12`, h));
  iv.getRow(12).height = 31.5;
  const used = c.implied;
  const statCell = (m, key) => {
    const at = T1.statsAt[key];
    if (at) return `'Comps Summary'!$${m.col}$${at}`;
    const i = T1.statCols.findIndex((x) => x.key === m.key);
    const hc = colL(T1.helperStart + i);
    return statFormula(key, `'Comps Summary'!$${hc}$${T1.p0}:$${hc}$${T1.p1}`, sel.method);
  };
  // the target's metric for a multiple: its page, or for a forward multiple its own consensus (Consensus row 5)
  const targetMetric = (m) => (m.cons ? `Consensus!$${m.cons}$${consRow.target}` : m.metricKey === 'book' ? tRef.mkt(15) : m.period === 'fy' ? tRef.fy(metricRowOf[m.metricKey]) : tRef.ltm(metricRowOf[m.metricKey]));
  used.forEach((m, i) => {
    const rr = 13 + i;
    w(iv, `A${rr}`, fx(multHdr(m)));
    w(iv, `B${rr}`, fx(targetMetric(m)), { link: true, fmt: NF.n1 });
    ['C', 'D', 'E'].forEach((col, j) => {
      const key = [sel.low, sel.mid, sel.high][j];
      w(iv, `${col}${rr}`, fx(slots.length ? statCell(m, key) : '"NM"'), { link: true, fmt: NF.x, align: 'right' });
    });
    ['F', 'G', 'H'].forEach((col, j) => {
      const mc = ['C', 'D', 'E'][j];
      const eq = m.ev ? `${mc}${rr}*$B${rr}-$B$8-$B$9+$B$11` : `${mc}${rr}*$B${rr}`;
      w(iv, `${col}${rr}`, fx(`IF(AND(ISNUMBER(${mc}${rr}),ISNUMBER($B${rr}),$B${rr}>0),${eq},"NM")`), { fmt: NF.n1, align: 'right' });
    });
    ['I', 'J', 'K'].forEach((col, j) => {
      const ec = ['F', 'G', 'H'][j];
      w(iv, `${col}${rr}`, fx(`IF(AND(ISNUMBER(${ec}${rr}),$B$6>0),IF(${ec}${rr}>0,${ec}${rr}/$B$6,"NM"),"NM")`), { fmt: NF.n2, align: 'right' });
    });
  });
  const lastM = 12 + Math.max(1, used.length);
  const sumRow = lastM + 2;
  const summary = writeImpliedSummary(iv, sumRow, lastM, sym, 'Upside / (Downside) to median-based price', S[sel.mid]);
  note(iv, `A${summary.end + 2}`, "EV-based methods: Equity Value = Multiple × Metric − Net Debt − NCI + Non-operating investments. Equity-based methods (P/E, P/B): Equity Value = Multiple × Metric. A negative implied equity value shows NM. Forward multiples apply peer consensus multiples to the target's own forecast (Consensus sheet row 5). Banks typically anchor on forward EV/EBITDA and P/E; EV/Revenue only for early-stage or loss-making businesses.");

  /* ---------------- Regression (the template's single-driver sheet, always) ---------------- */
  const order = ['Instructions', 'Inputs', 'Consensus', 'Comps Summary', 'Implied Valuation'];
  if (slots.length) {
    writeSimpleRegression(wb.addWorksheet('Regression'), { T1, T2, tRef, labelRef, consTarget: consRow.target, peers: slots.length, sym, codes: simpleRegressionCodes(a.regression) });
    order.push('Regression');
  }

  /* ---------------- Regression (multi-variable), the app's optional workbench ---------------- */
  if (multiReg) {
    const byId = Object.fromEntries(c.peers.map((p, k) => [p.id, k]));
    const t1Col = Object.fromEntries(COMPS_MULTIPLES.map((m) => [m.key, m.col]));
    const t2Col = Object.fromEntries(COMPS_BENCH.map((b) => [b.key, { col: b.col, pct: b.fmt === 'pct' }]));
    const cellFor = (rowT1, rowT2, key) => {
      if (t1Col[key]) return `'Comps Summary'!$${t1Col[key]}$${rowT1}`;
      if (t2Col[key]) return t2Col[key].pct ? `'Comps Summary'!$${t2Col[key].col}$${rowT2}*100` : `'Comps Summary'!$${t2Col[key].col}$${rowT2}`;
      if (key === 'revSize') return `'Comps Summary'!$H$${rowT1}`;
      if (key === 'mcapSize') return `'Comps Summary'!$E$${rowT1}`;
      return null;
    };
    const reg = wb.addWorksheet(MULTI_REG_SHEET);
    writeRegressionSheet(reg, a, legacyFormats(sym), {
      peerName: (id) => `'Comps Summary'!$A$${T1.p0 + byId[id]}`,
      peerCell: (id, key) => cellFor(T1.p0 + byId[id], T2.p0 + byId[id], key),
      targetCell: (key) => cellFor(T1.targetRow, T2.targetRow, key),
      metric: (m) => (m.cons ? `Consensus!$${m.cons}$${consRow.target}` : m.metric === 'book' ? tRef.mkt(15) : m.period === 'fy' ? tRef.fy(metricRowOf[m.metric]) : tRef.ltm(metricRowOf[m.metric])),
      netDebt: tRef.mkt(11), nci: tRef.mkt(12), nonOp: tRef.mkt(13), shares: tRef.mkt(6),
    });
    order.push(MULTI_REG_SHEET);
  }
  order.push('Target', ...pRefs.map((x) => x.name));
  arrange(wb, order);
  return wb;
}

/** The app's multi-variable regression sheet (the template's own sheet is 'Regression'). */
export const MULTI_REG_SHEET = 'Regression (multi-variable)';

/** The template's Regression sheet: OLS of one peer multiple on one value driver, live formulas. */
function writeSimpleRegression(ws, { T1, T2, tRef, labelRef, consTarget, peers, sym, codes }) {
  ws.getColumn(1).width = 44;
  for (let i = 2; i <= 8; i++) ws.getColumn(i).width = 14;
  ws.getColumn(4).width = 18;
  title(ws, 'A1', 'Regression Analysis – Peer Multiple vs Value Driver');
  note(ws, 'A2', 'Ordinary least squares on included peers (Include = 1, a market cap above 0, both values numeric, NM excluded). Needs at least 3 observations. Pick the variables with the codes below.');
  w(ws, 'A4', 'Dependent variable y (multiple) – code');
  w(ws, 'B4', codes.y, { input: true, align: 'center' });
  w(ws, 'C4', fx(`CHOOSE($B$4,"EV / Revenue LTM","EV / EBITDA LTM","P / E LTM","EV / EBITDA "&${labelRef.f1},"P / E "&${labelRef.f1})`), { bold: true });
  note(ws, 'D4', '1 EV/Revenue LTM · 2 EV/EBITDA LTM · 3 P/E LTM · 4 EV/EBITDA FY+1 · 5 P/E FY+1');
  w(ws, 'A5', 'Explanatory variable x (driver) – code');
  w(ws, 'B5', codes.x, { input: true, align: 'center' });
  w(ws, 'C5', fx('CHOOSE($B$5,"Revenue growth","EBITDA growth","PAT growth","EBITDA margin","PAT margin","ROE","ROCE")'), { bold: true });
  note(ws, 'D5', '1 Revenue growth · 2 EBITDA growth · 3 PAT growth · 4 EBITDA margin · 5 PAT margin · 6 ROE · 7 ROCE (latest, from Comps Summary Table 2)');
  ['Company', 'Include', 'x (driver)', 'y (multiple)', 'x used', 'y used', 'Fitted y', 'Residual'].forEach((h, i) => hdr(ws, `${colL(i + 1)}7`, h));
  const last = 7 + peers, tr = 8 + peers;
  const xCh = (r2) => `CHOOSE($B$5,${['D', 'E', 'F', 'G', 'H', 'I', 'J'].map((cc) => `'Comps Summary'!${cc}${r2}`).join(',')})`;
  const yCh = (r1) => `CHOOSE($B$4,${['L', 'N', 'Q', 'T', 'V'].map((cc) => `'Comps Summary'!${cc}${r1}`).join(',')})`;
  const s0 = tr + 2;
  const R = { n: s0 + 1, slope: s0 + 2, icpt: s0 + 3, r2: s0 + 4, se: s0 + 5, seSlope: s0 + 6, t: s0 + 7, p: s0 + 8, x: s0 + 11, yhat: s0 + 12, seMean: s0 + 13, lo: s0 + 14, hi: s0 + 15, metric: s0 + 18, isEv: s0 + 19, px: s0 + 20, pxLo: s0 + 21, pxHi: s0 + 22 };
  for (let k = 0; k < peers; k++) {
    const rr = 8 + k;
    w(ws, `A${rr}`, fx(`'Comps Summary'!$A$${T1.p0 + k}`), { link: true });
    w(ws, `B${rr}`, fx(`'Comps Summary'!$C$${T1.p0 + k}`), { link: true, align: 'center' });
    w(ws, `C${rr}`, fx(xCh(T2.p0 + k)), { fmt: '0.0%;(0.0%);-' });
    w(ws, `D${rr}`, fx(yCh(T1.p0 + k)), { fmt: NF.x });
    // a peer with no share price (or shares) has a market cap of 0: its multiples are meaningless, so it stays out of the fit
    const priced = `'Comps Summary'!$E$${T1.p0 + k}>0`;
    w(ws, `E${rr}`, fx(`IF(AND(B${rr}=1,${priced},ISNUMBER(C${rr}),ISNUMBER(D${rr})),C${rr},"")`), { fmt: '0.0%;(0.0%);-' });
    w(ws, `F${rr}`, fx(`IF(AND(B${rr}=1,${priced},ISNUMBER(C${rr}),ISNUMBER(D${rr})),D${rr},"")`), { fmt: NF.x });
    w(ws, `G${rr}`, fx(`IF(AND(ISNUMBER(E${rr}),ISNUMBER($B$${R.slope})),$B$${R.icpt}+$B$${R.slope}*E${rr},"")`), { fmt: NF.x });
    w(ws, `H${rr}`, fx(`IF(ISNUMBER(G${rr}),F${rr}-G${rr},"")`), { fmt: NF.x });
  }
  w(ws, `A${tr}`, fx(`'Comps Summary'!$A$${T1.targetRow}&" (target – not in the fit)"`), { link: true, italic: true, fill: T.cream });
  w(ws, `C${tr}`, fx(xCh(T2.targetRow)), { fmt: '0.0%;(0.0%);-', fill: T.cream });
  w(ws, `D${tr}`, fx(yCh(T1.targetRow)), { fmt: NF.x, fill: T.cream });
  const E = `E8:E${last}`, F = `F8:F${last}`;
  const sec = (rr, t) => w(ws, `A${rr}`, t, { bold: true, fill: T.sec });
  const line = (rr, label, f, fmt, o = {}) => { w(ws, `A${rr}`, label); w(ws, `B${rr}`, fx(f), { fmt, align: 'right', ...o }); };
  sec(s0, 'MODEL STATISTICS');
  line(R.n, 'Observations (n)', `COUNT(${E})`, '0');
  line(R.slope, 'Slope (β1)', `IF(B${R.n}>=3,SLOPE(${F},${E}),"NA")`, '0.000');
  line(R.icpt, 'Intercept (β0)', `IF(B${R.n}>=3,INTERCEPT(${F},${E}),"NA")`, '0.000');
  line(R.r2, 'R²', `IF(B${R.n}>=3,RSQ(${F},${E}),"NA")`, '0.000');
  line(R.se, 'Standard error of regression', `IF(B${R.n}>=3,STEYX(${F},${E}),"NA")`, '0.000');
  line(R.seSlope, 'Std error of slope', `IFERROR(B${R.se}/SQRT(DEVSQ(${E})),"NA")`, '0.000');
  line(R.t, 't-stat of slope', `IFERROR(B${R.slope}/B${R.seSlope},"NA")`, '0.00');
  line(R.p, 'p-value of slope (two-tailed)', `IFERROR(TDIST(ABS(B${R.t}),B${R.n}-2,2),"NA")`, '0.000');
  sec(s0 + 10, 'PREDICTION FOR THE TARGET');
  line(R.x, 'Target x', `C${tr}`, '0.0%;(0.0%);-');
  line(R.yhat, 'Predicted multiple ŷ', `IFERROR(B${R.icpt}+B${R.slope}*B${R.x},"NA")`, NF.x, { bold: true });
  line(R.seMean, 'Std error of mean prediction', `IFERROR(B${R.se}*SQRT(1/B${R.n}+(B${R.x}-AVERAGE(${E}))^2/DEVSQ(${E})),"NA")`, '0.000');
  line(R.lo, 'Predicted multiple −1 SE', `IFERROR(B${R.yhat}-B${R.seMean},"NA")`, NF.x);
  line(R.hi, 'Predicted multiple +1 SE', `IFERROR(B${R.yhat}+B${R.seMean},"NA")`, NF.x);
  sec(s0 + 17, 'IMPLIED SHARE PRICE');
  line(R.metric, 'Target metric for the chosen multiple', `CHOOSE($B$4,${tRef.ltm(7)},${tRef.ltm(14)},${tRef.ltm(24)},Consensus!$D$${consTarget},Consensus!$F$${consTarget})`, NF.n1, { link: true });
  line(R.isEv, 'EV-based multiple? (1/0)', 'CHOOSE($B$4,1,1,0,1,0)', '0');
  const px = (src) => `IFERROR(IF(AND(ISNUMBER(B${src}),ISNUMBER(B${R.metric}),B${R.metric}>0,${tRef.mkt(6)}>0),IF(B${R.isEv}=1,B${src}*B${R.metric}-${tRef.mkt(11)}-${tRef.mkt(12)}+${tRef.mkt(13)},B${src}*B${R.metric})/${tRef.mkt(6)},"NA"),"NA")`;
  line(R.px, `Implied price (${sym}) – predicted`, px(R.yhat), NF.n2, { bold: true });
  line(R.pxLo, `Implied price (${sym}) – −1 SE`, px(R.lo), NF.n2);
  line(R.pxHi, `Implied price (${sym}) – +1 SE`, px(R.hi), NF.n2);
  note(ws, `A${s0 + 24}`, 'Read with care: R² below ~0.5 or a p-value above ~0.10 means the driver explains little of the peer multiples – fall back on the median multiple. Check the residuals for outliers before relying on the fit.');
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 7, topLeftCell: 'B8' }];
  return R;
}

/** Summary (all methods) block under an implied-valuation table; rows 13…lastM. */
function writeImpliedSummary(ws, r0, lastM, sym, upsideLabel, midShort) {
  w(ws, `A${r0}`, 'Summary (all methods)', { bold: true });
  const rng = `I13:K${lastM}`, mid = `J13:J${lastM}`;
  w(ws, `A${r0 + 1}`, `Lowest implied price (${sym})`); w(ws, `B${r0 + 1}`, fx(`IF(COUNT(${rng})=0,"NM",MIN(${rng}))`), { fmt: NF.n2, align: 'right' });
  w(ws, `A${r0 + 2}`, `Median of ${midShort.toLowerCase()}-based prices (${sym})`); w(ws, `B${r0 + 2}`, fx(`IF(COUNT(${mid})=0,"NM",MEDIAN(${mid}))`), { fmt: NF.n2, align: 'right', bold: true });
  w(ws, `A${r0 + 3}`, `Highest implied price (${sym})`); w(ws, `B${r0 + 3}`, fx(`IF(COUNT(${rng})=0,"NM",MAX(${rng}))`), { fmt: NF.n2, align: 'right' });
  w(ws, `A${r0 + 4}`, `Current share price (${sym})`); w(ws, `B${r0 + 4}`, fx('$B$5'), { fmt: NF.n2, align: 'right' });
  w(ws, `A${r0 + 5}`, upsideLabel); w(ws, `B${r0 + 5}`, fx(`IF(AND(ISNUMBER(B${r0 + 2}),$B$5>0),B${r0 + 2}/$B$5-1,"NM")`), { fmt: NF.pct, align: 'right', bold: true });
  return { lowest: r0 + 1, medianMid: r0 + 2, highest: r0 + 3, current: r0 + 4, upside: r0 + 5, end: r0 + 5 };
}

/** The number formats the regression sheet uses (xlsxUtil.makeFormats shape). */
function legacyFormats(sym) {
  return {
    num: '#,##0.00;(#,##0.00);-', num3: '0.000;(0.000);-', int: '0', pct2: '0.00%', x2: '0.00x',
    money: '#,##0.0;(#,##0.0);-', price: `"${sym}"#,##0.00;("${sym}"#,##0.00)`,
  };
}

/** Tab order: the listed sheets first, in order (ExcelJS writes the tabs by orderNo). */
function arrange(wb, order) {
  const rank = new Map(order.map((nm, i) => [nm, i]));
  wb.worksheets.forEach((ws, i) => { ws.orderNo = rank.has(ws.name) ? rank.get(ws.name) : order.length + i; });
}

/* ==================================================================== */
/*                      Precedent transactions                          */
/* ==================================================================== */

export function buildPrecedentWorkbook(a) {
  const p = computePrecedent(a);
  const s = p.settings;
  const n = p.n, ytd = p.ytd, sel = p.statSel;
  const { sym, unit, unitLabel } = unitsOf(a);
  const deals = dealSlots(a.precedent);
  const co = a.precedent?.company || {};
  const wb = newBook();

  writeInstructions(wb.addWorksheet('Instructions'), {
    heading: 'Precedent Transactions Analysis',
    units: `All amounts in ${unitLabel} unless stated (share prices in ${sym}, share counts in ${unit}).`,
    steps: [
      ['1. Inputs sheet', 'Settings, the company you are valuing, and the deal list: announcement date, target, acquirer, stake acquired, consideration paid, and (for listed targets) offer price and unaffected price.'],
      ['2. Implied equity value', 'Calculated as Consideration Paid ÷ Stake Acquired, i.e. grossed up to a 100% value. Minority-stake deals usually carry no control premium – consider excluding them.'],
      ['3. Deal sheets', `'Deal 1'…'Deal ${deals.length}' hold each target's financials AS OF THE ANNOUNCEMENT DATE (not today). Edit the period labels in row 4 of each sheet – they differ deal to deal.`],
      ['4. LTM', ytd ? 'P&L and cash flow: LTM = Latest FY before announcement + Current YTD − Prior YTD. Balance sheet: last reported balance sheet before announcement (interim if entered, else latest FY).' : 'No YTD columns: LTM = the latest fiscal year before announcement, for every statement.'],
      ['5. Company Being Valued sheet', 'Same layout – enter the company you are valuing with its latest financials. Its LTM figures are what the deal multiples are applied to.'],
      ['6. Sign convention', 'Income statement: expenses POSITIVE; exceptional items gain +, loss −. Cash flow: outflows NEGATIVE, as reported.'],
      ['7. Checks', 'Each sheet has a balance sheet check row that must show 0.0.'],
      ['8. Transaction Summary', `Transaction multiples (LTM at announcement) and control premia, with statistics (${sel.show.map((k) => STAT_SHORT[k]).join(', ') || 'none shown'}; ${sel.method === 'exc' ? 'exclusive' : 'inclusive'} percentiles) across deals flagged 1 in 'Include'. Empty deal rows are set to 0 – set a row to 1 once you fill it in.`],
      ['9. Implied Valuation', `Applies the deal ${STAT_SHORT[sel.low]} / ${STAT_SHORT[sel.mid]} / ${STAT_SHORT[sel.high]} multiples and control premium to the company being valued.`],
      ['10. Cross-border deals', `Convert all foreign-currency figures to ${unitLabel} at the exchange rate on the announcement date, and note the rate in the Source column.`],
    ],
    definitions: [
      ['Implied Equity Value (100%)', 'Consideration Paid ÷ Stake Acquired. Left blank (or zero) the deal shows NM. For listed targets cross-check against Offer Price × target diluted shares.'],
      ['Net Debt', "Borrowings + Lease Liabilities (if toggle = 1) − Cash, Other Bank Balances and Current Investments, from the target's last balance sheet before announcement."],
      ['Implied Enterprise Value', 'Implied Equity Value (100%) + Net Debt + Non-controlling Interest − Non-operating investments (if the Inputs toggle = 1).'],
      ['Control Premium', 'Offer Price ÷ Unaffected Share Price − 1. Use an unaffected price before any deal rumours, e.g. 1 day or 4 weeks before announcement – be consistent across deals.'],
      ['EBITDA / EBIT', 'EBITDA = Revenue − Operating Expenses (excl. Other Income); EBIT = EBITDA − D&A.'],
    ],
  });

  /* ---------------- Inputs ---------------- */
  const inp = wb.addWorksheet('Inputs');
  [12, 14, 26, 22, 14, 12, 14, 16, 14, 12, 10, 12, 12, 12, 10, 30].forEach((wd, i) => { inp.getColumn(i + 1).width = wd; });
  title(inp, 'A1', 'Inputs – Settings, Company Being Valued & Deal List');
  note(inp, 'A2', `Fill cream cells only. ${unitLabel} unless stated.`);
  w(inp, 'A4', 'General Settings', { bold: true });
  w(inp, 'A5', 'Valuation date'); w(inp, 'B5', date(s.valDate), { input: true, fmt: NF.date });
  w(inp, 'A6', 'Currency & units'); w(inp, 'B6', `${unitLabel}; share price in ${sym}; shares in ${unit}`);
  w(inp, 'A7', 'Include lease liabilities in EV? (1/0)'); w(inp, 'B7', p.toggle, { input: true });
  note(inp, 'C7', 'Apply the same treatment as your CCA workbook.');
  w(inp, 'A8', 'Deduct non-current investments from EV? (1/0)'); w(inp, 'B8', p.inv, { input: true });
  note(inp, 'C8', 'Default 1 – associates / JVs / strategic stakes are not valued through EBITDA. Apply the same setting as your CCA workbook.');
  w(inp, 'A10', 'Company Being Valued', { bold: true });
  const cbv = [['A11', 'Company name', text(a.company?.name)], ['A12', 'NSE / BSE ticker (if listed)', text(co.ticker)], ['A13', `Current share price (${sym}, if listed)`, num(co.price), NF.n2], ['A14', `Diluted shares outstanding (${unit})`, num(co.shares), NF.n2]];
  for (const [addr, label, v, fmt] of cbv) {
    const rr = addr.slice(1);
    w(inp, addr, label);
    inp.mergeCells(`A${rr}:B${rr}`);
    w(inp, `C${rr}`, v, { input: true, fmt });
  }
  w(inp, 'A16', 'Deal List', { bold: true });
  ['Deal', 'Announcement Date', 'Target', 'Acquirer', 'Acquirer Type', 'Stake Acquired (%)', `Consideration Paid (${unitLabel})`, `Implied 100% Equity Value (${unitLabel})`, 'Consideration Form', 'Status', 'Listed Target?', `Offer Price (${sym})`, `Unaffected Price (${sym})`, 'Control Premium', 'Include (1/0)', 'Source / Notes']
    .forEach((h, i) => hdr(inp, `${colL(i + 1)}17`, h));
  inp.getRow(17).height = 42;
  const dealRow = [];
  deals.forEach((d, k) => {
    const rr = 18 + k;
    dealRow.push(rr);
    w(inp, `A${rr}`, `Deal ${k + 1}`, { bold: true });
    w(inp, `B${rr}`, date(d.date), { input: true, fmt: NF.date });
    w(inp, `C${rr}`, text(d.target), { input: true });
    w(inp, `D${rr}`, text(d.acquirer), { input: true });
    w(inp, `E${rr}`, text(d.acquirerType), { input: true });
    w(inp, `F${rr}`, isNum(d.stakePct) ? d.stakePct / 100 : null, { input: true, fmt: NF.pct });
    w(inp, `G${rr}`, num(d.consideration), { input: true, fmt: NF.n1 });
    // a deal without a positive stake and consideration has no implied value: blank here, NM downstream
    w(inp, `H${rr}`, fx(`IF(AND(ISNUMBER(F${rr}),F${rr}>0,ISNUMBER(G${rr}),G${rr}>0),G${rr}/F${rr},"")`), { fmt: NF.n1 });
    w(inp, `I${rr}`, text(d.form), { input: true });
    w(inp, `J${rr}`, text(d.status), { input: true });
    w(inp, `K${rr}`, text(d.listed), { input: true, align: 'center' });
    w(inp, `L${rr}`, num(d.offerPrice), { input: true, fmt: NF.n2 });
    w(inp, `M${rr}`, num(d.unaffectedPrice), { input: true, fmt: NF.n2 });
    w(inp, `N${rr}`, fx(`IF(AND(K${rr}="Yes",M${rr}>0,L${rr}>0),L${rr}/M${rr}-1,"")`), { fmt: NF.pct });
    // the engine's flag: an empty deal slot (nothing entered) is 0, so it stays out of every statistic
    w(inp, `O${rr}`, p.deals[k].include, { input: true, align: 'center' });
    w(inp, `P${rr}`, text(d.source), { input: true });
  });
  inp.views = [{ state: 'frozen', xSplit: 0, ySplit: 17, topLeftCell: 'A18' }];

  /* ---------------- company sheets ---------------- */
  // each page's own period labels, exactly as the app shows them (years added in front continue the numbering)
  const cbvWs = wb.addWorksheet('Company Being Valued');
  const cRef = writeCompanySheet(cbvWs, {
    page: co.page, n, ytd,
    title: fx('IF(Inputs!$C$11="","Company Being Valued: [enter name in Inputs]","Company Being Valued: "&Inputs!$C$11)'),
    subtitle: `Latest available financials. Consolidated, ${unitLabel}. Expenses positive in P&L; outflows negative in cash flow.`,
    labels: { input: p.company.labels }, lease: 'Inputs!$B$7', inv: 'Inputs!$B$8',
    market: { kind: 'listed', price: 'Inputs!$C$13', shares: 'Inputs!$C$14', heading: 'Market Data & Net Debt (latest)', priceLabel: `Current Share Price (${sym})`, evLabel: 'Current Enterprise Value', bvps: false },
    unitLabel, sym, unitWord: unit,
  });
  const dRefs = deals.map((d, k) => {
    const rr = dealRow[k];
    const ws = wb.addWorksheet(`Deal ${k + 1}`);
    return writeCompanySheet(ws, {
      page: d.page, n, ytd,
      title: fx(`IF(Inputs!$C$${rr}="","Deal ${k + 1}: [enter target in Inputs]","Deal ${k + 1}: "&Inputs!$C$${rr}&IF(Inputs!$D$${rr}="",""," acquired by "&Inputs!$D$${rr})&IF(Inputs!$B$${rr}="",""," ("&TEXT(Inputs!$B$${rr},"dd-mmm-yyyy")&")"))`),
      subtitle: `Target financials AS OF ANNOUNCEMENT. Consolidated, ${unitLabel}. Expenses positive in P&L; outflows negative in cash flow.`,
      labels: { input: p.deals[k].labels }, lease: 'Inputs!$B$7', inv: 'Inputs!$B$8',
      market: { kind: 'deal', equity: `Inputs!$H$${rr}`, stake: `Inputs!$F$${rr}`, consideration: `Inputs!$G$${rr}` },
      unitLabel, sym, unitWord: unit,
    });
  });

  /* ---------------- Transaction Summary ---------------- */
  const ts = wb.addWorksheet('Transaction Summary');
  ts.getColumn(1).width = 10; ts.getColumn(2).width = 12; ts.getColumn(3).width = 24; ts.getColumn(4).width = 20; ts.getColumn(5).width = 14;
  for (let i = 6; i <= 19; i++) ts.getColumn(i).width = 12;
  title(ts, 'A1', 'Precedent Transactions – Summary');
  note(ts, 'A2', `${unitLabel} unless stated | Multiples on target LTM financials at announcement`);
  const ident = (rr, k) => {
    const ir = dealRow[k];
    w(ts, `A${rr}`, `Deal ${k + 1}`, { bold: true });
    w(ts, `B${rr}`, fx(`IF(Inputs!$B$${ir}="","",Inputs!$B$${ir})`), { link: true, fmt: NF.date });
    w(ts, `C${rr}`, fx(`IF(Inputs!$C$${ir}="","",Inputs!$C$${ir})`), { link: true });
    w(ts, `D${rr}`, fx(`IF(Inputs!$D$${ir}="","",Inputs!$D$${ir})`), { link: true });
    w(ts, `E${rr}`, fx(`IF(Inputs!$E$${ir}="","",Inputs!$E$${ir})`), { link: true });
    w(ts, `F${rr}`, fx(`Inputs!$F$${ir}`), { link: true, fmt: NF.pct });
    w(ts, `G${rr}`, fx(`Inputs!$O$${ir}`), { link: true, align: 'center' });
  };
  const idHead = (h) => ['Deal', 'Date', 'Target', 'Acquirer', 'Acquirer Type', 'Stake', 'Include'].forEach((x, i) => hdr(ts, `${colL(i + 1)}${h}`, x));
  const metricRow = { rev: 7, ebitda: 14, ebit: 16, patOwners: 24 };
  const t1 = [
    { col: 'H', key: 'equity', head: 'Implied Equity Value (100%)', fmt: NF.n1, stat: true, get: (ref) => `IFERROR(${ref.mkt(5)},"NM")` },
    { col: 'I', head: 'Net Debt', fmt: NF.n1, get: (ref) => ref.mkt(11) },
    { col: 'J', key: 'ev', head: 'Implied Enterprise Value', fmt: NF.n1, stat: true, get: (ref) => `IFERROR(${ref.mkt(14)},"NM")` },
    { col: 'K', head: 'LTM Revenue', fmt: NF.n1, get: (ref) => ref.ltm(7) },
    { col: 'L', head: 'LTM EBITDA', fmt: NF.n1, get: (ref) => ref.ltm(14) },
    { col: 'M', head: 'LTM PAT', fmt: NF.n1, get: (ref) => ref.ltm(24) },
    ...DEAL_MULTIPLES.map((m) => ({
      col: m.col, key: m.key, head: m.label, fmt: NF.x, stat: true,
      get: (ref) => {
        const metric = m.metric === 'book' ? ref.mkt(15) : ref.ltm(metricRow[m.metric]);
        // a blank deal (no implied equity) gives #VALUE! here → NM. Equity-based multiples also test the
        // equity is a number: Google Sheets / LibreOffice read the blank "" as 0 and would show 0, not NM
        return m.ev
          ? `IFERROR(IF(${metric}<=0,"NM",${ref.mkt(14)}/${metric}),"NM")`
          : `IFERROR(IF(ISNUMBER(${ref.mkt(5)}),IF(${metric}<=0,"NM",${ref.mkt(5)}/${metric}),"NM"),"NM")`;
      },
    })),
    { col: 'S', key: 'premium', head: 'Control Premium', fmt: NF.pct, stat: true, get: (_ref, k) => `Inputs!$N$${dealRow[k]}` },
  ];
  const benchRow = { gRev: 92, ebitdaMargin: 96, patMargin: 98, roe: 99, roce: 100, de: 104, ndEbitda: 105, ccc: 112, cfoEbitda: 114 };
  const t2 = DEAL_BENCH.map((b) => ({
    col: b.col, key: b.key, head: b.name, stat: true,
    fmt: b.fmt === 'pct' ? NF.pct : b.fmt === 'x' ? NF.x : NF.n0,
    get: (ref) => (b.period === 'fy' ? ref.fy(benchRow[b.key]) : ref.ltm(benchRow[b.key])),
  }));
  const dTable = (startRow, heading, cols, helperStart) => {
    w(ts, `A${startRow}`, heading, { bold: true });
    const h = startRow + 1;
    idHead(h);
    cols.forEach((col) => hdr(ts, `${col.col}${h}`, col.head));
    ts.getRow(h).height = 42;
    const d0 = h + 1, d1 = h + deals.length;
    const statCols = cols.filter((col) => col.stat);
    dRefs.forEach((ref, k) => {
      const rr = d0 + k;
      ident(rr, k);
      cols.forEach((col) => w(ts, `${col.col}${rr}`, fx(col.get(ref, k)), { fmt: col.fmt, align: 'right' }));
      statCols.forEach((col, i) => w(ts, `${colL(helperStart + i)}${rr}`, fx(`IF(AND($G${rr}=1,ISNUMBER(${col.col}${rr})),${col.col}${rr},"")`)));
    });
    for (let i = 0; i < statCols.length; i++) ts.getColumn(helperStart + i).hidden = true;
    let rr = d1 + 1;
    note(ts, `A${rr}`, 'Statistics (deals flagged 1 in Include only)');
    rr++;
    const statsAt = deals.length
      ? writeStats(ts, rr, { show: sel.show, cols: statCols.map((col, i) => ({ ...col, helper: colL(helperStart + i) })), rows: [d0, d1], method: sel.method, fmtOf: (x) => x.fmt })
      : {};
    return { statsAt, end: rr + sel.show.length, d0, d1, statCols, helperStart };
  };
  const D1 = dTable(4, 'Table 1: Deal Values & Transaction Multiples', t1, 40);
  const D2 = dTable(D1.end + 2, 'Table 2: Target Operating Profile at Announcement', t2, 60);
  note(ts, `A${D2.end + 1}`, "Compare the company being valued with Table 2 to decide which deals are most relevant. 'NM' = not meaningful. Hidden columns from AN onward are statistics helpers – do not delete.");
  ts.views = [{ state: 'frozen', xSplit: 1, ySplit: 5, topLeftCell: 'B6' }];

  /* ---------------- Implied Valuation ---------------- */
  const iv = wb.addWorksheet('Implied Valuation');
  iv.getColumn(1).width = 30;
  for (let i = 2; i <= 11; i++) iv.getColumn(i).width = 13;
  title(iv, 'A1', 'Implied Valuation from Precedent Transactions');
  note(iv, 'A2', `${unitLabel} unless stated. Transaction multiples include a control premium – they value a controlling stake.`);
  w(iv, 'A4', 'Company Being Valued'); w(iv, 'B4', fx('IF(Inputs!$C$11="","[enter in Inputs]",Inputs!$C$11)'), { bold: true, link: true });
  const ivRow = [['A5', `Current Share Price (${sym})`, 5, NF.n2], ['A6', `Diluted Shares (${unit})`, 6, NF.n2], ['A7', 'Market Cap', 7, NF.n1], ['A8', 'Net Debt', 11, NF.n1], ['A9', 'Non-controlling Interest', 12, NF.n1], ['A10', 'Current Enterprise Value', 14, NF.n1], ['A11', 'Non-operating investments (added back to EV-based equity)', 13, NF.n1]];
  for (const [addr, label, mr, fmt] of ivRow) { w(iv, addr, label); w(iv, `B${addr.slice(1)}`, fx(cRef.mkt(mr)), { link: true, fmt }); }
  const S = STAT_SHORT;
  ['Method', 'Company Metric', `Deals ${S[sel.low]}`, `Deals ${S[sel.mid]}`, `Deals ${S[sel.high]}`,
    `Equity Value @${S[sel.low]}`, `Equity Value @${S[sel.mid]}`, `Equity Value @${S[sel.high]}`,
    `Price/Share @${S[sel.low]} (${sym})`, `Price/Share @${S[sel.mid]} (${sym})`, `Price/Share @${S[sel.high]} (${sym})`]
    .forEach((h, i) => hdr(iv, `${colL(i + 1)}12`, h));
  iv.getRow(12).height = 31.5;
  const colOf = Object.fromEntries(t1.filter((x) => x.key).map((x) => [x.key, x.col]));
  const statCell = (key, stat) => {
    const at = D1.statsAt[stat];
    if (at) return `'Transaction Summary'!$${colOf[key]}$${at}`;
    const i = D1.statCols.findIndex((x) => x.key === key);
    const hc = colL(D1.helperStart + i);
    return statFormula(stat, `'Transaction Summary'!$${hc}$${D1.d0}:$${hc}$${D1.d1}`, sel.method);
  };
  p.implied.forEach((m, i) => {
    const rr = 13 + i;
    w(iv, `A${rr}`, m.label);
    const metric = m.premium ? '$B$5' : m.metricKey === 'book' ? cRef.mkt(15) : cRef.ltm(metricRow[m.metricKey]);
    w(iv, `B${rr}`, fx(metric), { link: true, fmt: m.premium ? NF.n2 : NF.n1 });
    ['C', 'D', 'E'].forEach((col, j) => {
      const stat = [sel.low, sel.mid, sel.high][j];
      w(iv, `${col}${rr}`, fx(deals.length ? statCell(m.key, stat) : '"NM"'), { link: true, fmt: m.premium ? NF.pct : NF.x, align: 'right' });
    });
    ['F', 'G', 'H'].forEach((col, j) => {
      const mc = ['C', 'D', 'E'][j];
      const f = m.premium
        ? `IF(AND(ISNUMBER(${mc}${rr}),$B${rr}>0,$B$6>0),$B${rr}*(1+${mc}${rr})*$B$6,"NM")`
        : `IF(AND(ISNUMBER(${mc}${rr}),ISNUMBER($B${rr}),$B${rr}>0),${m.ev ? `${mc}${rr}*$B${rr}-$B$8-$B$9+$B$11` : `${mc}${rr}*$B${rr}`},"NM")`;
      w(iv, `${col}${rr}`, fx(f), { fmt: NF.n1, align: 'right' });
    });
    ['I', 'J', 'K'].forEach((col, j) => {
      const ec = ['F', 'G', 'H'][j];
      w(iv, `${col}${rr}`, fx(`IF(AND(ISNUMBER(${ec}${rr}),$B$6>0),IF(${ec}${rr}>0,${ec}${rr}/$B$6,"NM"),"NM")`), { fmt: NF.n2, align: 'right' });
    });
  });
  const lastM = 12 + Math.max(1, p.implied.length);
  const sm = writeImpliedSummary(iv, lastM + 2, lastM, sym, 'Premium / (Discount) to current price', S[sel.mid]);
  note(iv, `A${sm.end + 2}`, 'EV methods: Equity = Multiple × Metric − Net Debt − NCI + Non-operating investments. P/E, P/B: Equity = Multiple × Metric. A negative implied equity value shows NM. Control premium method applies only if the company is listed; for an unlisted company leave the price blank – that row shows NM.');
  note(iv, `A${sm.end + 3}`, 'Precedent values are usually higher than trading comps because they include a control premium; older deals may reflect different market conditions.');

  arrange(wb, ['Instructions', 'Inputs', 'Transaction Summary', 'Implied Valuation', 'Company Being Valued', ...dRefs.map((x) => x.name)]);
  return wb;
}

export { pageCols };

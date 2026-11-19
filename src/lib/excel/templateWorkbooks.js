/**
 * The Comparable Company Analysis and Precedent Transactions workbooks, laid
 * out like the user's templates (Instructions · Inputs · Summary · Implied
 * Valuation · one sheet per company), for the chosen number of fiscal years,
 * YTD columns, peers / deals, statistics and multiples. Every derived cell is
 * a live formula; inputs are blue on cream.
 */
import ExcelJS from 'exceljs';
import { computeComps, COMPS_MULTIPLES, COMPS_BENCH, peerSlots } from '../engine/comps.js';
import { computePrecedent, DEAL_MULTIPLES, DEAL_BENCH, dealSlots } from '../engine/precedent.js';
import { STAT_SHORT } from '../engine/templateStats.js';
import { CURRENCIES, UNITS } from '../format.js';
import { colL } from './xlsxUtil.js';
import { writeRegressionSheet } from './regressionSheet.js';
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
  const wb = newBook();

  /* ---------------- Instructions ---------------- */
  writeInstructions(wb.addWorksheet('Instructions'), {
    heading: 'Comparable Company Analysis (Trading Comps)',
    units: `All amounts in ${unitLabel} unless stated (share price and EPS in ${sym}, share counts in ${unit}).`,
    steps: [
      ['1. Inputs sheet', `Price date, lease toggle, period labels and, for the target + ${slots.length} peer${slots.length === 1 ? '' : 's'}: name, ticker, sector, include flag, share price and diluted shares outstanding${tiersOn ? ', and tier' : ''}.`],
      ['2. Company sheets', `'Target' and 'Peer 1'…'Peer ${slots.length}' share the same layout. Fill the Income Statement, Balance Sheet and Cash Flow from annual reports / exchange filings (consolidated figures).`],
      ['3. Columns', `${n} historical fiscal year${n === 1 ? '' : 's'}${ytd ? ', then Prior-Year YTD and Current YTD' : ''}, then LTM.`],
      ['4. How LTM works', ytd ? 'P&L and cash flow: LTM = Latest FY + Current YTD − Prior YTD. If YTD columns are left blank, LTM equals the latest FY. Balance sheet: the LTM column uses the interim balance sheet if you enter one, otherwise the latest FY.' : 'No YTD columns: LTM equals the latest fiscal year, for the P&L, cash flow and balance sheet.'],
      ['5. Sign convention', 'Income statement: enter expenses as POSITIVE numbers. Exceptional items: gain +, loss −. Cash flow: enter outflows as NEGATIVE numbers, exactly as reported.'],
      ['6. Checks', 'Each company sheet has a balance sheet check row – it must show 0.0. Compare the computed PBT and PAT with the reported figures.'],
      ['7. Comps Summary', `Pulls multiples and operating metrics for all companies. Peer statistics (${sel.show.map((k) => STAT_SHORT[k]).join(', ') || 'none shown'}; ${sel.method === 'exc' ? 'exclusive' : 'inclusive'} percentiles) use only peers flagged 1 in 'Include in Stats'; the target is always excluded.${tiersOn ? ' Statistics are also shown per tier.' : ''}`],
      ['8. Implied Valuation', `Applies the peer ${STAT_SHORT[sel.low]} / ${STAT_SHORT[sel.mid]} / ${STAT_SHORT[sel.high]} multiples to the target to give implied equity value and share price.`],
      ['9. NM', "'NM' = not meaningful (negative or zero denominator, e.g. negative EBITDA or loss-making P/E). NM values are excluded from statistics."],
      ...(skipped.regression || !a.regression?.yVar ? [] : [['10. Regression', 'Explains a peer multiple with operating metrics, solved live, and predicts the target’s multiple.']]),
    ],
    definitions: [
      ['EBITDA', 'Revenue from Operations − Operating Expenses (excludes Other Income).'],
      ['EBIT', 'EBITDA − Depreciation & Amortisation.'],
      ['Net Debt', 'Total Borrowings + Lease Liabilities (if toggle = 1) − Cash, Other Bank Balances and Current Investments.'],
      ['Enterprise Value', 'Market Cap + Net Debt + Non-controlling Interest (latest balance sheet).'],
      ['ROE / ROCE', 'Based on closing balances. ROCE = EBIT / (Total Equity + Borrowings + Lease Liabilities).'],
      ['Working capital days', 'Inventory & payable days on Cost of Materials; receivable days on Revenue; 365-day year.'],
    ],
  });

  /* ---------------- Inputs ---------------- */
  const inp = wb.addWorksheet('Inputs');
  [26, 34, 16, 24, 14, 16, 22, 16, 18].forEach((wd, i) => { inp.getColumn(i + 1).width = wd; });
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
  w(inp, 'A9', 'Period Labels (edit to match your data)', { bold: true });
  let r = 10;
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
  r++;
  w(inp, `A${r}`, 'Company List', { bold: true }); r++;
  const listHead = r;
  ['Role', 'Company Name', 'NSE / BSE Ticker', 'Sector / Sub-sector', 'Include in Stats (1/0)', `Share Price (${sym})`, `Diluted Shares Outstanding (${unit})`, `Market Cap (${unitLabel})`, ...(tiersOn ? ['Tier'] : [])]
    .forEach((h, i) => hdr(inp, `${colL(i + 1)}${r}`, h));
  inp.getRow(r).height = 30;
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
    w(inp, `G${r}`, num(x.shares), { input: true, fmt: NF.n2 });
    w(inp, `H${r}`, fx(`F${r}*G${r}`), { fmt: NF.n1 });
    if (tiersOn) w(inp, `I${r}`, include === 'n.a.' ? '' : tier, { input: true });
    return r++;
  };
  listRow.target = listLine('Target', a.company?.name, a.comps?.target || {}, 'n.a.', '');
  listRow.peers = slots.map((p, k) => listLine(`Peer ${k + 1}`, p.name, p, p.include === 0 ? 0 : 1, c.peers[k].tier));
  inp.views = [{ state: 'frozen', xSplit: 0, ySplit: listHead, topLeftCell: `A${listHead + 1}` }];
  r++;
  note(inp, `A${r}`, 'Notes: Use consolidated financials for all companies. Diluted shares = latest basic shares + dilutive ESOPs/convertibles. Share price and shares are hardcoded inputs – record your source (e.g. NSE closing price on the price date).');

  /* ---------------- company sheets ---------------- */
  const pages = [];
  const addCo = (name, rowNo, x, placeholder) => {
    const ws = wb.addWorksheet(name);
    const ref = writeCompanySheet(ws, {
      page: x.page, n, ytd,
      title: fx(`IF(Inputs!$B$${rowNo}="","${placeholder}",Inputs!$B$${rowNo})`),
      subtitle: `Consolidated financials, ${unitLabel} unless stated. Expenses positive in P&L; outflows negative in cash flow.`,
      labels: { link: labelRef }, lease: 'Inputs!$B$7',
      market: { kind: 'listed', price: `Inputs!$F$${rowNo}`, shares: `Inputs!$G$${rowNo}` },
      unitLabel, sym, unitWord: unit,
    });
    pages.push(ref);
    return ref;
  };
  const tRef = addCo('Target', listRow.target, a.comps?.target || {}, '[Enter company name in Inputs]');
  const pRefs = slots.map((p, k) => addCo(`Peer ${k + 1}`, listRow.peers[k], p, `Peer ${k + 1}`));

  /* ---------------- Comps Summary ---------------- */
  const cs = wb.addWorksheet('Comps Summary');
  cs.getColumn(1).width = 30; cs.getColumn(2).width = 13; cs.getColumn(3).width = 9;
  for (let i = 4; i <= 19; i++) cs.getColumn(i).width = 12;
  title(cs, 'A1', 'Comparable Company Analysis – Summary');
  w(cs, 'A2', fx(`"${unitLabel} unless stated | Prices as of "&IF(Inputs!$B$5="","[enter date in Inputs]",TEXT(Inputs!$B$5,"dd-mmm-yyyy"))`), { italic: true, size: 9, color: T.grey });

  const latestFyLabel = labelRef.fy[n - 1], ltmLabel = labelRef.ltm;
  const multHdr = (m) => (m.period === 'book' ? `"${m.name}"` : `"${m.name} "&${m.period === 'fy' ? latestFyLabel : ltmLabel}`);
  const t1Cols = [
    { col: 'D', head: `"Share Price (${sym})"`, get: (ref) => ref.mkt(5), fmt: NF.n2 },
    { col: 'E', head: '"Market Cap"', get: (ref) => ref.mkt(7), fmt: NF.n1 },
    { col: 'F', head: '"Net Debt"', get: (ref) => ref.mkt(11), fmt: NF.n1 },
    { col: 'G', head: '"Enterprise Value"', get: (ref) => ref.mkt(13), fmt: NF.n1 },
    { col: 'H', head: `"Revenue "&${ltmLabel}`, get: (ref) => ref.ltm(7), fmt: NF.n1 },
    { col: 'I', head: `"EBITDA "&${ltmLabel}`, get: (ref) => ref.ltm(14), fmt: NF.n1 },
    { col: 'J', head: `"PAT "&${ltmLabel}`, get: (ref) => ref.ltm(24), fmt: NF.n1 },
    ...COMPS_MULTIPLES.map((m) => ({
      col: m.col, key: m.key, head: multHdr(m), fmt: NF.x, stat: true,
      get: (ref) => {
        const metricRow = { rev: 7, ebitda: 14, ebit: 16, patOwners: 24 }[m.metric];
        const metric = m.metric === 'book' ? ref.mkt(14) : m.period === 'fy' ? ref.fy(metricRow) : ref.ltm(metricRow);
        const base = m.ev ? ref.mkt(13) : ref.mkt(7);
        return `IF(${metric}<=0,"NM",${base}/${metric})`;
      },
    })),
  ];
  const tierCol1 = 'S', tierCol2 = 'Q';
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
        else w(cs, `${tierCol}${rr}`, fx(`IF(Inputs!$I$${listR}="","",Inputs!$I$${listR})`), { link: true });
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
  note(cs, `A${T2.end + 1}`, "Growth & cash-flow quality use the latest fiscal year (LTM growth needs prior-LTM data). 'NM' = not meaningful. Hidden columns from AN onward are helper cells for the statistics – do not delete.");
  cs.views = [{ state: 'frozen', xSplit: 1, ySplit: 5, topLeftCell: 'B6' }];

  /* ---------------- Implied Valuation ---------------- */
  const iv = wb.addWorksheet('Implied Valuation');
  iv.getColumn(1).width = 26;
  for (let i = 2; i <= 11; i++) iv.getColumn(i).width = 13;
  title(iv, 'A1', 'Implied Valuation of Target (from Peer Multiples)');
  note(iv, 'A2', `${unitLabel} unless stated. Multiples from Comps Summary peer statistics.`);
  w(iv, 'A4', 'Target Company'); w(iv, 'B4', fx(`IF(Inputs!$B$${listRow.target}="","[Target]",Inputs!$B$${listRow.target})`), { bold: true, link: true });
  const ivRow = [['A5', `Current Share Price (${sym})`, 5, NF.n2], ['A6', `Diluted Shares (${unit})`, 6, NF.n2], ['A7', 'Market Cap', 7, NF.n1], ['A8', 'Net Debt', 11, NF.n1], ['A9', 'Non-controlling Interest', 12, NF.n1], ['A10', 'Enterprise Value', 13, NF.n1]];
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
  used.forEach((m, i) => {
    const rr = 13 + i;
    const metricRow = { rev: 7, ebitda: 14, ebit: 16, patOwners: 24 }[m.metricKey];
    w(iv, `A${rr}`, fx(multHdr(m)));
    w(iv, `B${rr}`, fx(m.metricKey === 'book' ? tRef.mkt(14) : m.period === 'fy' ? tRef.fy(metricRow) : tRef.ltm(metricRow)), { link: true, fmt: NF.n1 });
    ['C', 'D', 'E'].forEach((col, j) => {
      const key = [sel.low, sel.mid, sel.high][j];
      w(iv, `${col}${rr}`, fx(slots.length ? statCell(m, key) : '"NM"'), { link: true, fmt: NF.x, align: 'right' });
    });
    ['F', 'G', 'H'].forEach((col, j) => {
      const mc = ['C', 'D', 'E'][j];
      const eq = m.ev ? `${mc}${rr}*$B${rr}-$B$8-$B$9` : `${mc}${rr}*$B${rr}`;
      w(iv, `${col}${rr}`, fx(`IF(AND(ISNUMBER(${mc}${rr}),$B${rr}>0),${eq},"NM")`), { fmt: NF.n1, align: 'right' });
    });
    ['I', 'J', 'K'].forEach((col, j) => {
      const ec = ['F', 'G', 'H'][j];
      w(iv, `${col}${rr}`, fx(`IF(AND(ISNUMBER(${ec}${rr}),$B$6>0),${ec}${rr}/$B$6,"NM")`), { fmt: NF.n2, align: 'right' });
    });
  });
  const lastM = 12 + Math.max(1, used.length);
  const sumRow = lastM + 2;
  const summary = writeImpliedSummary(iv, sumRow, lastM, sym, 'Upside / (Downside) to median-based price', S[sel.mid]);
  note(iv, `A${summary.end + 2}`, 'EV-based methods: Equity Value = Multiple × Metric − Net Debt − Non-controlling Interest. Equity-based methods (P/E, P/B): Equity Value = Multiple × Metric. Pick the methods that suit the sector – e.g. EV/EBITDA and P/E for most industrials, EV/Revenue only for early-stage or loss-making businesses.');

  /* ---------------- Regression ---------------- */
  const order = ['Instructions', 'Inputs', 'Comps Summary', 'Implied Valuation'];
  if (!skipped.regression && a.regression?.yVar) {
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
    const reg = wb.addWorksheet('Regression');
    writeRegressionSheet(reg, a, legacyFormats(sym), {
      peerName: (id) => `'Comps Summary'!$A$${T1.p0 + byId[id]}`,
      peerCell: (id, key) => cellFor(T1.p0 + byId[id], T2.p0 + byId[id], key),
      targetCell: (key) => cellFor(T1.targetRow, T2.targetRow, key),
      metric: (m) => (m.metric === 'book' ? tRef.mkt(14) : m.period === 'fy' ? tRef.fy({ rev: 7, ebitda: 14, ebit: 16, patOwners: 24 }[m.metric]) : tRef.ltm({ rev: 7, ebitda: 14, ebit: 16, patOwners: 24 }[m.metric])),
      netDebt: tRef.mkt(11), nci: tRef.mkt(12), shares: tRef.mkt(6),
    });
    order.push('Regression');
  }
  order.push('Target', ...pRefs.map((x) => x.name));
  arrange(wb, order);
  return wb;
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
      ['8. Transaction Summary', `Transaction multiples (LTM at announcement) and control premia, with statistics (${sel.show.map((k) => STAT_SHORT[k]).join(', ') || 'none shown'}; ${sel.method === 'exc' ? 'exclusive' : 'inclusive'} percentiles) across deals flagged 1 in 'Include'.`],
      ['9. Implied Valuation', `Applies the deal ${STAT_SHORT[sel.low]} / ${STAT_SHORT[sel.mid]} / ${STAT_SHORT[sel.high]} multiples and control premium to the company being valued.`],
      ['10. Cross-border deals', `Convert all foreign-currency figures to ${unitLabel} at the exchange rate on the announcement date, and note the rate in the Source column.`],
    ],
    definitions: [
      ['Implied Equity Value (100%)', 'Consideration Paid ÷ Stake Acquired.'],
      ['Net Debt', "Borrowings + Lease Liabilities (if toggle = 1) − Cash, Other Bank Balances and Current Investments, from the target's last balance sheet before announcement."],
      ['Implied Enterprise Value', 'Implied Equity Value (100%) + Net Debt + Non-controlling Interest.'],
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
  w(inp, 'A9', 'Company Being Valued', { bold: true });
  const cbv = [['A10', 'Company name', text(a.company?.name)], ['A11', 'NSE / BSE ticker (if listed)', text(co.ticker)], ['A12', `Current share price (${sym}, if listed)`, num(co.price), NF.n2], ['A13', `Diluted shares outstanding (${unit})`, num(co.shares), NF.n2]];
  for (const [addr, label, v, fmt] of cbv) {
    const rr = addr.slice(1);
    w(inp, addr, label);
    inp.mergeCells(`A${rr}:B${rr}`);
    w(inp, `C${rr}`, v, { input: true, fmt });
  }
  w(inp, 'A15', 'Deal List', { bold: true });
  ['Deal', 'Announcement Date', 'Target', 'Acquirer', 'Acquirer Type', 'Stake Acquired (%)', `Consideration Paid (${unitLabel})`, `Implied 100% Equity Value (${unitLabel})`, 'Consideration Form', 'Status', 'Listed Target?', `Offer Price (${sym})`, `Unaffected Price (${sym})`, 'Control Premium', 'Include (1/0)', 'Source / Notes']
    .forEach((h, i) => hdr(inp, `${colL(i + 1)}16`, h));
  inp.getRow(16).height = 42;
  const dealRow = [];
  deals.forEach((d, k) => {
    const rr = 17 + k;
    dealRow.push(rr);
    w(inp, `A${rr}`, `Deal ${k + 1}`, { bold: true });
    w(inp, `B${rr}`, date(d.date), { input: true, fmt: NF.date });
    w(inp, `C${rr}`, text(d.target), { input: true });
    w(inp, `D${rr}`, text(d.acquirer), { input: true });
    w(inp, `E${rr}`, text(d.acquirerType), { input: true });
    w(inp, `F${rr}`, isNum(d.stakePct) ? d.stakePct / 100 : null, { input: true, fmt: NF.pct });
    w(inp, `G${rr}`, num(d.consideration), { input: true, fmt: NF.n1 });
    w(inp, `H${rr}`, fx(`IFERROR(G${rr}/F${rr},0)`), { fmt: NF.n1 });
    w(inp, `I${rr}`, text(d.form), { input: true });
    w(inp, `J${rr}`, text(d.status), { input: true });
    w(inp, `K${rr}`, text(d.listed), { input: true, align: 'center' });
    w(inp, `L${rr}`, num(d.offerPrice), { input: true, fmt: NF.n2 });
    w(inp, `M${rr}`, num(d.unaffectedPrice), { input: true, fmt: NF.n2 });
    w(inp, `N${rr}`, fx(`IF(AND(K${rr}="Yes",M${rr}>0,L${rr}>0),L${rr}/M${rr}-1,"")`), { fmt: NF.pct });
    w(inp, `O${rr}`, d.include === 0 ? 0 : 1, { input: true, align: 'center' });
    w(inp, `P${rr}`, text(d.source), { input: true });
  });
  inp.views = [{ state: 'frozen', xSplit: 0, ySplit: 16, topLeftCell: 'A17' }];

  /* ---------------- company sheets ---------------- */
  // each page's own period labels, exactly as the app shows them (years added in front continue the numbering)
  const cbvWs = wb.addWorksheet('Company Being Valued');
  const cRef = writeCompanySheet(cbvWs, {
    page: co.page, n, ytd,
    title: fx('IF(Inputs!$C$10="","Company Being Valued: [enter name in Inputs]","Company Being Valued: "&Inputs!$C$10)'),
    subtitle: `Latest available financials. Consolidated, ${unitLabel}. Expenses positive in P&L; outflows negative in cash flow.`,
    labels: { input: p.company.labels }, lease: 'Inputs!$B$7',
    market: { kind: 'listed', price: 'Inputs!$C$12', shares: 'Inputs!$C$13', heading: 'Market Data & Net Debt (latest)', priceLabel: `Current Share Price (${sym})`, evLabel: 'Current Enterprise Value', bvps: false },
    unitLabel, sym, unitWord: unit,
  });
  const dRefs = deals.map((d, k) => {
    const rr = dealRow[k];
    const ws = wb.addWorksheet(`Deal ${k + 1}`);
    return writeCompanySheet(ws, {
      page: d.page, n, ytd,
      title: fx(`IF(Inputs!$C$${rr}="","Deal ${k + 1}: [enter target in Inputs]","Deal ${k + 1}: "&Inputs!$C$${rr}&IF(Inputs!$D$${rr}="",""," acquired by "&Inputs!$D$${rr})&IF(Inputs!$B$${rr}="",""," ("&TEXT(Inputs!$B$${rr},"dd-mmm-yyyy")&")"))`),
      subtitle: `Target financials AS OF ANNOUNCEMENT. Consolidated, ${unitLabel}. Expenses positive in P&L; outflows negative in cash flow.`,
      labels: { input: p.deals[k].labels }, lease: 'Inputs!$B$7',
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
    { col: 'H', key: 'equity', head: 'Implied Equity Value (100%)', fmt: NF.n1, stat: true, get: (ref) => ref.mkt(5) },
    { col: 'I', head: 'Net Debt', fmt: NF.n1, get: (ref) => ref.mkt(11) },
    { col: 'J', key: 'ev', head: 'Implied Enterprise Value', fmt: NF.n1, stat: true, get: (ref) => ref.mkt(13) },
    { col: 'K', head: 'LTM Revenue', fmt: NF.n1, get: (ref) => ref.ltm(7) },
    { col: 'L', head: 'LTM EBITDA', fmt: NF.n1, get: (ref) => ref.ltm(14) },
    { col: 'M', head: 'LTM PAT', fmt: NF.n1, get: (ref) => ref.ltm(24) },
    ...DEAL_MULTIPLES.map((m) => ({
      col: m.col, key: m.key, head: m.label, fmt: NF.x, stat: true,
      get: (ref) => {
        const metric = m.metric === 'book' ? ref.mkt(14) : ref.ltm(metricRow[m.metric]);
        return `IF(${metric}<=0,"NM",${m.ev ? ref.mkt(13) : ref.mkt(5)}/${metric})`;
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
  w(iv, 'A4', 'Company Being Valued'); w(iv, 'B4', fx('IF(Inputs!$C$10="","[enter in Inputs]",Inputs!$C$10)'), { bold: true, link: true });
  const ivRow = [['A5', `Current Share Price (${sym})`, 5, NF.n2], ['A6', `Diluted Shares (${unit})`, 6, NF.n2], ['A7', 'Market Cap', 7, NF.n1], ['A8', 'Net Debt', 11, NF.n1], ['A9', 'Non-controlling Interest', 12, NF.n1], ['A10', 'Current Enterprise Value', 13, NF.n1]];
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
    const metric = m.premium ? '$B$5' : m.metricKey === 'book' ? cRef.mkt(14) : cRef.ltm(metricRow[m.metricKey]);
    w(iv, `B${rr}`, fx(metric), { link: true, fmt: m.premium ? NF.n2 : NF.n1 });
    ['C', 'D', 'E'].forEach((col, j) => {
      const stat = [sel.low, sel.mid, sel.high][j];
      w(iv, `${col}${rr}`, fx(deals.length ? statCell(m.key, stat) : '"NM"'), { link: true, fmt: m.premium ? NF.pct : NF.x, align: 'right' });
    });
    ['F', 'G', 'H'].forEach((col, j) => {
      const mc = ['C', 'D', 'E'][j];
      const f = m.premium
        ? `IF(AND(ISNUMBER(${mc}${rr}),$B${rr}>0,$B$6>0),$B${rr}*(1+${mc}${rr})*$B$6,"NM")`
        : `IF(AND(ISNUMBER(${mc}${rr}),$B${rr}>0),${m.ev ? `${mc}${rr}*$B${rr}-$B$8-$B$9` : `${mc}${rr}*$B${rr}`},"NM")`;
      w(iv, `${col}${rr}`, fx(f), { fmt: NF.n1, align: 'right' });
    });
    ['I', 'J', 'K'].forEach((col, j) => {
      const ec = ['F', 'G', 'H'][j];
      w(iv, `${col}${rr}`, fx(`IF(AND(ISNUMBER(${ec}${rr}),$B$6>0),${ec}${rr}/$B$6,"NM")`), { fmt: NF.n2, align: 'right' });
    });
  });
  const lastM = 12 + Math.max(1, p.implied.length);
  const sm = writeImpliedSummary(iv, lastM + 2, lastM, sym, 'Premium / (Discount) to current price', S[sel.mid]);
  note(iv, `A${sm.end + 2}`, 'EV methods: Equity = Multiple × Metric − Net Debt − NCI. P/E, P/B: Equity = Multiple × Metric. Control premium method applies only if the company is listed. For an unlisted company, leave price blank – that row shows NM.');
  note(iv, `A${sm.end + 3}`, 'Precedent values are usually higher than trading comps because they include a control premium; older deals may reflect different market conditions.');

  arrange(wb, ['Instructions', 'Inputs', 'Transaction Summary', 'Implied Valuation', 'Company Being Valued', ...dRefs.map((x) => x.name)]);
  return wb;
}

export { pageCols };

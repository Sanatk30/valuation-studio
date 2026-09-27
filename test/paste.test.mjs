/**
 * Clipboard import for the template company pages (comps target / peers,
 * precedent company / deals) and the company list: number parsing, the
 * line-items-down page grid (labels, synonyms, sections, repeated lines,
 * calculated rows skipped) and applying it to a page.
 */
import { parseNum, splitBlock, parsePageGrid, applyPageGrid, parseCompanyList, LIST_HEADER } from '../src/lib/templatePaste.js';
import { blankPage, computePage } from '../src/lib/engine/companyPage.js';

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };
const near = (x, y, tol = 1e-9) => Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));

/* ------------------------------------------------------------- numbers */
console.log('=== number parsing ===');
const N = (s) => parseNum(s);
ok(N('1234').value === 1234 && N('1234').ok, 'plain integer');
ok(N('1,234.56').value === 1234.56, 'thousands separator');
ok(N('(1,234)').value === -1234, 'accounting negative in parentheses');
ok(N('-42.5').value === -42.5, 'leading minus');
ok(N('(-42.5)').value === 42.5, 'parentheses around a negative cancel');
ok(N('₹ 1,284.50').value === 1284.5, 'rupee symbol and spaces stripped');
ok(N('$1,284.50').value === 1284.5, 'dollar symbol stripped');
ok(near(N('25.2%').value, 0.252), 'percent converts to a fraction');
ok(!N('').ok && !N('  ').ok, 'blank is not a value');
for (const s of ['NA', 'n/a', 'NM', '—', '-', '...']) ok(!N(s).ok, `"${s}" is not a value`);
ok(!N('abc').ok, 'text is not a value');
ok(!N('12abc').ok, 'partial text is rejected, not silently truncated');
ok(N('1.5e3').value === 1500, 'scientific notation');
ok(N(0).ok && N(0).value === 0, 'a real zero is a value');

console.log('\n=== block splitting ===');
ok(splitBlock('a\tb\nc\td').length === 2, 'tab-separated rows');
ok(splitBlock('a,b\nc,d')[0][1] === 'b', 'comma fallback');
ok(splitBlock('a\tb\r\nc\td').length === 2, 'CRLF line endings');
ok(splitBlock('"a,x"\t"b"')[0][0] === 'a,x', 'quoted cell keeps its comma');
ok(splitBlock('\n\na\tb\n\n').length === 1, 'blank lines dropped');

/* ------------------------------------------------------------ page grid */
const n = 3;
const columns = [{ id: 0, label: 'FY24' }, { id: 1, label: 'FY25' }, { id: 2, label: 'FY26' }, { id: 'p', label: 'Q1 FY26' }, { id: 'c', label: 'Q1 FY27' }];

console.log('\n=== page grid: a block copied out of the template ===');
{
  const block = [
    'Line Item\tFY24\tFY25\tFY26\tQ1 FY26\tQ1 FY27',
    'INCOME STATEMENT',
    'Revenue from Operations\t4,200\t4,750\t5,300\t1,250\t1,420',
    'Other Income\t45\t52\t60\t13\t16',
    'Total Income\t4,245\t4,802\t5,360\t1,263\t1,436',
    'Cost of Materials Consumed\t2,520\t2,800\t3,100\t740\t830',
    'Employee Benefits Expense\t420\t470\t520\t125\t140',
    'Profit Before Tax\t465\t607\t707\t154\t199',
    'BALANCE SHEET',
    'Trade Receivables\t580\t650\t720\t\t760',
    'Cash & Cash Equivalents\t180\t240\t310\t999\t330',
    'CASH FLOW STATEMENT',
    'Profit Before Tax\t465\t607\t707',
    'Dividends Paid\t(40)\t(50)\t(60)',
    'Widgets shipped\t1\t2\t3',
  ].join('\n');
  const g = parsePageGrid(block, { columns });
  ok(g.ok && g.header !== null, 'parses; header row detected');
  const byKey = Object.fromEntries(g.matched.map((m) => [m.key, m]));
  ok(byKey.rev && byKey.otherInc && byKey.materials && byKey.employee, 'income-statement inputs matched by the template labels');
  ok(g.skipped.some((s) => s.line === 'Total Income'), 'a calculated row (Total Income) is skipped — the page recomputes it');
  ok(!byKey.pbt && byKey.cfPbt && byKey.cfPbt.values[2] === 707, 'Profit Before Tax: calculated on the IS, an input under the cash-flow heading');
  ok(byKey.receivables && byKey.cash && byKey.divPaid?.values[0] === -40, 'balance-sheet and cash-flow lines by section; (40) is negative');
  ok(g.unmatched.length === 1 && g.unmatched[0].label === 'Widgets shipped', 'an unknown row is reported, not silently dropped');
  ok(g.slots.map((s) => s?.id).join(',') === '0,1,2,p,c', 'five value columns land on FY24 … current YTD');

  const pg = applyPageGrid(blankPage(), g, n);
  ok(pg.lines.rev.fy.join(',') === '4200,4750,5300' && pg.lines.rev.p === 1250 && pg.lines.rev.c === 1420, 'revenue landed in every column');
  ok(pg.lines.cash.p === null && pg.lines.cash.c === 330, 'no balance sheet in the prior-YTD column (999 ignored); interim in current YTD');
  ok(pg.lines.receivables.p === null && pg.lines.receivables.c === 760, 'a blank cell stays blank');
  const v = computePage(pg, { n, ytd: true }).v;
  ok(v.totalIncome[2] === 5360, 'the page recomputes Total Income from the pasted inputs');
}

console.log('\n=== page grid: annual-report wording, lines added together ===');
{
  const block = [
    'Particulars\tFY25\tFY26',
    'Revenue from operations\t1,000\t1,100',
    'Cost of materials consumed\t400\t420',
    'Purchases of stock-in-trade\t100\t110',
    'Changes in inventories of finished goods, work-in-progress and stock-in-trade\t(10)\t5',
    'Staff costs\t90\t95',
    'Finance costs\t20\t18',
    'Diluted weighted average shares\t10\t10',
  ].join('\n');
  const g = parsePageGrid(block, { columns });
  const m = Object.fromEntries(g.matched.map((x) => [x.key, x]));
  ok(m.materials.sources.length === 3 && m.materials.values[0] === 490 && m.materials.values[1] === 535, 'materials + purchases + inventory change add into Cost of Materials');
  ok(m.employee && m.finance && m.shares, 'synonyms: staff costs, finance costs, diluted weighted average shares');
  ok(g.slots.map((s) => s?.id).join(',') === '1,2', 'header FY25, FY26: two columns land on FY25, FY26');
  const pg = applyPageGrid(blankPage(), g, n);
  ok(pg.lines.rev.fy.length === 3 && pg.lines.rev.fy[0] == null && pg.lines.rev.fy[2] === 1100, 'the oldest year stays blank');
}

console.log('\n=== page grid: lined up by the header row ===');
{
  const g = parsePageGrid('Particulars\tFY26\tQ1 FY26\nRevenue from Operations\t9,999\t2,000', { columns });
  ok(g.offset === 2 && g.slots.map((s) => s?.id).join(',') === '2,p', 'a block headed FY26, Q1 FY26 lands on FY26 and the prior YTD');
  ok(parsePageGrid('Particulars\tFY99\nRevenue\t1', { columns }).offset === 0, 'an unknown header → the first column');
  ok(parsePageGrid('Particulars\tFY26\nRevenue\t1', { columns, offset: 0 }).offset === 0, 'a chosen offset wins over the header');
}

console.log('\n=== page grid: too many columns / nothing recognised ===');
{
  const g = parsePageGrid('Revenue\t1\t2\t3\t4\t5\t6\t7', { columns });
  ok(g.ok && g.dropped === 2, 'columns beyond the page are reported as dropped');
  const pg = applyPageGrid(blankPage(), g, n);
  ok(pg.lines.rev.c === 5, 'the columns that fit are applied');
  ok(!parsePageGrid('Foo\t1\nBar\t2', { columns }).ok, 'no known labels → not ok, with a reason');
  ok(!parsePageGrid('', { columns }).ok, 'empty paste → not ok');
  ok(applyPageGrid(blankPage(), { ok: false }, n).lines.rev.fy.length === 0, 'a failed parse changes nothing');
}

/* ------------------------------------------------------------ company list */
console.log('\n=== company list ===');
{
  const text = [LIST_HEADER, 'Alpha Chem\tALPHA\tChemicals\t1\t1,350\t36\tLarge caps', 'Beta Ltd\tBETA\t\t0\t(12)\t\t', '\tNONAME\t\t1\t10\t1\t'].join('\n');
  const r = parseCompanyList(text);
  ok(r.ok && r.companies.length === 2, 'two named rows (a row without a name is dropped)');
  ok(r.companies[0].price === 1350 && r.companies[0].shares === 36 && r.companies[0].tier === 'Large caps', 'price, shares and tier read');
  ok(r.companies[1].include === 0 && r.companies[1].sector === undefined, 'include 0 kept; blank sector left out');
  ok(!parseCompanyList('Ticker\tPrice\nA\t1').ok, 'no Company Name column → not ok');
  ok(!parseCompanyList(LIST_HEADER).ok, 'header alone → not ok');
}

console.log(`\npaste: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

/**
 * Clipboard import for comparable companies: number parsing, the
 * line-items-down grid, the one-row-per-company wide table, and the JSON
 * round-trip that private companies are entered and shared through.
 */
import { parseNum, splitBlock, parseGrid, applyGrid, parseWide, matchField, matchScalar } from '../src/lib/compsPaste.js';
import { computeCompany, blankCompany, P } from '../src/lib/engine/compsCo.js';
import { SAMPLE_MODEL as A } from './fixtures/model.mjs';
import { computeComps } from '../src/lib/engine/comps.js';

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

/* -------------------------------------------------------- label matching */
console.log('\n=== label matching ===');
ok(matchField('Revenue').key === 'sales', 'Revenue → sales');
ok(matchField('Net sales').key === 'sales', 'Net sales → sales');
ok(matchField('Cost of revenue').key === 'cogs', 'Cost of revenue → cogs');
ok(matchField('Less: COGS').key === 'cogs', 'a "Less:" prefix is ignored');
ok(matchField('Sales (₹ Cr)').key === 'sales', 'a parenthetical unit note is ignored');
ok(matchField("Shareholders' Equity").key === 'bsEquity', 'punctuation and case are ignored');
ok(matchField('SG&A').group === 'is' && matchField('Total debt').group === 'bs', 'rows route to the right block');
ok(matchField('Estimated EBITDA') === null, 'comps is LTM only — estimate rows are not recognised');
ok(matchField('Something else') === null, 'an unknown label does not match');
ok(matchScalar('Ticker').key === 'ticker' && matchScalar('Share price').key === 'price', 'scalar labels match');

/* ------------------------------------------------------------ grid paste */
console.log('\n=== grid paste (line items down, periods across) ===');
{
  const block = [
    '\tFY23\tFY24\tFY25\tH1 FY25\tH1 FY26',
    'Sales\t4,200.5\t4,704.6\t5,269.1\t2,634.6\t2,845.4',
    'Less: COGS\t(2,730.3)\t(3,057.0)\t(3,424.9)\t(1,712.5)\t(1,849.5)',
    'SG&A\t420.1\t470.5\t526.9\t263.5\t284.5',
    'Interest expense\t85.0\t88.0\t92.0\t46.0\t48.0',
    'Income taxes\t180.4\t210.9\t240.1\t120.0\t131.0',
    'Weighted avg. diluted shares\t9.42\t9.42\t9.42\t9.42\t9.42',
    'Cash from operations\t610.2\t690.4\t770.8\t385.4\t420.1',
    'Capital expenditures\t260.0\t290.0\t320.0\t160.0\t175.0',
    'Depreciation & amortization\t210.0\t235.0\t262.0\t131.0\t142.0',
    'Widgets shipped\t1,000\t1,100\t1,200\t600\t650',
  ].join('\n');

  const g = parseGrid(block);
  ok(g.ok, 'grid parses');
  ok(g.target === 'is', 'auto-detects the income-statement block');
  ok(g.header !== null, 'the header row is detected and not treated as data');
  ok(g.matched.length === 9, `9 line items matched (got ${g.matched.length})`);
  ok(g.unmatched.length === 1 && g.unmatched[0].label === 'Widgets shipped', 'the unknown row is reported, not silently dropped');
  ok(g.slots.join(',') === '0,1,2,3,4', 'five columns fill FY-2 … current stub');

  const co = applyGrid(blankCompany({ name: 'Pasted Co', price: 100, basicShares: 9.42 }), g);
  ok(co.is.sales[2] === 5269.1, 'FY0 sales landed');
  ok(co.is.cogs[0] === -2730.3, 'the parenthesised COGS came through negative, as pasted');
  ok(co.is.sales[4] === 2845.4, 'current stub landed');
  ok(co.cf.da[2] === 262.0, 'cash-flow rows route into the cash-flow block');

  const pg = computeCompany(co);
  ok(near(pg.is.sales[P.LTM], 5269.1 + 2845.4 - 2634.6), 'the LTM bridge runs off the pasted numbers');

  // a three-column paste, offset so it lands on the fiscal years
  const short = ['Sales\t100\t110\t121', 'Total debt\t50\t55\t60'].join('\n');
  const g3 = parseGrid(short, { block: 'is', offset: 0 });
  ok(g3.slots.join(',') === '0,1,2', 'a 3-column paste fills FY-2 … FY0');
  ok(g3.otherBlocks.length === 1, 'a balance-sheet row in an IS paste is held back, not forced in');
  const g3b = parseGrid(short, { block: 'is', offset: 2 });
  ok(g3b.slots.join(',') === '2,3,4', 'offset 2 shifts the same paste onto FY0 … current stub');
  ok(g3b.dropped === 0, 'nothing is dropped when it fits');
  const gOver = parseGrid(short, { block: 'is', offset: 4 });
  ok(gOver.dropped === 2, 'columns past the last period are reported as dropped');

  // balance sheet
  const bs = ['Cash\t120\t150', 'Total debt\t900\t880', "Shareholders' equity\t1,500\t1,650", 'Inventories\t300\t320'].join('\n');
  const gb = parseGrid(bs);
  ok(gb.ok && gb.target === 'bs', 'a balance-sheet paste auto-detects the balance-sheet block');
  ok(gb.periods.join('/') === 'Prior/Current', 'the balance sheet has two columns');
  const cob = applyGrid(blankCompany({}), gb);
  ok(cob.bs.cash[1] === 150 && cob.bs.equity[0] === 1500, 'balance-sheet values land in the right column');

  // blank cells on a fresh page stay blank (NA / none), never 0
  const coBlank = applyGrid(blankCompany(), parseGrid('Sales\t\t\t500\t\t'));
  ok(coBlank.is.sales[2] === 500 && coBlank.is.sales[0] === null && coBlank.is.sales[3] === null, 'unpasted cells stay blank');

  // nothing recognisable
  const junk = parseGrid('Foo\t1\t2\nBar\t3\t4');
  ok(!junk.ok && junk.unmatched.length === 2, 'an unrecognisable block fails with both rows reported');
  ok(!parseGrid('').ok, 'an empty paste fails cleanly');

  // a blank cell must not overwrite an existing value
  const seeded = blankCompany({});
  seeded.is.sales = [1, 2, 3, 4, 5];
  const gBlank = parseGrid('Sales\t\t\t99\t\t');
  const after = applyGrid(seeded, gBlank);
  ok(after.is.sales[2] === 99 && after.is.sales[0] === 1 && after.is.sales[4] === 5, 'blank cells leave existing values alone');
}

/* ------------------------------------------------------------ wide paste */
console.log('\n=== wide paste (one row per company) ===');
{
  const tiers = [{ id: 't1', name: 'Tier I: Specialty Chemicals' }, { id: 't2', name: 'Tier II: Commodity' }];
  const wide = [
    ['Company', 'Ticker', 'Exchange', 'Tier', 'Price', '52-week high', 'Basic shares outstanding', 'Marginal tax rate (%)',
      'Sales FY-1', 'Sales FY0', 'COGS FY0', 'SG&A FY0', 'Interest expense FY0', 'Income taxes FY0',
      'Weighted avg. diluted shares FY0', 'Cash from operations FY0', 'Capital expenditures FY0', 'Depreciation & amortization FY0',
      'Cash Current', 'Total debt Current', "Shareholders' equity Current"].join('\t'),
    ['Northgate Materials', 'NGM', 'NSE', 'Tier I: Specialty Chemicals', '842.50', '1,040.00', '6.20', '25.2',
      '3,100.0', '3,472.0', '2,290.0', '347.2', '62.0', '190.0', '6.20', '520.0', '215.0', '175.0',
      '280.0', '760.0', '2,150.0'].join('\t'),
    ['Ravensworth Chem', 'RVC', 'BSE', 'Tier II: Commodity', '318.20', '402.00', '14.80', '25.2',
      '6,900.0', '7,245.0', '5,510.0', '724.5', '158.0', '260.0', '14.80', '880.0', '470.0', '395.0',
      '410.0', '2,240.0', '3,100.0'].join('\t'),
  ].join('\n');

  const w = parseWide(wide, { tiers });
  ok(w.ok, 'wide table parses');
  ok(w.companies.length === 2, 'two companies parsed');
  ok(w.unmatched.length === 0, 'every header column was recognised');

  const [c1] = w.companies;
  ok(c1.co.name === 'Northgate Materials' && c1.co.ticker === 'NGM', 'identity columns landed');
  ok(c1.co.tierId === 't1', 'the tier name resolved to a tier id');
  ok(c1.co.price === 842.5 && c1.co.basicShares === 6.2, 'scalars landed');
  ok(c1.co.is.sales[1] === 3100 && c1.co.is.sales[2] === 3472, 'an explicit period suffix targets the right column');
  ok(c1.co.bs.debt[1] === 760 && c1.co.bs.cash[1] === 280, '"Current" targets the current balance-sheet column');
  ok(c1.co.is.sales[0] === null && c1.co.bs.debt[0] === null, 'columns not pasted stay blank');

  const pg = computeCompany(c1.co);
  ok(near(pg.is.sales[P.LTM], 3472), 'with no stub data, LTM equals FY0');
  ok(near(pg.equityValue, 6.2 * 842.5), 'equity value computes from the pasted shares and price');
  ok(near(pg.enterpriseValue, 6.2 * 842.5 + 760 - 280), 'EV bridges off the pasted balance sheet');
  ok(!Number.isFinite(pg.adjEbitda[P.LTM]), 'Other expense not pasted → EBITDA is NA (a blank core line is never 0)');
  const pg2 = computeCompany({ ...c1.co, is: { ...c1.co.is, otherExp: [null, null, 0, null, null] } });
  ok(near(pg2.adjEbitda[P.LTM], 3472 - 2290 - 347.2 + 175), 'EBITDA builds from the pasted lines once every cost line is given');

  // bare (unsuffixed) field columns fall back to the block default
  const bare = ['Company\tPrice\tSales\tTotal debt', 'Bare Co\t50\t1000\t400'].join('\n');
  const wb = parseWide(bare, { tiers });
  ok(wb.companies[0].co.is.sales[2] === 1000, 'a bare income-statement column defaults to FY0');
  ok(wb.companies[0].co.bs.debt[1] === 400, 'a bare balance-sheet column defaults to Current');

  // basic shares are never filled from the diluted series — blank stays NA
  const noShares = ['Company\tPrice\tWeighted avg. diluted shares FY0', 'No Basic Co\t10\t7.5'].join('\n');
  ok(parseWide(noShares).companies[0].co.basicShares === null, 'basic shares not pasted stay blank (no fallback)');

  // gross profit is NA when no COGS was pasted, rather than a wrong number
  const noCogs = ['Company\tPrice\tSales FY0\tBasic shares outstanding', 'No COGS Co\t10\t500\t5'].join('\n');
  const pgNoCogs = computeCompany(parseWide(noCogs).companies[0].co);
  ok(!Number.isFinite(pgNoCogs.grossMargin[P.LTM]), 'no COGS pasted → gross margin reports NA');

  // failures are explained
  ok(!parseWide('Company\tPrice').ok, 'a header with no data rows fails');
  ok(!parseWide('Foo\tBar\n1\t2').ok, 'a table with no Company column fails');
  const unknown = parseWide(['Company\tPrice\tWidgets', 'X\t5\t9'].join('\n'));
  ok(unknown.unmatched.includes('Widgets'), 'unrecognised headers are reported back');
  ok(parseWide(['Company\tPrice', 'A\t1', '\t2'].join('\n')).companies.length === 1, 'rows without a name are skipped');
}

/* ------------------------------------------------- JSON round-trip (private) */
console.log('\n=== JSON round-trip ===');
{
  const before = computeComps(A);
  const json = JSON.stringify(A);
  const back = JSON.parse(json);
  ok(back.comps.peers.length === A.comps.peers.length, 'every peer survives a JSON round-trip');
  ok(back.comps.tiers.length === A.comps.tiers.length, 'tiers survive');

  const after = computeComps(back);
  let worst = 0;
  for (let i = 0; i < before.pages.length; i++) {
    const b = before.pages[i], a2 = after.pages[i];
    ok(b.co.name === a2.co.name, `peer ${i + 1} keeps its identity`);
    for (const k of ['equityValue', 'enterpriseValue', 'roe', 'roic']) worst = Math.max(worst, Math.abs(b[k] - a2[k]));
    worst = Math.max(worst, Math.abs(b.multiples.evEbitda.values[0] - a2.multiples.evEbitda.values[0]));
  }
  ok(worst === 0, `every computed figure is bit-identical after the round-trip (max delta ${worst})`);

  // a hand-built private company survives too
  const priv = blankCompany({
    name: 'Kestrel Private Ltd', ticker: '', exchange: 'Private', price: null, basicShares: 4.5,
    is: { ...blankCompany().is, sales: [900, 1010, 1140, 570, 630], cogs: [600, 670, 750, 375, 410] },
  });
  const privBack = JSON.parse(JSON.stringify(priv));
  ok(JSON.stringify(computeCompany(priv).is.sales) === JSON.stringify(computeCompany(privBack).is.sales),
    'a private company with no ticker round-trips unchanged');

}

console.log(`\n${checks} checks`);
if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('PASTE & ROUND-TRIP OK');

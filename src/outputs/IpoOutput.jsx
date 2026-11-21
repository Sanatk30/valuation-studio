import React, { useMemo } from 'react';
import Waterfall from '../components/Waterfall.jsx';
import StatementTable from '../components/StatementTable.jsx';
import { computeIpo } from '../lib/engine/ipo.js';
import { periodLabels } from '../lib/period.js';
import Headline from './parts/Headline.jsx';
import CalcMap from '../components/CalcMap.jsx';
import Collapsible, { Sections } from './parts/Collapsible.jsx';
import ChartBox, { EngineError } from './parts/ChartBox.jsx';
import { makeFmt, fin, allFinite, attempt, tone } from './parts/format.js';
import { ownershipOption } from './parts/charts.js';
import { useThemeMode } from '../lib/theme.js';


const DASH = '—';

/**
 * IPO output.
 * Props: { a, set, company, skipped } — nothing on this page is editable.
 * Headline = the offer price; key charts = the primary-proceeds waterfall and
 * pre / post ownership. Detail: offer-price build, deal structure (with the
 * greenshoe's exercised share and whether it is primary or secondary),
 * proceeds, post-IPO balance sheet and Year-1 P&L, and the Year-1 income
 * statement the P/E basis reads.
 */
export default function IpoOutput({ a, onEdit }) {
  const f = useMemo(() => makeFmt(a.settings), [a.settings]);
  const model = useMemo(() => attempt(() => computeIpo(a)), [a]);
  if (model.error) return <div className="qo"><EngineError what="The IPO valuation" error={model.error} /></div>;
  return <IpoPage a={a} f={f} ipo={model.value} onEdit={onEdit} />;
}

function IpoPage({ a, f, ipo, onEdit }) {
  const p = a.ipo;
  const peBasis = p.basis === 'pe';
  const y1 = useMemo(() => periodLabels(a.settings, 'Y', 1)[0], [a.settings]);
  const gsPrimary = ipo.greenshoeType === 'primary';
  const gsWho = ipo.greenshoeShares === 0 ? DASH : ipo.greenshoeType === 'primary' ? 'Company' : ipo.greenshoeType === 'secondary' ? 'Selling holders' : DASH;

  const proceedsItems = [
    { label: 'Gross primary', value: ipo.grossPrimary, total: true },
    { label: 'Fees', value: -ipo.fees },
    { label: 'Net proceeds', value: ipo.netPrimary, total: true },
    { label: 'Debt repaid', value: -ipo.debtRepaid },
    { label: 'Cash to B/S', value: ipo.cashAdded, total: true },
  ];
  const proceedsOk = allFinite(proceedsItems.map((it) => it.value));
  const theme = useThemeMode();
  const ownOpt = useMemo(() => (fin(ipo.existingPost) && fin(ipo.freeFloat)
    ? ownershipOption(ipo.existingPost * 100, ipo.freeFloat * 100) : null), [ipo, theme]);

  const ts = ipo.ts;
  const ops = ts.ops;

  return (
    <div className="qo">
      {[fin(ipo.offerPrice) && ipo.offerPrice <= 0 && `The offer price is not positive — check the pricing basis and the ${y1} figures.`,
        !fin(ipo.postShares) && ipo.greenshoeShares > 0 && 'Choose whether the greenshoe shares are new (primary) or existing holders’ (secondary) in the Offer structure step.'].filter(Boolean).map((x) => <div key={x} className="warn2" style={{ marginBottom: 10 }}>{x}</div>)}
      <CalcMap
        cols={[
          { title: 'Earnings', groups: [{ nodes: [
            peBasis ? { id: 'n1', label: `${y1} net income`, value: f.money(ipo.ntm.netIncome), onClick: onEdit ? () => onEdit(1) : undefined }
              : { id: 'n1', label: `${y1} EBITDA`, value: f.money(ipo.ntm.ebitda), sub: `less net debt ${f.money(ipo.netDebt)}`, onClick: onEdit ? () => onEdit(1) : undefined },
            { id: 'n2', label: peBasis ? '× Fair-value P / E' : '× Fair-value EV / EBITDA', value: f.x1(peBasis ? p.offerPE : p.offerEvEbitda), input: true, onClick: onEdit ? () => onEdit(3) : undefined },
          ] }] },
          { title: 'Value', groups: [{ nodes: [
            { id: 'v1', label: 'Fair equity value', value: f.money(ipo.fairEquityPre), sub: `${f.price(ipo.fairPricePre)} a share` },
            { id: 'v2', label: `− IPO discount ${f.pct0(p.ipoDiscount)}`, value: f.price(ipo.fairPricePre - ipo.offerPrice), sub: 'a share', input: true, onClick: onEdit ? () => onEdit(3) : undefined },
          ] }] },
          { title: 'The deal', groups: [{ nodes: [
            { id: 'd1', label: 'Issue size', value: f.money(ipo.grossPrimary + ipo.grossSecondary), sub: `primary ${f.money(ipo.grossPrimary)} · secondary ${f.money(ipo.grossSecondary)}`, onClick: onEdit ? () => onEdit(4) : undefined },
            { id: 'd2', label: 'Shares after the IPO', value: `${f.shares(ipo.postShares)} ${f.unit}`, sub: `existing ${f.pct(ipo.existingPost * 100)} · public ${f.pct(ipo.freeFloat * 100)}` },
          ] }] },
        ]}
        edges={[['n1', 'v1', 1], ['n2', 'v1', 1], ['v1', 'res', 1], ['v2', 'res', 1], ['v1', 'd1'], ['d1', 'res'], ['d2', 'res']]}
        result={{ id: 'res', label: 'Offer price', value: f.price(ipo.offerPrice), sub: `band ${f.price(ipo.rangeLow)} – ${f.price(ipo.offerPrice)}`, tone: 'up',
          rows: [['Market cap at offer', f.money(ipo.mktCapAtOffer)], ['Net primary proceeds', f.money(ipo.netPrimary)], ['Fair value after listing', f.price(ipo.fairPricePost)]] }}
      />
      <div className="grid2" style={{ marginBottom: 18 }}>
        <div className="chartbox">
          <div className="ct">Primary proceeds waterfall ({f.unitLabel})</div>
          {proceedsOk ? <Waterfall items={proceedsItems} fmt={f.num} height={250} /> : <div className="sec-note">A proceeds line is NA, so the waterfall can't be drawn.</div>}
        </div>
        <ChartBox title="Ownership — pre vs post (% of shares)" option={ownOpt} height={250}
          note={`Existing holders keep ${f.pct(ipo.existingPost * 100)} after selling ${f.pct0(p.secondaryPct)} secondary${ipo.gsSecondary > 0 ? ' and the greenshoe shares' : ''}.`} />
      </div>

      <Sections>
        <Collapsible title={`Offer price build (${f.unitLabel})`} tag="PRICE">
          <div className="tablewrap">
            <table className="fin qo-kv">
              <tbody>
                {peBasis ? (
                  <>
                    <tr><td>{y1} net income</td><td>{f.num(ipo.ntm.netIncome)}</td></tr>
                    <tr className="sub"><td>× Fair-value P/E (before the IPO discount)</td><td>{f.x(p.offerPE)}</td></tr>
                  </>
                ) : (
                  <>
                    <tr><td>{y1} EBITDA</td><td>{f.num(ipo.ntm.ebitda)}</td></tr>
                    <tr className="sub"><td>× Fair-value EV/EBITDA (before the IPO discount)</td><td>{f.x(p.offerEvEbitda)}</td></tr>
                    <tr><td>Implied enterprise value</td><td>{f.num(p.offerEvEbitda * ipo.ntm.ebitda)}</td></tr>
                    <tr className="sub"><td>Less: net debt</td><td className="neg">{f.num(-ipo.netDebt)}</td></tr>
                  </>
                )}
                <tr className="bold"><td>Fair equity value (pre-money)</td><td>{f.num(ipo.fairEquityPre)}</td></tr>
                <tr className="sub"><td>÷ Existing shares</td><td>{f.shares(a.company.sharesOut)}</td></tr>
                <tr><td>Fair value per share</td><td>{f.price(ipo.fairPricePre)}</td></tr>
                <tr className="sub"><td>Less: IPO discount</td><td className="neg">{f.pct(-p.ipoDiscount)}</td></tr>
                <tr className="bold"><td>Offer price</td><td>{f.price(ipo.offerPrice)}</td></tr>
                <tr className="sub"><td>Bookbuild low (offer − {f.pct0(p.rangeBand)})</td><td>{f.price(ipo.rangeLow)}</td></tr>
                <tr className="sub"><td>Fair value post-listing (range high)</td><td>{f.price(ipo.fairPricePost)}</td></tr>
              </tbody>
            </table>
          </div>
        </Collapsible>

        <Collapsible title={`Deal structure (${f.unitLabel}, shares in ${f.unit})`} tag="DEAL">
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th>Shares</th><th>Count</th><th>@ offer</th><th>Proceeds to</th></tr></thead>
              <tbody>
                <tr><td>Existing shares</td><td>{f.shares(a.company.sharesOut)}</td><td>{f.num(a.company.sharesOut * ipo.offerPrice)}</td><td>{DASH}</td></tr>
                <tr><td>Primary (new shares)</td><td>{f.shares(ipo.primaryShares)}</td><td>{f.num(p.primaryRaise)}</td><td>Company</td></tr>
                <tr><td>Secondary ({f.pct0(p.secondaryPct)} of existing)</td><td>{f.shares(ipo.secondaryShares)}</td><td>{f.num(ipo.secondaryShares * ipo.offerPrice)}</td><td>Selling holders</td></tr>
                <tr className="sub"><td>Base deal</td><td>{f.shares(ipo.baseDealShares)}</td><td>{f.num(ipo.baseDealShares * ipo.offerPrice)}</td><td /></tr>
                <tr>
                  <td>Greenshoe ({f.pct0(p.greenshoePct)} of base, {f.pct0(p.greenshoeExercisedPct)} exercised · {ipo.greenshoeShares === 0 ? 'none sold' : gsPrimary ? 'new shares' : ipo.greenshoeType === 'secondary' ? 'existing holders’ shares' : 'type not chosen'})</td>
                  <td>{f.shares(ipo.greenshoeShares)}</td><td>{f.num(ipo.greenshoeProceeds)}</td><td>{gsWho}</td>
                </tr>
                <tr className="bold"><td>Post-IPO shares</td><td>{f.shares(ipo.postShares)}</td><td>{f.num(ipo.mktCapAtOffer)}</td><td /></tr>
              </tbody>
            </table>
          </div>
          <div className="tablewrap">
            <table className="fin qo-kv">
              <thead><tr><th>Proceeds</th><th /></tr></thead>
              <tbody>
                <tr><td>Gross primary proceeds (primary{gsPrimary ? ' + greenshoe' : ''})</td><td>{f.num(ipo.grossPrimary)}</td></tr>
                <tr className="sub"><td>Less: underwriting fees &amp; expenses ({f.pct(p.feesPct)})</td><td className="neg">{f.num(-ipo.fees)}</td></tr>
                <tr className="bold"><td>Net primary proceeds to the company</td><td>{f.num(ipo.netPrimary)}</td></tr>
                <tr className="sub"><td>Used to repay debt ({f.pct0(p.useProceedsDebtPct)}, capped at gross debt)</td><td>{f.num(ipo.debtRepaid)}</td></tr>
                <tr className="sub"><td>Kept as cash</td><td>{f.num(ipo.cashAdded)}</td></tr>
                <tr><td>Gross secondary proceeds to selling holders{ipo.gsSecondary > 0 ? ' (incl. greenshoe)' : ''}</td><td>{f.num(ipo.grossSecondary)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="qo-note">
            Greenshoe shares = base deal × greenshoe size × % exercised. New greenshoe shares raise money for the company and
            add to the share count; existing holders’ greenshoe shares pay the selling holders and leave the count unchanged.
          </div>
        </Collapsible>

        <Collapsible title={`Post-IPO balance sheet and ${y1} P&L (${f.unitLabel})`} tag="PRO-FORMA">
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th /><th>Pre-IPO</th><th>Post-IPO</th><th>Δ</th></tr></thead>
              <tbody>
                <tr><td>Gross debt</td><td>{f.num(a.company.grossDebt)}</td><td>{f.num(ipo.grossDebtPost)}</td><td className={ipo.debtRepaid > 0 ? 'neg' : ''}>{f.num(-ipo.debtRepaid)}</td></tr>
                <tr><td>Cash</td><td>{f.num(a.company.cash)}</td><td>{f.num(ipo.cashPost)}</td><td>{f.num(ipo.cashAdded)}</td></tr>
                <tr className="bold"><td>Net debt</td><td>{f.num(ipo.netDebt)}</td><td>{f.num(ipo.netDebtPost)}</td><td>{f.num(ipo.netDebtPost - ipo.netDebt)}</td></tr>
                <tr><td>{y1} pre-tax income</td><td>{f.num(ts.ebt[0])}</td><td>{f.num(ipo.ebtPost)}</td><td>{f.num(ipo.ebtPost - ts.ebt[0])}</td></tr>
                <tr className="sub"><td>of which: interest saved on repaid debt</td><td /><td /><td>{f.num(ipo.interestSaved)}</td></tr>
                <tr className="sub"><td>of which: interest earned on the cash added</td><td /><td /><td>{f.num(ipo.cashIncome)}</td></tr>
                <tr><td>{y1} tax (after tax losses)</td><td>{f.num(ts.taxAmt[0])}</td><td>{f.num(ipo.taxPost)}</td><td>{f.num(ipo.taxPost - ts.taxAmt[0])}</td></tr>
                <tr className="bold"><td>{y1} net income</td><td>{f.num(ipo.ntm.netIncome)}</td><td>{f.num(ipo.niPost)}</td><td>{f.num(ipo.niPost - ipo.ntm.netIncome)}</td></tr>
                <tr><td>Shares</td><td>{f.shares(a.company.sharesOut)}</td><td>{f.shares(ipo.postShares)}</td><td>{f.shares(ipo.postShares - a.company.sharesOut)}</td></tr>
                <tr className="bold"><td>{y1} EPS</td><td>{f.price(ipo.epsPre)}</td><td>{f.price(ipo.epsPost)}</td><td>{f.pct(ipo.epsDilution)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="qo-note">
            Net primary proceeds cut net debt one-for-one whatever the repay / retain split; the split only changes which line moves
            and the interest effect. The extra pre-tax income is taxed through the same tax-loss carryforward as the base case.
          </div>
        </Collapsible>

        <Collapsible title={`Operating forecast and net income behind the pricing (${f.unitLabel})`} tag="FORECAST">
          <StatementTable
            labels={periodLabels(a.settings, 'Y', ops.n)} years={ops.years} showYear0
            rows={[
              { label: 'Revenue', values: ops.revenue, year0: ops.revenue0, fmt: f.num, bold: true },
              { label: '% growth', values: ops.growth, fmt: f.pct, sub: true },
              { label: 'EBITDA', values: ops.ebitda, year0: ops.ebitda0, fmt: f.num, bold: true },
              { label: '% margin', values: ops.margin, fmt: f.pct, sub: true },
              { label: 'Less: D&A', values: ops.da, fmt: f.num, sub: true },
              { label: 'EBIT', values: ops.ebit, fmt: f.num },
              { label: 'Less: interest on debt', values: ts.interestExp, fmt: f.num, sub: true },
              { label: 'Add: interest on cash', values: ts.interestInc, fmt: f.num, sub: true },
              { label: 'Pre-tax income', values: ts.ebt, fmt: f.num },
              { label: 'Less: tax (after tax losses)', values: ts.taxAmt, fmt: f.num, sub: true },
              { label: 'Memo: tax-loss (NOL) balance — closing', values: ts.nolClose, fmt: f.num, sub: true },
              { label: 'Net income', values: ts.netIncome, fmt: f.num, bold: true },
            ]}
          />
          <div className="qo-note">The P/E basis prices {y1} net income from this linked forecast (interest on opening balances, the financing-rate inputs).</div>
        </Collapsible>
      </Sections>
    </div>
  );
}

import React, { useMemo } from 'react';
import Waterfall from '../components/Waterfall.jsx';
import Hero from '../components/Hero.jsx';
import LiveChart from '../components/LiveChart.jsx';
import { themed, xCat, yVal, tipBy, vgrad, COL } from '../lib/chartkit.js';
import { Anim } from '../lib/anim.jsx';
import { applyScenario } from '../lib/engine/scenario.js';
import { computeIpo } from '../lib/engine/ipo.js';
import { fmtMoney, fmtPrice, fmtPct, fmtX, fmtNum, CURRENCIES, UNITS } from '../lib/format.js';

export default function IpoTab({ a, set }) {
  const am = useMemo(() => applyScenario(a), [a]);
  const ipo = useMemo(() => computeIpo(am), [am]);
  const s = a.settings;
  const locale = CURRENCIES[s.currency].locale;
  const num = (v) => fmtNum(v, 0, locale);
  const unitLabel = `${CURRENCIES[s.currency].symbol} ${UNITS[s.unit]}`;
  const p = a.ipo;
  const peBasis = p.basis === 'pe';

  // ownership chart: stacked pre/post bars with in-bar % labels
  const ownOpt = useMemo(() => {
    const lbl = () => ({ show: true, position: 'inside', color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 10.5, fontWeight: 700, formatter: (p) => (p.value > 4 ? p.value + '%' : '') });
    return themed({
      tooltip: tipBy({}, (v) => fmtPct(v, 1)),
      xAxis: xCat(['Pre-IPO', 'Post-IPO'], { axisLabel: { color: COL.axisStrong, fontFamily: 'Inter, sans-serif', fontSize: 12 } }),
      yAxis: yVal({ max: 100, axisLabel: { color: COL.axis, formatter: '{value}%' } }),
      series: [
        { name: 'Existing holders', type: 'bar', stack: 'o', barMaxWidth: 90, itemStyle: { color: vgrad(COL.teal) }, label: lbl(), data: [100, +(ipo.existingPost * 100).toFixed(1)] },
        { name: 'New investors', type: 'bar', stack: 'o', barMaxWidth: 90, itemStyle: { color: vgrad(COL.rose), borderRadius: [3, 3, 0, 0] }, label: lbl(), data: [0, +(ipo.freeFloat * 100).toFixed(1)] },
      ],
    });
  }, [ipo]);

  return (
    <div className="view">
        <Hero
          eyebrow="IPO — offer price per share"
          value={ipo.offerPrice}
          fmt={(v) => fmtPrice(v, s)}
          sub={`Priced at ${peBasis ? fmtX(p.offerPE, 1) + ' P/E' : fmtX(p.offerEvEbitda, 1) + ' EV/EBITDA'} on NTM less a ${fmtPct(p.ipoDiscount, 0)} IPO discount. Raises ${fmtMoney(ipo.netPrimary, s)} net for the company; the discount unwinding implies ${fmtPct(ipo.uplift, 1)} day-one upside for allottees.`}
          chips={[
            { label: 'mkt cap', value: ipo.mktCapAtOffer, fmt: (v) => fmtMoney(v, s) },
            { label: 'uplift', value: ipo.uplift, fmt: (v) => fmtPct(v, 1), tone: ipo.uplift >= 0 ? 'pos' : 'neg' },
            { label: 'EPS dilution', value: ipo.epsDilution, fmt: (v) => fmtPct(v, 1), tone: ipo.epsDilution >= 0 ? 'pos' : 'neg' },
            { label: 'free float', value: ipo.freeFloat * 100, fmt: (v) => fmtPct(v, 1) },
          ]}
        />
        {ipo.offerPrice <= 0 && <div className="warn">Offer price is non-positive — check the pricing basis and NTM metrics.</div>}
        <div className="cards">
          <div className="card hero">
            <div className="k">Offer price</div>
            <div className="v"><Anim value={ipo.offerPrice} fmt={(v) => fmtPrice(v, s)} /></div>
            <div className="s">
              Fair value {fmtPrice(ipo.fairPricePre, s)} less {fmtPct(p.ipoDiscount, 0)} IPO discount
            </div>
          </div>
          <div className="card">
            <div className="k">Post-money market cap</div>
            <div className="v"><Anim value={ipo.mktCapAtOffer} fmt={(v) => fmtMoney(v, s)} /></div>
            <div className="s">{fmtNum(ipo.postShares, 2, locale)} shares post-greenshoe</div>
          </div>
          <div className="card">
            <div className="k">Net primary proceeds</div>
            <div className="v"><Anim value={ipo.netPrimary} fmt={(v) => fmtMoney(v, s)} /></div>
            <div className="s">Gross {fmtMoney(ipo.grossPrimary, s)} − fees {fmtMoney(ipo.fees, s)}</div>
          </div>
          <div className="card">
            <div className="k">Fair-value uplift at listing</div>
            <div className={`v ${ipo.uplift >= 0 ? 'pos' : 'neg'}`}>{fmtPct(ipo.uplift, 1)}</div>
            <div className="s">To {fmtPrice(ipo.fairPricePost, s)} when the discount unwinds</div>
          </div>
          <div className="card">
            <div className="k">Pro-forma EPS dilution</div>
            <div className={`v ${ipo.epsDilution >= 0 ? 'pos' : 'neg'}`}>{fmtPct(ipo.epsDilution, 1)}</div>
            <div className="s">{fmtPrice(ipo.epsPre, s)} → {fmtPrice(ipo.epsPost, s)} (incl. interest saved)</div>
          </div>
        </div>

        <div className="grid2">
          <div className="chartbox">
            <div className="ct">Primary proceeds waterfall ({unitLabel})</div>
            <Waterfall
              items={[
                { label: 'Gross primary', value: ipo.grossPrimary, total: true },
                { label: 'Fees', value: -ipo.fees },
                { label: 'Net proceeds', value: ipo.netPrimary, total: true },
                { label: 'Debt repaid', value: -ipo.debtRepaid },
                { label: 'Cash to B/S', value: ipo.cashAdded, total: true },
              ]}
              fmt={num}
              height={250}
            />
          </div>
          <div className="chartbox">
            <div className="ct">Ownership — pre vs post (% of shares)</div>
            <LiveChart option={ownOpt} height={250} />
            <div className="sec-note">
              Free float {fmtPct(ipo.freeFloat * 100, 1)} (primary + secondary + greenshoe). Existing holders keep{' '}
              {fmtPct(ipo.existingPost * 100, 1)} after selling {fmtPct(p.secondaryPct, 0)} secondary.
            </div>
          </div>
        </div>

        <h3 className="blocktitle">Bottom-up: offer price build ({unitLabel})</h3>
        <div className="tablewrap" style={{ marginBottom: 20 }}>
          <table className="fin">
            <tbody>
              {peBasis ? (
                <>
                  <tr><td>NTM net income</td><td>{num(ipo.ntm.netIncome)}</td></tr>
                  <tr className="sub"><td>× Offer P/E</td><td>{fmtX(p.offerPE, 2)}</td></tr>
                  <tr className="bold"><td>Fair equity value (pre-money)</td><td>{num(ipo.fairEquityPre)}</td></tr>
                </>
              ) : (
                <>
                  <tr><td>NTM EBITDA</td><td>{num(ipo.ntm.ebitda)}</td></tr>
                  <tr className="sub"><td>× Offer EV/EBITDA</td><td>{fmtX(p.offerEvEbitda, 2)}</td></tr>
                  <tr><td>Implied enterprise value</td><td>{num(p.offerEvEbitda * ipo.ntm.ebitda)}</td></tr>
                  <tr className="sub"><td>Less: Net debt</td><td className="neg">{num(-ipo.netDebt)}</td></tr>
                  <tr className="bold"><td>Fair equity value (pre-money)</td><td>{num(ipo.fairEquityPre)}</td></tr>
                </>
              )}
              <tr className="sub"><td>÷ Existing shares</td><td>{fmtNum(a.company.sharesOut, 2, locale)}</td></tr>
              <tr><td>Fair value per share</td><td>{fmtPrice(ipo.fairPricePre, s)}</td></tr>
              <tr className="sub"><td>Less: IPO discount</td><td className="neg">{fmtPct(-p.ipoDiscount, 1)}</td></tr>
              <tr className="bold"><td>Offer price</td><td>{fmtPrice(ipo.offerPrice, s)}</td></tr>
              <tr className="sub"><td>Bookbuild range (offer − {fmtPct(p.rangeBand, 0)} → fair post-money)</td><td>{fmtPrice(ipo.rangeLow, s)} – {fmtPrice(ipo.fairPricePost, s)}</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="blocktitle">Deal structure ({unitLabel}, shares in {UNITS[s.unit]})</h3>
        <div className="tablewrap" style={{ marginBottom: 20 }}>
          <table className="fin">
            <thead><tr><th>Shares</th><th>Count</th><th>@ Offer</th><th>Proceeds to</th></tr></thead>
            <tbody>
              <tr><td>Existing shares</td><td>{fmtNum(a.company.sharesOut, 2, locale)}</td><td>{num(a.company.sharesOut * ipo.offerPrice)}</td><td>—</td></tr>
              <tr><td>Primary (new)</td><td>{fmtNum(ipo.primaryShares, 2, locale)}</td><td>{num(p.primaryRaise)}</td><td>Company</td></tr>
              <tr><td>Secondary (sell-down)</td><td>{fmtNum(ipo.secondaryShares, 2, locale)}</td><td>{num(ipo.grossSecondary)}</td><td>Selling holders</td></tr>
              <tr><td>Greenshoe (primary)</td><td>{fmtNum(ipo.greenshoeShares, 2, locale)}</td><td>{num(ipo.greenshoeShares * ipo.offerPrice)}</td><td>Company</td></tr>
              <tr className="bold"><td>Post-IPO shares</td><td>{fmtNum(ipo.postShares, 2, locale)}</td><td>{num(ipo.mktCapAtOffer)}</td><td></td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="blocktitle">Post-IPO balance sheet & P&L effects ({unitLabel})</h3>
        <div className="tablewrap" style={{ marginBottom: 20 }}>
          <table className="fin">
            <thead><tr><th></th><th>Pre-IPO</th><th>Post-IPO</th><th>Δ</th></tr></thead>
            <tbody>
              <tr><td>Gross debt</td><td>{num(a.company.grossDebt)}</td><td>{num(ipo.grossDebtPost)}</td><td className={ipo.debtRepaid > 0 ? 'neg' : ''}>{num(-ipo.debtRepaid)}</td></tr>
              <tr><td>Cash</td><td>{num(a.company.cash)}</td><td>{num(ipo.cashPost)}</td><td>{num(ipo.cashAdded)}</td></tr>
              <tr className="bold"><td>Net debt</td><td>{num(ipo.netDebt)}</td><td>{num(ipo.netDebtPost)}</td><td className="neg">{num(ipo.netDebtPost - ipo.netDebt)}</td></tr>
              <tr><td>NTM net income (pro-forma)</td><td>{num(ipo.ntm.netIncome)}</td><td>{num(ipo.niPost)}</td><td>{num(ipo.niPost - ipo.ntm.netIncome)}</td></tr>
              <tr><td>NTM EPS</td><td>{fmtPrice(ipo.epsPre, s)}</td><td>{fmtPrice(ipo.epsPost, s)}</td><td>{fmtPct(ipo.epsDilution, 1)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="footer-note">
          Pricing basis: {peBasis ? `${fmtX(p.offerPE, 1)} P/E × NTM net income ${fmtMoney(ipo.ntm.netIncome, s)}` : `${fmtX(p.offerEvEbitda, 1)} EV/EBITDA × NTM EBITDA ${fmtMoney(ipo.ntm.ebitda, s)} less net debt`}.
          The bookbuild range for the football field runs from {fmtPrice(ipo.rangeLow, s)} (offer − {fmtPct(p.rangeBand, 0)})
          to {fmtPrice(ipo.fairPricePost, s)} (fair value once the IPO discount unwinds). Net primary proceeds cut net debt
          one-for-one regardless of the repay/retain split; the split only changes which line moves and the interest saved.
        </div>
    </div>
  );
}

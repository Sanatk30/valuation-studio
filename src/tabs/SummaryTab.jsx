import React, { useMemo } from 'react';
import Hero from '../components/Hero.jsx';
import FootballField from '../components/FootballField.jsx';
import { Anim } from '../lib/anim.jsx';
import { applyScenario } from '../lib/engine/scenario.js';
import { computeDcf, dcfSensitivity } from '../lib/engine/dcf.js';
import { computeThreeStatement } from '../lib/engine/threeStatement.js';
import { computeLbo } from '../lib/engine/lbo.js';
import { computeComps } from '../lib/engine/comps.js';
import { computeRegression } from '../lib/engine/regression.js';
import { computePrecedent } from '../lib/engine/precedent.js';
import { computeIpo } from '../lib/engine/ipo.js';
import { fmtMoney, fmtPrice, fmtPct, fmtX, fmtNum, CURRENCIES } from '../lib/format.js';

export default function SummaryTab({ a, set }) {
  const am = useMemo(() => applyScenario(a), [a]);
  const dcf = useMemo(() => computeDcf(am), [am]);
  const sens = useMemo(() => dcfSensitivity(am), [am]);
  const ts = useMemo(() => computeThreeStatement(am), [am]);
  const lbo = useMemo(() => computeLbo(am), [am]);
  const comps = useMemo(() => computeComps(am), [am]);
  const reg = useMemo(() => computeRegression(am), [am]);
  const prec = useMemo(() => computePrecedent(am), [am]);
  const ipo = useMemo(() => computeIpo(am), [am]);
  const s = a.settings;
  const locale = CURRENCIES[s.currency].locale;

  const gridRange = (grid) => {
    const flat = grid.flat().filter(isFinite);
    return flat.length ? [Math.min(...flat), Math.max(...flat)] : [NaN, NaN];
  };
  const [gLo, gHi] = gridRange(sens.gordonGrid);
  const [eLo, eHi] = gridRange(sens.exitGrid);
  const [feLo, feHi] = gridRange(sens.fcfeGrid);

  const items = [
    { label: 'DCF — FCFF Gordon', low: gLo, mid: dcf.gordon.price, high: gHi, color: '#6C8CFF' },
    { label: 'DCF — FCFF exit multiple', low: eLo, mid: dcf.exit.price, high: eHi, color: '#6C8CFF' },
    { label: 'DCF — FCFE @ CoE', low: feLo, mid: dcf.fcfeGordon.price, high: feHi, color: '#22D3EE' },
    ...comps.rows.map((r) => ({
      label: `Comps — ${r.label}`,
      low: r.impliedLow, mid: r.impliedMedian, high: r.impliedHigh, color: '#34D399',
    })),
    ...(reg.ok ? [{ label: 'Regression (±1 SE)', low: reg.impliedLow, mid: reg.impliedPrice, high: reg.impliedHigh, color: '#22D3EE' }] : []),
    { label: 'Precedent — EV/EBITDA', low: prec.rows[1].impliedLow, mid: prec.rows[1].impliedMedian, high: prec.rows[1].impliedHigh, color: '#A78BFA' },
    ...(a.company.currentPrice > 0
      ? [{ label: 'Precedent — premia', low: prec.premia.impliedLow, mid: prec.premia.impliedMedian, high: prec.premia.impliedHigh, color: '#F472B6' }]
      : []),
    { label: 'IPO — offer → fair', low: ipo.rangeLow, mid: ipo.offerPrice, high: ipo.rangeHigh, color: '#F59E0B' },
    {
      label: `LBO floor @ ${fmtPct(a.lbo.hurdleRate, 0)}±2.5%`,
      low: lbo.floorAt(a.lbo.hurdleRate + 2.5),
      mid: lbo.floorPrice,
      high: lbo.floorAt(a.lbo.hurdleRate - 2.5),
      color: '#F87171',
    },
  ];

  const valid = items.filter((it) => isFinite(it.mid));
  const avgMid = valid.length ? valid.reduce((x, it) => x + it.mid, 0) / valid.length : NaN;
  const px = a.company.currentPrice;
  const upside = px > 0 ? (avgMid / px - 1) * 100 : NaN;

  // narrative insight line
  const cheapRich = !isFinite(upside) ? '' : upside > 10 ? `screens ${fmtPct(upside, 0)} cheap to the blended mid` : upside < -10 ? `screens ${fmtPct(-upside, 0)} rich to the blended mid` : 'trades in line with the blended mid';
  const insight = `${a.company.name} ${cheapRich}. Intrinsic value centers near ${fmtPrice(dcf.gordon.price, s)} (FCFF Gordon); the market pays ${fmtX(comps.rows[1].median, 1)} NTM EBITDA for peers, acquirers have paid ${fmtX(prec.rows[1].median, 1)} LTM; a sponsor clears ${fmtPct(a.lbo.hurdleRate, 0)} IRR up to ${fmtPrice(lbo.floorPrice, s)}, and an IPO would price around ${fmtPrice(ipo.offerPrice, s)}.`;

  return (
    <div className="view">
        <Hero
          eyebrow={`${a.company.name} — blended implied value (${valid.length} methods)`}
          value={avgMid}
          fmt={(v) => fmtPrice(v, s)}
          sub={insight}
          chips={[
            ...(px > 0 ? [{ label: upside >= 0 ? 'upside' : 'downside', value: Math.abs(upside), fmt: (v) => fmtPct(v, 1), tone: upside >= 0 ? 'pos' : 'neg' }] : []),
            { label: 'DCF', value: dcf.primary.price, fmt: (v) => fmtPrice(v, s) },
            { label: 'LBO IRR', value: lbo.irr, fmt: (v) => fmtPct(v, 1) },
            { label: 'IPO offer', value: ipo.offerPrice, fmt: (v) => fmtPrice(v, s) },
          ]}
        />

        <div className="cards">
          <div className="card">
            <div className="k">DCF (FCFF primary / FCFE)</div>
            <div className="v" style={{ fontSize: 17 }}>
              <Anim value={dcf.primary.price} fmt={(v) => fmtPrice(v, s)} /> / <Anim value={dcf.fcfeGordon.price} fmt={(v) => fmtPrice(v, s)} />
            </div>
            <div className="s">WACC {fmtPct(dcf.wacc, 2)} · CoE {fmtPct(dcf.costEquity, 2)} (βL {fmtNum(dcf.leveredBeta, 2, 'en-US')}{a.wacc.betaMode === 'hamada' ? ', Hamada' : ', direct'})</div>
          </div>
          <div className="card">
            <div className="k">Comps / Precedent (EV/EBITDA)</div>
            <div className="v" style={{ fontSize: 17 }}>
              <Anim value={comps.rows[1].impliedMedian} fmt={(v) => fmtPrice(v, s)} /> / <Anim value={prec.rows[1].impliedMedian} fmt={(v) => fmtPrice(v, s)} />
            </div>
            <div className="s">{fmtX(comps.rows[1].median, 1)} NTM / {fmtX(prec.rows[1].median, 1)} LTM + control</div>
          </div>
          <div className="card">
            <div className="k">LBO — IRR & floor</div>
            <div className="v" style={{ fontSize: 17 }}>
              <Anim value={lbo.irr} fmt={(v) => fmtPct(v, 1)} /> · <Anim value={lbo.floorPrice} fmt={(v) => fmtPrice(v, s)} />
            </div>
            <div className="s">MOIC {fmtX(lbo.moic, 2)} · floor @ {fmtPct(a.lbo.hurdleRate, 0)} hurdle</div>
          </div>
          <div className="card">
            <div className="k">IPO offer / 3-stmt NI (Y{ts.ops.n})</div>
            <div className="v" style={{ fontSize: 17 }}>
              <Anim value={ipo.offerPrice} fmt={(v) => fmtPrice(v, s)} /> · <Anim value={ts.netIncome[ts.ops.n - 1]} fmt={(v) => fmtMoney(v, s)} />
            </div>
            <div className="s">Uplift {fmtPct(ipo.uplift, 1)} · balance check ✓</div>
          </div>
        </div>

        <h3 className="blocktitle">Football field — implied share price, all methods</h3>
        <div className="chartbox">
          <FootballField items={items} currentPrice={a.company.currentPrice} fmt={(v) => fmtNum(v, 0, locale)} />
        </div>

        <div className="footer-note">
          All methods triangulate one driver set: a {a.drivers.years}-year projection of revenue and EBITDA margin.
          Intrinsic methods (FCFF, FCFE) sit beside market methods (trading comps, regression-priced growth), control
          methods (precedent transactions, premia) and capital-markets methods (IPO pricing, the LBO floor). Flip the
          Bear/Base/Bull scenario in the top bar and watch every bar glide; open the Assumptions dock (A) to drag any
          driver live. DCF bars span the WACC/CoE ± 1% sensitivity grids; comps and precedent bars span the 25th–75th
          percentile of their sets; the regression bar is ±1 standard error; the IPO bar runs from the low bookbuild
          band to fair value; the LBO bar is the max price a sponsor could pay at the hurdle IRR ± 2.5%. The dashed
          line is the current market price. Everything exports to Excel with live formulas from the top bar.
        </div>
    </div>
  );
}

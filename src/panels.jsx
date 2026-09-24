import React, { useState } from 'react';
import NumberInput from './components/NumberInput.jsx';
import Section from './components/Section.jsx';
import PerYearGrid from './components/PerYearGrid.jsx';
import { buildPerYearGrid } from './lib/engine/drivers.js';
import { computeWacc, unleverBeta } from './lib/engine/wacc.js';
import { fmtPct, fmtNum } from './lib/format.js';

function resizeArr(arr, n) {
  const out = arr.slice(0, n);
  while (out.length < n) out.push(arr[arr.length - 1] ?? 0);
  return out;
}

function resizeGrid(grid, n) {
  return {
    ...grid,
    revenue: resizeArr(grid.revenue, n),
    ebitda: resizeArr(grid.ebitda, n),
    da: resizeArr(grid.da, n),
    capex: resizeArr(grid.capex, n),
    nwc: resizeArr(grid.nwc, n),
  };
}

export function CompanyPanel({ a, set }) {
  const c = a.company;
  return (
    <Section title="Company & Market" note="Shared by every model — the equity bridge, tax and share count.">
      <NumberInput label="Shares outstanding" value={c.sharesOut} onChange={(v) => set('company.sharesOut', v)} min={0.1} max={500} step={0.1} hint="Same unit scale as money figures" />
      <NumberInput label="Current share price" value={c.currentPrice} onChange={(v) => set('company.currentPrice', v)} slider={false} step={1} hint="Optional — for upside comparison (0 to hide)" />
      <NumberInput label="Gross debt" value={c.grossDebt} onChange={(v) => set('company.grossDebt', v)} slider={false} step={50} />
      <NumberInput label="Cash & equivalents" value={c.cash} onChange={(v) => set('company.cash', v)} slider={false} step={50} />
      <NumberInput label="Tax rate" value={c.taxRate} onChange={(v) => set('company.taxRate', v)} min={0} max={50} step={0.1} suffix="%" />
    </Section>
  );
}

export function DriversPanel({ a, set }) {
  const d = a.drivers;
  const grid = !!d.perYear;

  const setYears = (v) => {
    const y = Math.round(Math.min(15, Math.max(3, v)));
    set('drivers', {
      ...d,
      years: y,
      growthCustom: d.growthCustom ? resizeArr(d.growthCustom, y) : null,
      marginCustom: d.marginCustom ? resizeArr(d.marginCustom, y) : null,
      perYear: d.perYear ? resizeGrid(d.perYear, y) : null,
    });
    // keep the LBO exit year within the horizon, matching the header's Years slider
    if (a.lbo.exitYear > y) set('lbo.exitYear', y);
  };
  const toggleGrid = (on) => {
    set('drivers', {
      ...d,
      perYear: on ? buildPerYearGrid(d) : null,
      growthCustom: null,
      marginCustom: null,
    });
  };

  return (
    <Section title="Operating Drivers" note="One driver set powers the DCF, 3-statement, LBO, comps, precedent and IPO models — change it once, everything updates.">
      <NumberInput label="Base-year (LTM) revenue" value={d.revenue0} onChange={(v) => set('drivers.revenue0', v)} slider={false} step={100} />
      <NumberInput label="Projection years" value={d.years} onChange={setYears} min={3} max={15} step={1} />
      <label className="toggle">
        <input type="checkbox" checked={grid} onChange={(e) => toggleGrid(e.target.checked)} />
        Enter each year's data (grid)
      </label>
      {grid ? (
        <>
          <PerYearGrid grid={d.perYear} years={d.years} onChange={(g) => set('drivers.perYear', g)} />
          <div className="hint">
            Year-0 NWC stays at {fmtPct(d.nwcPct, 1)} of base revenue (set below) — it anchors the first year's ΔNWC.
          </div>
          <NumberInput label="Year-0 NWC (% of revenue)" value={d.nwcPct} onChange={(v) => set('drivers.nwcPct', v)} min={-10} max={40} step={0.5} suffix="%" />
        </>
      ) : (
        <>
          <NumberInput label="Revenue growth — Year 1" value={d.growthStart} onChange={(v) => set('drivers.growthStart', v)} min={-20} max={50} step={0.5} suffix="%" />
          <NumberInput label={`Revenue growth — Year ${d.years}`} value={d.growthEnd} onChange={(v) => set('drivers.growthEnd', v)} min={-20} max={50} step={0.5} suffix="%" hint="Fades linearly between the two" />
          <NumberInput label="EBITDA margin — Year 1" value={d.marginStart} onChange={(v) => set('drivers.marginStart', v)} min={1} max={70} step={0.5} suffix="%" />
          <NumberInput label={`EBITDA margin — Year ${d.years}`} value={d.marginEnd} onChange={(v) => set('drivers.marginEnd', v)} min={1} max={70} step={0.5} suffix="%" />
          <NumberInput label="D&A (% of revenue)" value={d.daPct} onChange={(v) => set('drivers.daPct', v)} min={0} max={20} step={0.1} suffix="%" />
          <NumberInput label="Capex (% of revenue)" value={d.capexPct} onChange={(v) => set('drivers.capexPct', v)} min={0} max={25} step={0.1} suffix="%" />
          <NumberInput label="NWC (% of revenue)" value={d.nwcPct} onChange={(v) => set('drivers.nwcPct', v)} min={-10} max={40} step={0.5} suffix="%" hint="Working-capital balance; only its change hits cash flow" />
        </>
      )}
    </Section>
  );
}

export function WaccPanel({ a, set }) {
  const w = a.wacc;
  const out = computeWacc(a);
  const hamada = w.betaMode === 'hamada';
  const [peerBL, setPeerBL] = useState(1.2);
  const [peerDE, setPeerDE] = useState(0.5);
  const peerBu = unleverBeta(peerBL, peerDE, a.company.taxRate);

  return (
    <Section title="Cost of Capital (WACC)" note="CAPM with Hamada levering: βL = βU × (1 + (1 − t) × D/E), D/E from the target capital structure.">
      <NumberInput label="Risk-free rate" value={w.riskFree} onChange={(v) => set('wacc.riskFree', v)} min={0} max={15} step={0.1} suffix="%" />
      <NumberInput label="Equity risk premium" value={w.erp} onChange={(v) => set('wacc.erp', v)} min={2} max={12} step={0.1} suffix="%" />

      <div className="seg">
        <button className={hamada ? 'on' : ''} onClick={() => set('wacc.betaMode', 'hamada')}>Hamada relever</button>
        <button className={!hamada ? 'on' : ''} onClick={() => set('wacc.betaMode', 'direct')}>Direct levered β</button>
      </div>

      {hamada ? (
        <>
          <NumberInput label="Unlevered (asset) beta βU" value={w.unleveredBeta} onChange={(v) => set('wacc.unleveredBeta', v)} min={0.2} max={2} step={0.01} />
          <div className="sec-note">
            D/E {fmtNum(out.de, 3, 'en-US')} → levered β <b style={{ color: 'var(--accent)' }}>{fmtNum(out.leveredBeta, 3, 'en-US')}</b>
          </div>
          <details style={{ marginBottom: 10 }}>
            <summary style={{ fontSize: 12, color: 'var(--faint)', cursor: 'pointer' }}>Unlever a peer beta…</summary>
            <div style={{ paddingTop: 8 }}>
              <NumberInput label="Peer levered β" value={peerBL} onChange={setPeerBL} min={0.2} max={3} step={0.05} />
              <NumberInput label="Peer D/E" value={peerDE} onChange={setPeerDE} min={0} max={3} step={0.05} />
              <div className="sec-note">
                Implied βU = <b>{fmtNum(peerBu, 3, 'en-US')}</b>{' '}
                <button className="btn" style={{ padding: '3px 10px', fontSize: 11, marginLeft: 6 }} onClick={() => set('wacc.unleveredBeta', Math.round(peerBu * 1000) / 1000)}>
                  Use as βU
                </button>
              </div>
            </div>
          </details>
        </>
      ) : (
        <>
          <NumberInput label="Levered beta βL" value={w.beta} onChange={(v) => set('wacc.beta', v)} min={0.3} max={2.5} step={0.05} />
          <div className="sec-note">Implied unlevered βU = {fmtNum(out.unleveredBeta, 3, 'en-US')} at D/E {fmtNum(out.de, 3, 'en-US')}</div>
        </>
      )}

      <NumberInput label="Size / alpha premium" value={w.sizePremium} onChange={(v) => set('wacc.sizePremium', v)} min={0} max={6} step={0.25} suffix="%" />
      <NumberInput label="Pre-tax cost of debt" value={w.costDebt} onChange={(v) => set('wacc.costDebt', v)} min={2} max={20} step={0.1} suffix="%" />
      <NumberInput label="Debt weight D/(D+E)" value={w.debtWeight} onChange={(v) => set('wacc.debtWeight', v)} min={0} max={90} step={1} suffix="%" />
      <div className="sec-note" style={{ marginTop: 8 }}>
        Cost of equity <b>{fmtPct(out.costEquity, 2)}</b> · After-tax Kd <b>{fmtPct(out.afterTaxKd, 2)}</b> · WACC{' '}
        <b style={{ color: 'var(--accent)' }}>{fmtPct(out.wacc, 2)}</b>
      </div>
    </Section>
  );
}

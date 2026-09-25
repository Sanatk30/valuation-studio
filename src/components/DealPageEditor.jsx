import React, { useMemo } from 'react';
import CompanyPageEditor, { CpNum, CpTxt } from './CompanyPageEditor.jsx';
import { computeDeal, validateDeal, offerLegs, TRANSACTION_TYPES, CONSIDERATION_TYPES, PREMIUM_DAYS } from '../lib/engine/precedentDeal.js';
import { fmtNum, fmtPct, fmtPrice, fmtX, CURRENCIES, UNITS } from '../lib/format.js';

/**
 * One transaction's input page, in the layout of the 3E deal sheet: the deal
 * terms and the offer-price build, then the target's reported financials on the
 * shared comparable-company page (so the LTM bridge, adjustments and treasury
 * share count are the same code the comps peers run on).
 *
 * Blank inputs stay blank (null): a blank offer term the deal's consideration
 * needs, or a blank unaffected price, reads NA — never 0. The purchase
 * consideration decides which offer terms apply.
 */
export default function DealPageEditor({ deal, settings, onChange, onDelete }) {
  const d = useMemo(() => computeDeal(deal), [deal]);
  const issues = useMemo(() => validateDeal(d), [d]);
  const sym = CURRENCIES[settings.currency].symbol;
  const unit = UNITS[settings.unit];
  const locale = CURRENCIES[settings.currency].locale;

  const set = (patch) => onChange({ ...deal, ...patch });
  const money = (v) => (isFinite(v) ? fmtNum(v, 1, locale) : 'NA');
  const px = (v) => (isFinite(v) ? fmtPrice(v, settings, 2) : 'NA');
  const x = (v) => (isFinite(v) ? fmtX(v, 2) : 'NM');
  const pct = (v) => (isFinite(v) ? fmtPct(v * 100, 1) : 'NA');

  const Num = ({ value, onSet, disabled }) => <CpNum value={value ?? null} onSet={onSet} disabled={disabled} />;
  const Txt = ({ value, onSet, ph }) => <CpTxt value={value} onSet={onSet} ph={ph} />;
  const Sel = ({ value, onSet, options }) => (
    <select className="cp-in txt" value={value || ''} onChange={(e) => onSet(e.target.value)}>
      <option value="">choose…</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  const legs = offerLegs(deal.consideration);

  const errs = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');

  return (
    <div className="cp">
      <div className="cp-head">
        <div>
          <div className="cp-title">Acquisition of {deal.target.name || 'the target'} by {deal.acquirer || 'the acquirer'}</div>
          <div className="cp-sub">Transaction input page · {sym} in {unit}, except per share data</div>
        </div>
        <div className="cp-badges">
          {errs.length > 0 && <span className="cp-badge err">{errs.length} error{errs.length > 1 ? 's' : ''}</span>}
          {warns.length > 0 && <span className="cp-badge warn">{warns.length} incomplete</span>}
          {!errs.length && !warns.length && <span className="cp-badge ok">complete</span>}
          {onDelete && <button className="peer-del" title="Remove this transaction" onClick={onDelete}>×</button>}
        </div>
      </div>

      {issues.length > 0 && (
        <ul className="cp-issues">{issues.map((it, i) => <li key={i} className={it.level}>{it.msg}</li>)}</ul>
      )}

      <div className="cp-grid2">
        <div>
          <h4 className="cp-h">Transaction</h4>
          <table className="fin cp-kv"><tbody>
            <tr><td>Acquirer</td><td><Txt value={deal.acquirer} onSet={(v) => set({ acquirer: v })} /></td></tr>
            <tr><td>Acquirer ticker</td><td><Txt value={deal.acquirerTicker} onSet={(v) => set({ acquirerTicker: v })} /></td></tr>
            <tr><td>Target</td><td><Txt value={deal.target.name} onSet={(v) => set({ target: { ...deal.target, name: v } })} /></td></tr>
            <tr><td>Date announced</td><td><input className="cp-in txt" type="date" value={deal.dateAnnounced || ''} onChange={(e) => set({ dateAnnounced: e.target.value })} /></td></tr>
            <tr><td>Date effective</td><td><Txt value={deal.dateEffective} onSet={(v) => set({ dateEffective: v })} ph="date or Pending" /></td></tr>
            <tr><td>Transaction type</td><td><Sel value={deal.transactionType} onSet={(v) => set({ transactionType: v })} options={TRANSACTION_TYPES} /></td></tr>
            <tr><td>Purchase consideration</td><td><Sel value={deal.consideration} onSet={(v) => set({ consideration: v })} options={CONSIDERATION_TYPES} /></td></tr>
            <tr><td>Target description</td><td><Txt value={deal.targetDescription} onSet={(v) => set({ targetDescription: v })} ph="[to come]" /></td></tr>
          </tbody></table>
        </div>

        <div>
          <h4 className="cp-h">Offer price &amp; enterprise value</h4>
          <table className="fin cp-kv"><tbody>
            <tr><td>Cash offer per share</td><td>{legs && !legs.cash ? <span className="muted">none ({deal.consideration})</span> : <Num value={deal.cashOffer} onSet={(v) => set({ cashOffer: v })} />}</td></tr>
            <tr><td>Exchange ratio (acquirer shares per target share)</td><td>{legs && !legs.stock ? <span className="muted">none ({deal.consideration})</span> : <Num value={deal.exchangeRatio} onSet={(v) => set({ exchangeRatio: v })} />}</td></tr>
            <tr><td>Acquirer share price</td><td>{legs && !legs.stock ? <span className="muted">none ({deal.consideration})</span> : <Num value={deal.acquirerPrice} onSet={(v) => set({ acquirerPrice: v })} />}</td></tr>
            <tr className="sub"><td>Stock offer per share</td><td className="calc">{px(d.stockOffer)}</td></tr>
            <tr className="bold"><td>Offer price per share</td><td className="calc">{px(d.offerPrice)}</td></tr>
            <tr className="sub"><td>× Fully diluted shares</td><td className="calc">{fmtNum(d.page.shares.fullyDiluted, 3, locale)}</td></tr>
            <tr className="bold"><td>Implied equity value</td><td className="calc">{money(d.equityValue)}</td></tr>
            <tr className="sub"><td>Plus: total debt</td><td className="calc">{money(d.page.bs.debt[1])}</td></tr>
            <tr className="sub"><td>Plus: preferred</td><td className="calc">{money(d.page.bs.preferred[1])}</td></tr>
            <tr className="sub"><td>Plus: noncontrolling interest</td><td className="calc">{money(d.page.bs.nci[1])}</td></tr>
            <tr className="sub"><td>Less: cash</td><td className="calc neg">{money(-d.page.bs.cash[1])}</td></tr>
            <tr className="bold"><td>Implied enterprise value</td><td className="calc">{money(d.enterpriseValue)}</td></tr>
          </tbody></table>
        </div>
      </div>

      <div className="cp-grid2">
        <div>
          <h4 className="cp-h">LTM transaction multiples</h4>
          <table className="fin cp-kv3">
            <thead><tr><th /><th>Multiple</th><th>Metric</th></tr></thead>
            <tbody>
              <tr className="bold"><td>EV / LTM Sales</td><td className="calc">{x(d.evSales)}</td><td className="calc">{money(d.ltmSales)}</td></tr>
              <tr className="bold"><td>EV / LTM EBITDA</td><td className="calc">{x(d.evEbitda)}</td><td className="calc">{money(d.ltmEbitda)}</td></tr>
              <tr className="bold"><td>EV / LTM EBIT</td><td className="calc">{x(d.evEbit)}</td><td className="calc">{money(d.ltmEbit)}</td></tr>
              <tr className="bold"><td>Offer price / LTM EPS</td><td className="calc">{x(d.pe)}</td><td className="calc">{px(d.page.adjEps[5])}</td></tr>
              <tr className="sub"><td>LTM EBITDA margin</td><td className="calc" colSpan={2}>{pct(d.ebitdaMargin)}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4 className="cp-h">Premiums paid <span className="cp-note">offer price over the unaffected share price</span></h4>
          <table className="fin cp-kv3">
            <thead><tr><th>Days prior</th><th>Unaffected price</th><th>Premium</th></tr></thead>
            <tbody>
              {PREMIUM_DAYS.map((w) => (
                <tr key={w}>
                  <td>{w} day{w > 1 ? 's' : ''}</td>
                  <td><Num value={deal.unaffected?.[w]}
                    onSet={(v) => set({ unaffected: { ...deal.unaffected, [w]: v } })} /></td>
                  <td className="calc">{pct(d.premiums[w])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h4 className="cp-h">Target reported financials <span className="cp-note">the same input page the comparable companies use — priced here at the offer</span></h4>
      <CompanyPageEditor
        co={deal.target}
        settings={settings}
        offerPrice={d.offerPrice}
        onChange={(next) => set({ target: next })}
      />
    </div>
  );
}

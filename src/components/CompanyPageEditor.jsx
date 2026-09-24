import React, { useEffect, useMemo, useState } from 'react';
import { computeCompany, validateCompany, P } from '../lib/engine/compsCo.js';
import { fmtNum, fmtPct, fmtPrice, fmtX, CURRENCIES, UNITS } from '../lib/format.js';
import PasteDialog from './PasteDialog.jsx';

/**
 * One company's input page, in the layout of the 3E "CompCo" sheet:
 * reported income statement with the LTM bridge, non-recurring adjustments,
 * cash-flow data, a two-column balance sheet with its check, the treasury-method
 * share build, and the LTM multiples/ratios they produce (comps is LTM only —
 * no consensus estimates).
 *
 * Blue-dashed cells are inputs; everything else recalculates as you type.
 * A blank input stays blank (stored as null): on a core line it reads NA, on an
 * adjustment line (non-recurring items, NCI, preferred, options, converts,
 * stubs) it means "none".
 */

const parse = (t) => {
  const s = String(t ?? '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const v = Number(s.replace(/[(),\s]/g, ''));
  return Number.isFinite(v) ? (neg ? -v : v) : NaN;
};
const show = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : String(v));

/** Numeric cell: blank stays blank; keeps partial text ("12.", "-") while typing. */
function CpNum({ value, onSet, disabled, wide }) {
  const [text, setText] = useState(show(value));
  useEffect(() => {
    const p = parse(text);
    if (p !== (value ?? null)) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className="cp-in" inputMode="decimal" value={text} disabled={disabled} placeholder="—"
      style={wide ? { width: '100%' } : undefined}
      onChange={(e) => { setText(e.target.value); const v = parse(e.target.value); if (v === null || Number.isFinite(v)) onSet(v); }}
      onBlur={() => setText(show(value))}
    />
  );
}
function CpTxt({ value, onSet, ph, disabled }) {
  return <input className="cp-in txt" value={value ?? ''} placeholder={ph} disabled={disabled} onChange={(e) => onSet(e.target.value)} />;
}
/** LTM value / metric of a multiple, whatever the engine's array shape. */
const ltmOf = (m) => (Array.isArray(m?.values) ? m.values[0] : m?.value);
const ltmMetric = (m) => (Array.isArray(m?.metric) ? m.metric[0] : m?.metric);

const PERIOD_HEADS = ['FY-2', 'FY-1', 'FY0', 'Prior stub', 'Current stub', 'LTM'];

export default function CompanyPageEditor({ co, settings, tiers, onChange, onDelete, readOnly }) {
  const [pasting, setPasting] = useState(false);
  const page = useMemo(() => computeCompany(co), [co]);
  const issues = useMemo(() => validateCompany(page), [page]);
  const locale = CURRENCIES[settings.currency].locale;
  const sym = CURRENCIES[settings.currency].symbol;
  const unit = UNITS[settings.unit];

  const set = (patch) => onChange({ ...co, ...patch });
  const setIn = (group, key, idx, v) => {
    const arr = [...(co[group][key] || [])];
    arr[idx] = v;
    set({ [group]: { ...co[group], [key]: arr } });
  };
  const money = (v) => (isFinite(v) ? fmtNum(v, 1, locale) : 'NA');
  const pct = (v) => (isFinite(v) ? fmtPct(v * 100, 1) : 'NA');
  const px = (v) => (isFinite(v) ? fmtPrice(v, settings, 2) : 'NA');
  const x = (v) => (isFinite(v) ? fmtX(v, 2) : 'NA');

  const num = (value, onSet, wide) => <CpNum value={value} onSet={onSet} disabled={readOnly} wide={wide} />;
  const txt = (value, onSet, ph) => <CpTxt value={value} onSet={onSet} ph={ph} disabled={readOnly} />;

  /** An income-statement / cash-flow line: five editable periods + derived LTM. */
  const inRow = (label, group, k, indent) => (
    <tr key={`${group}.${k}`}>
      <td className={indent ? 'sub' : ''}>{label}</td>
      {[0, 1, 2, 3, 4].map((i) => (
        <td key={i}>{num(co[group]?.[k]?.[i] ?? null, (v) => setIn(group, k, i, v))}</td>
      ))}
      <td className="calc">{money(page[group]?.[k]?.[P.LTM])}</td>
    </tr>
  );
  /** A derived line across all six periods. */
  const calcRow = (label, vals, fmt = money, bold, indent) => (
    <tr key={label + (bold ? 'b' : '')} className={bold ? 'bold' : indent ? 'sub' : ''}>
      <td>{label}</td>
      {(vals || []).map((v, i) => <td key={i} className="calc">{fmt(v)}</td>)}
    </tr>
  );

  const errs = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');

  return (
    <div className="cp">
      <div className="cp-head">
        <div>
          <div className="cp-title">{co.name || 'Unnamed'} {co.ticker ? <span className="cp-tick">({co.exchange || '—'}:{co.ticker})</span> : null}</div>
          <div className="cp-sub">Input page · {sym} in {unit}, except per share data</div>
        </div>
        <div className="cp-badges">
          {errs.length > 0 && <span className="cp-badge err">{errs.length} error{errs.length > 1 ? 's' : ''}</span>}
          {warns.length > 0 && <span className="cp-badge warn">{warns.length} incomplete</span>}
          {!errs.length && !warns.length && <span className="cp-badge ok">complete</span>}
          {!readOnly && <button className="btn sm" title="Paste a block of financials straight out of Excel" onClick={() => setPasting(true)}>Paste from Excel</button>}
          {onDelete && !readOnly && <button className="peer-del" title="Remove this company" onClick={onDelete}>×</button>}
        </div>
      </div>

      {pasting && (
        <PasteDialog mode="grid" co={co} onApply={(next) => onChange(next)} onClose={() => setPasting(false)} />
      )}

      {issues.length > 0 && (
        <ul className="cp-issues">
          {issues.map((it, i) => <li key={i} className={it.level}>{it.msg}</li>)}
        </ul>
      )}

      {/* ---------------- general + market ---------------- */}
      <div className="cp-grid2">
        <div>
          <h4 className="cp-h">General information</h4>
          <table className="fin cp-kv"><tbody>
            <tr><td>Company name</td><td>{txt(co.name, (v) => set({ name: v }))}</td></tr>
            <tr><td>Ticker</td><td>{txt(co.ticker, (v) => set({ ticker: v }))}</td></tr>
            <tr><td>Stock exchange</td><td>{txt(co.exchange, (v) => set({ exchange: v }))}</td></tr>
            {tiers && (
              <tr><td>Tier</td><td>
                <select className="cp-in txt" disabled={readOnly} value={co.tierId ?? ''} onChange={(e) => set({ tierId: e.target.value || null })}>
                  <option value="">— unassigned —</option>
                  {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </td></tr>
            )}
            <tr><td>Fiscal year ending (FY0)</td><td><input className="cp-in txt" type="date" disabled={readOnly} value={co.fyEnd} onChange={(e) => set({ fyEnd: e.target.value })} /></td></tr>
            <tr><td>Current stub ending</td><td><input className="cp-in txt" type="date" disabled={readOnly} value={co.stubEnd} onChange={(e) => set({ stubEnd: e.target.value })} /></td></tr>
            <tr><td>Moody's rating</td><td>{txt(co.moodys, (v) => set({ moodys: v }))}</td></tr>
            <tr><td>S&amp;P rating</td><td>{txt(co.sp, (v) => set({ sp: v }))}</td></tr>
            <tr><td>Predicted beta</td><td>{num(co.beta, (v) => set({ beta: v }))}</td></tr>
            <tr><td>Marginal tax rate (%)</td><td>{num(co.taxRate, (v) => set({ taxRate: v }))}</td></tr>
            <tr><td>Business description</td><td>{txt(co.description, (v) => set({ description: v }), '[to come]')}</td></tr>
          </tbody></table>
        </div>

        <div>
          <h4 className="cp-h">Market data &amp; enterprise value</h4>
          <table className="fin cp-kv"><tbody>
            <tr><td>Current price</td><td>{num(co.price, (v) => set({ price: v }))}</td></tr>
            <tr className="sub"><td>% of 52-week high</td><td className="calc">{pct(page.pctOf52wHigh)}</td></tr>
            <tr><td>52-week high</td><td>{num(co.high52, (v) => set({ high52: v }))}</td></tr>
            <tr><td>52-week low</td><td>{num(co.low52, (v) => set({ low52: v }))}</td></tr>
            <tr><td>Dividend per share (MRQ)</td><td>{num(co.dpsMRQ, (v) => set({ dpsMRQ: v }))}</td></tr>
            <tr><td>Fully diluted shares</td><td className="calc">{fmtNum(page.shares.fullyDiluted, 3, locale)}</td></tr>
            <tr className="bold"><td>Equity value</td><td className="calc">{money(page.equityValue)}</td></tr>
            <tr className="sub"><td>Plus: total debt</td><td className="calc">{money(page.bs.debt[1])}</td></tr>
            <tr className="sub"><td>Plus: preferred stock</td><td className="calc">{money(page.bs.preferred[1])}</td></tr>
            <tr className="sub"><td>Plus: noncontrolling interest</td><td className="calc">{money(page.bs.nci[1])}</td></tr>
            <tr className="sub"><td>Less: cash &amp; equivalents</td><td className="calc neg">{money(-page.bs.cash[1])}</td></tr>
            <tr className="bold"><td>Enterprise value</td><td className="calc">{money(page.enterpriseValue)}</td></tr>
          </tbody></table>
        </div>
      </div>

      {/* ---------------- income statement ---------------- */}
      <h4 className="cp-h">Reported income statement <span className="cp-note">LTM = FY0 + current stub − prior stub</span></h4>
      <div className="tablewrap">
        <table className="fin cp-per">
          <thead><tr><th /> {PERIOD_HEADS.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {inRow('Sales', 'is', 'sales')}
            {inRow('COGS (incl. D&A)', 'is', 'cogs')}
            {calcRow('Gross profit', page.grossProfit, money, true, false)}
            {inRow('SG&A', 'is', 'sga')}
            {inRow('Other expense / (income)', 'is', 'otherExp')}
            {calcRow('EBIT', page.ebit, money, true, false)}
            {inRow('Interest expense, net', 'is', 'interest')}
            {calcRow('Pre-tax income', page.pretax, money, true, false)}
            {inRow('Income taxes', 'is', 'taxes')}
            {inRow('Noncontrolling interest', 'is', 'nci')}
            {inRow('Preferred dividends', 'is', 'prefDiv')}
            {calcRow('Net income', page.netIncome, money, true, false)}
            {calcRow('Effective tax rate', page.effTaxRate, pct, false, true)}
            {inRow('Weighted avg. diluted shares', 'is', 'dilutedShares')}
            {calcRow('Diluted EPS', page.eps, px, false, false)}
          </tbody>
        </table>
      </div>

      {/* ---------------- adjusted income statement ---------------- */}
      <h4 className="cp-h">Adjusted income statement <span className="cp-note">non-recurring items added back, tax-effected at the marginal rate</span></h4>
      <div className="tablewrap">
        <table className="fin cp-per">
          <thead><tr><th /> {PERIOD_HEADS.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {inRow('Non-recurring items in COGS', 'adj', 'nrCogs')}
            {calcRow('Adj. gross profit', page.adjGrossProfit, money, true, false)}
            {calcRow('% margin', page.grossMargin, pct, false, true)}
            {inRow('Other non-recurring items', 'adj', 'nrOther')}
            {calcRow('Adjusted EBIT', page.adjEbit, money, true, false)}
            {calcRow('% margin', page.ebitMargin, pct, false, true)}
            {calcRow('Adjusted EBITDA', page.adjEbitda, money, true, false)}
            {calcRow('% margin', page.ebitdaMargin, pct, false, true)}
            {inRow('Non-operating non-recurring', 'adj', 'nrNonOp')}
            {calcRow('Tax adjustment', page.taxAdjustment, money, false, true)}
            {calcRow('Adjusted net income', page.adjNetIncome, money, true, false)}
            {calcRow('% margin', page.netMargin, pct, false, true)}
            {calcRow('Adjusted diluted EPS', page.adjEps, px, true, false)}
          </tbody>
        </table>
      </div>

      {/* ---------------- cash flow ---------------- */}
      <h4 className="cp-h">Cash flow statement data</h4>
      <div className="tablewrap">
        <table className="fin cp-per">
          <thead><tr><th /> {PERIOD_HEADS.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {inRow('Cash from operations', 'cf', 'cfo')}
            {inRow('Capital expenditures', 'cf', 'capex')}
            {calcRow('% sales', page.capexPctSales, pct, false, true)}
            {calcRow('Free cash flow', page.fcf, money, true, false)}
            {calcRow('% margin', page.fcfMargin, pct, false, true)}
            {calcRow('FCF / share', page.fcfPerShare, px, false, false)}
            {inRow('Depreciation & amortization', 'cf', 'da')}
            {calcRow('% sales', page.daPctSales, pct, false, true)}
          </tbody>
        </table>
      </div>

      {/* ---------------- balance sheet & share build ---------------- */}
      <div className="cp-grid2">
        <div>
          <h4 className="cp-h">Balance sheet data</h4>
          <table className="fin cp-kv3">
            <thead><tr><th /><th>Prior</th><th>Current</th></tr></thead>
            <tbody>
              {[
                ['Cash and cash equivalents', 'cash'], ['Accounts receivable', 'ar'],
                ['Inventories', 'inventory'], ['Prepaids and other current assets', 'prepaid'],
              ].map(([lab, k]) => (
                <tr key={k}><td>{lab}</td>{[0, 1].map((i) => <td key={i}>{num(co.bs[k]?.[i], (v) => setIn('bs', k, i, v))}</td>)}</tr>
              ))}
              <tr className="bold"><td>Total current assets</td>{page.bs.totalCurrentAssets.map((v, i) => <td key={i} className="calc">{money(v)}</td>)}</tr>
              {[['Property, plant & equipment, net', 'ppe'], ['Goodwill and intangibles', 'goodwill'], ['Other assets', 'otherAssets']].map(([lab, k]) => (
                <tr key={k}><td>{lab}</td>{[0, 1].map((i) => <td key={i}>{num(co.bs[k]?.[i], (v) => setIn('bs', k, i, v))}</td>)}</tr>
              ))}
              <tr className="bold"><td>Total assets</td>{page.bs.totalAssets.map((v, i) => <td key={i} className="calc">{money(v)}</td>)}</tr>
              {[['Accounts payable', 'ap'], ['Accrued liabilities', 'accrued'], ['Other current liabilities', 'otherCurLiab']].map(([lab, k]) => (
                <tr key={k}><td>{lab}</td>{[0, 1].map((i) => <td key={i}>{num(co.bs[k]?.[i], (v) => setIn('bs', k, i, v))}</td>)}</tr>
              ))}
              <tr className="bold"><td>Total current liabilities</td>{page.bs.totalCurrentLiab.map((v, i) => <td key={i} className="calc">{money(v)}</td>)}</tr>
              {[['Total debt', 'debt'], ['Other long-term liabilities', 'otherLTLiab']].map(([lab, k]) => (
                <tr key={k}><td>{lab}</td>{[0, 1].map((i) => <td key={i}>{num(co.bs[k]?.[i], (v) => setIn('bs', k, i, v))}</td>)}</tr>
              ))}
              <tr className="bold"><td>Total liabilities</td>{page.bs.totalLiabilities.map((v, i) => <td key={i} className="calc">{money(v)}</td>)}</tr>
              {[['Noncontrolling interest', 'nci'], ['Preferred stock', 'preferred'], ["Shareholders' equity", 'equity']].map(([lab, k]) => (
                <tr key={k}><td>{lab}</td>{[0, 1].map((i) => <td key={i}>{num(co.bs[k]?.[i], (v) => setIn('bs', k, i, v))}</td>)}</tr>
              ))}
              <tr className="bold"><td>Total liabilities and equity</td>{page.bs.totalLiabEquity.map((v, i) => <td key={i} className="calc">{money(v)}</td>)}</tr>
              <tr className={Math.abs(page.bs.check[1]) > 1e-6 ? 'bold cp-bad' : 'bold'}>
                <td>Balance check</td>{page.bs.check.map((v, i) => <td key={i} className="calc">{fmtNum(v, 2, locale)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="cp-h">Fully diluted shares <span className="cp-note">treasury stock method</span></h4>
          <table className="fin cp-kv"><tbody>
            <tr><td>Basic shares outstanding</td><td>{num(co.basicShares, (v) => set({ basicShares: v }))}</td></tr>
            <tr className="sub"><td>Plus: shares from in-the-money options</td><td className="calc">{fmtNum(page.shares.itmShares, 3, locale)}</td></tr>
            <tr className="sub"><td>Less: shares repurchased</td><td className="calc neg">{fmtNum(page.shares.repurchased, 3, locale)}</td></tr>
            <tr><td>Net new shares from options</td><td className="calc">{fmtNum(page.shares.netNew, 3, locale)}</td></tr>
            <tr className="sub"><td>Plus: shares from convertibles</td><td className="calc">{fmtNum(page.shares.convShares, 3, locale)}</td></tr>
            <tr className="bold"><td>Fully diluted shares outstanding</td><td className="calc">{fmtNum(page.shares.fullyDiluted, 3, locale)}</td></tr>
          </tbody></table>

          <h5 className="cp-h5">Options / warrants</h5>
          <table className="fin cp-kv4">
            <thead><tr><th>Tranche</th><th>Shares</th><th>Strike</th><th>ITM shares</th><th /></tr></thead>
            <tbody>
              {(co.options || []).map((o, i) => (
                <tr key={i}>
                  <td>Tranche {i + 1}</td>
                  <td>{num(o.shares, (v) => set({ options: co.options.map((r, j) => (j === i ? { ...r, shares: v } : r)) }))}</td>
                  <td>{num(o.strike, (v) => set({ options: co.options.map((r, j) => (j === i ? { ...r, strike: v } : r)) }))}</td>
                  <td className="calc">{fmtNum(page.shares.options[i]?.itm ?? 0, 3, locale)}</td>
                  <td>{!readOnly && <button className="peer-del" onClick={() => set({ options: co.options.filter((_, j) => j !== i) })}>×</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!readOnly && <button className="btn sm" onClick={() => set({ options: [...(co.options || []), { shares: null, strike: null }] })}>+ Add tranche</button>}

          <h5 className="cp-h5">Convertible securities</h5>
          <table className="fin cp-kv4">
            <thead><tr><th>Issue</th><th>Amount</th><th>Conv. price</th><th>New shares</th><th /></tr></thead>
            <tbody>
              {(co.converts || []).map((c, i) => (
                <tr key={i}>
                  <td>Issue {i + 1}</td>
                  <td>{num(c.amount, (v) => set({ converts: co.converts.map((r, j) => (j === i ? { ...r, amount: v } : r)) }))}</td>
                  <td>{num(c.price, (v) => set({ converts: co.converts.map((r, j) => (j === i ? { ...r, price: v } : r)) }))}</td>
                  <td className="calc">{fmtNum(page.shares.converts[i]?.newShares ?? 0, 3, locale)}</td>
                  <td>{!readOnly && <button className="peer-del" onClick={() => set({ converts: co.converts.filter((_, j) => j !== i) })}>×</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!readOnly && <button className="btn sm" onClick={() => set({ converts: [...(co.converts || []), { amount: null, price: null }] })}>+ Add issue</button>}
        </div>
      </div>

      {/* ---------------- LTM multiples ---------------- */}
      <h4 className="cp-h">LTM trading multiples</h4>
      <div className="tablewrap">
        <table className="fin cp-kv3">
          <thead><tr><th /><th>Multiple</th><th>LTM metric</th></tr></thead>
          <tbody>
            {[
              ['EV / Sales', 'evSales', money],
              ['EV / EBITDA', 'evEbitda', money],
              ['EV / EBIT', 'evEbit', money],
              ['P / E', 'pe', px],
              ['P / FCF', 'pFcf', px],
            ].map(([label, mk, fmt]) => (
              <tr key={mk}>
                <td>{label}</td>
                <td className="calc">{x(ltmOf(page.multiples?.[mk]))}</td>
                <td className="calc">{fmt(ltmMetric(page.multiples?.[mk]))}</td>
              </tr>
            ))}
            <tr><td>FCF yield</td><td className="calc">{pct(ltmOf(page.multiples?.fcfYield))}</td><td /></tr>
          </tbody>
        </table>
      </div>

      {/* ---------------- ratios ---------------- */}
      <div className="cp-grid2">
        <div>
          <h4 className="cp-h">LTM return on investment</h4>
          <table className="fin cp-kv"><tbody>
            <tr><td>Return on invested capital</td><td className="calc">{pct(page.roic)}</td></tr>
            <tr><td>Return on equity</td><td className="calc">{pct(page.roe)}</td></tr>
            <tr><td>Return on assets</td><td className="calc">{pct(page.roa)}</td></tr>
            <tr><td>Implied annual dividend yield</td><td className="calc">{pct(page.dividendYield)}</td></tr>
          </tbody></table>
          <h4 className="cp-h">Growth rates</h4>
          <table className="fin cp-kv4">
            <thead><tr><th /><th>Sales</th><th>EBITDA</th><th>FCF/sh.</th><th>EPS</th></tr></thead>
            <tbody>
              {[['Historical 1-year', 'hist1'], ['Historical 2-year CAGR', 'hist2']].map(([lab, k]) => (
                <tr key={k}><td>{lab}</td>{['sales', 'ebitda', 'fcf', 'eps'].map((g) => <td key={g} className="calc">{pct(page.growth?.[g]?.[k])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h4 className="cp-h">LTM credit statistics</h4>
          <table className="fin cp-kv"><tbody>
            <tr><td>Debt / total capitalization</td><td className="calc">{pct(page.credit.debtToTotalCap)}</td></tr>
            <tr><td>Total debt / EBITDA</td><td className="calc">{x(page.credit.debtToEbitda)}</td></tr>
            <tr><td>Net debt / EBITDA</td><td className="calc">{x(page.credit.netDebtToEbitda)}</td></tr>
            <tr><td>EBITDA / interest expense</td><td className="calc">{x(page.credit.ebitdaToInterest)}</td></tr>
            <tr><td>(EBITDA − capex) / interest</td><td className="calc">{x(page.credit.ebitdaLessCapexToInterest)}</td></tr>
            <tr><td>EBIT / interest expense</td><td className="calc">{x(page.credit.ebitToInterest)}</td></tr>
          </tbody></table>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import PerYearGrid from './PerYearGrid.jsx';
import { PeerSearchAdd, PeerRowFetch, mergePeerRow } from './PeerYahoo.jsx';
import { blankCompany, computeCompany, validateCompany } from '../lib/engine/compsCo.js';
import CompanyPageEditor from './CompanyPageEditor.jsx';
import PasteDialog from './PasteDialog.jsx';
import { buildPerYearGrid } from '../lib/engine/drivers.js';
import { MIN_YEARS, MAX_YEARS } from '../lib/driverEdit.js';
import { mergeAssumptions } from '../lib/defaults.js';
import { blankDeal } from '../lib/engine/precedentDeal.js';

const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);

function deepSet(obj, path, value) {
  const keys = path.split('.');
  const next = { ...obj };
  let cur = next;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = Array.isArray(cur[keys[i]]) ? cur[keys[i]].slice() : { ...cur[keys[i]] };
    cur = cur[keys[i]];
  }
  const last = keys[keys.length - 1];
  // functional updates read the CURRENT value — required for async writers
  cur[last] = typeof value === 'function' ? value(cur[last]) : value;
  return next;
}

const resizeArr = (arr, n) => {
  const out = arr.slice(0, n);
  while (out.length < n) out.push(out[out.length - 1] ?? 0);
  return out;
};
const clampYears = (v) => {
  const n = Math.round(v);
  return isFinite(n) ? Math.min(MAX_YEARS, Math.max(MIN_YEARS, n)) : 5;
};

/** Field spec: [path, label, type] — type undefined = number, 'text', 'check', or ['value|Label', …] select. */
const SECTIONS = [
  {
    key: 'company',
    title: 'Company & Market',
    fields: [
      ['company.name', 'Company name', 'text'],
      ['company.sharesOut', 'Shares outstanding'],
      ['company.currentPrice', 'Current share price'],
      ['company.grossDebt', 'Gross debt'],
      ['company.cash', 'Cash & equivalents'],
      ['company.taxRate', 'Tax rate %'],
    ],
  },
  {
    key: 'drivers',
    title: 'Operating drivers',
    note: 'These power every model. When the per-year grid below is on, the growth/margin fades and % lines are ignored — the grid wins.',
    fields: [
      ['drivers.revenue0', 'Base-year (LTM) revenue'],
      ['drivers.years', 'Projection years (3–15)'],
      ['drivers.growthStart', 'Revenue growth — Year 1 %'],
      ['drivers.growthEnd', 'Revenue growth — final year %'],
      ['drivers.marginStart', 'EBITDA margin — Year 1 %'],
      ['drivers.marginEnd', 'EBITDA margin — final year %'],
      ['drivers.daPct', 'D&A (% of revenue)'],
      ['drivers.capexPct', 'Capex (% of revenue)'],
      ['drivers.nwcPct', 'NWC (% of revenue)'],
    ],
  },
  {
    key: 'wacc',
    title: 'Cost of capital (WACC)',
    fields: [
      ['wacc.riskFree', 'Risk-free rate %'],
      ['wacc.erp', 'Equity risk premium %'],
      ['wacc.betaMode', 'Beta mode', ['hamada|Hamada relever', 'direct|Direct levered β']],
      ['wacc.unleveredBeta', 'Unlevered (asset) β'],
      ['wacc.beta', 'Levered β (direct mode)'],
      ['wacc.sizePremium', 'Size / alpha premium %'],
      ['wacc.costDebt', 'Pre-tax cost of debt %'],
      ['wacc.debtWeight', 'Debt weight D/(D+E) %'],
    ],
  },
  {
    key: 'dcf',
    title: 'DCF',
    fields: [
      ['dcf.terminalGrowth', 'Terminal growth %'],
      ['dcf.exitMultiple', 'Exit EV/EBITDA (terminal)'],
      ['dcf.exitPE', 'Exit P/E (FCFE terminal)'],
      ['dcf.primaryTV', 'Primary terminal value', ['gordon|Gordon growth', 'exit|Exit multiple']],
      ['dcf.midYear', 'Mid-year convention', 'check'],
    ],
  },
  {
    key: 'ts',
    title: '3-Statement',
    fields: [
      ['ts.interestRateDebt', 'Interest rate on debt %'],
      ['ts.interestRateCash', 'Interest earned on cash %'],
      ['ts.debtRepayPct', 'Mandatory debt repayment %'],
      ['ts.dividendPayout', 'Dividend payout %'],
      ['ts.startingPPE', 'Opening net PP&E'],
    ],
  },
  {
    key: 'lbo',
    title: 'LBO',
    fields: [
      ['lbo.entryMultiple', 'Entry EV/EBITDA ×'],
      ['lbo.exitMultiple', 'Exit EV/EBITDA ×'],
      ['lbo.exitYear', 'Exit year'],
      ['lbo.seniorX', 'Senior debt (× EBITDA)'],
      ['lbo.seniorRate', 'Senior interest rate %'],
      ['lbo.seniorAmort', 'Senior amortization % p.a.'],
      ['lbo.mezzX', 'Mezzanine (× EBITDA)'],
      ['lbo.mezzRate', 'Mezzanine rate %'],
      ['lbo.mezzPIK', 'Mezzanine is PIK', 'check'],
      ['lbo.sweepPct', 'Cash sweep %'],
      ['lbo.minCash', 'Minimum operating cash'],
      ['lbo.feesPctEV', 'Transaction fees (% of EV)'],
      ['lbo.finFeesPct', 'Financing fees (% of debt)'],
      ['lbo.hurdleRate', 'IRR hurdle (floor pricing) %'],
    ],
  },
  {
    key: 'ipo',
    title: 'IPO',
    fields: [
      ['ipo.basis', 'Pricing basis', ['pe|P/E on NTM net income', 'evEbitda|EV/EBITDA on NTM EBITDA']],
      ['ipo.offerPE', 'Offer P/E ×'],
      ['ipo.offerEvEbitda', 'Offer EV/EBITDA ×'],
      ['ipo.ipoDiscount', 'IPO discount %'],
      ['ipo.primaryRaise', 'Primary raise'],
      ['ipo.secondaryPct', 'Secondary sale %'],
      ['ipo.greenshoePct', 'Greenshoe %'],
      ['ipo.feesPct', 'Underwriting fees %'],
      ['ipo.useProceedsDebtPct', 'Proceeds to debt repay %'],
      ['ipo.rangeBand', 'Range band %'],
    ],
  },
];

/** Which sections + row editors each method tab shows — exactly what that
 *  method's engine consumes, nothing extra. */
const METHOD_TABS = [
  { id: 'dcf', label: 'DCF', secs: ['company', 'drivers', 'wacc', 'dcf'] },
  { id: 'ts', label: '3-Stmt', secs: ['company', 'drivers', 'ts'] },
  { id: 'lbo', label: 'LBO', secs: ['company', 'drivers', 'lbo'] },
  { id: 'comps', label: 'Comps', secs: ['company', 'drivers'], rows: ['peers'] },
  { id: 'reg', label: 'Regression', secs: ['company', 'drivers'], rows: ['peersExt'] },
  { id: 'prec', label: 'Precedent', secs: ['company', 'drivers'], rows: ['deals'] },
  { id: 'ipo', label: 'IPO', secs: ['company', 'drivers', 'ts', 'ipo'] },
  { id: 'all', label: 'All', secs: ['company', 'drivers', 'wacc', 'dcf', 'ts', 'lbo', 'ipo'], rows: ['peersExt', 'deals'] },
];

// Peer identity only — every multiple, margin and ratio is computed from the
// company's input page (Comps tab → Input pages), never typed here.
const PEER_COLS = [
  { key: 'name', label: 'Peer', type: 'text' },
  { key: 'ticker', label: 'Ticker', type: 'text' },
  { key: 'exchange', label: 'Exchange', type: 'text' },
];
// Precedent deals are now full input pages (acquirer, target, offer terms and
// the target's reported financials), edited on the Precedent tab — the flat
// row editor could only ever carry the identity fields.
const DEAL_COLS = [
  { key: 'acquirer', label: 'Acquirer', type: 'text' },
  { key: 'dateAnnounced', label: 'Date announced', type: 'text' },
  { key: 'transactionType', label: 'Transaction type', type: 'text' },
  { key: 'cashOffer', label: 'Cash offer / share' },
];

/** Blanks/invalid numbers fall back to the live model; years clamped and per-year arrays resized. */
function sanitize(draft, fallback) {
  let out = draft;
  for (const sec of SECTIONS) {
    for (const [path, , type] of sec.fields) {
      if (type === 'text' || type === 'check' || Array.isArray(type)) continue;
      const v = get(out, path);
      if (typeof v !== 'number' || !isFinite(v)) out = deepSet(out, path, get(fallback, path));
    }
  }
  const y = clampYears(get(out, 'drivers.years'));
  out = deepSet(out, 'drivers.years', y);
  const d = out.drivers;
  if (d.perYear) {
    out = deepSet(out, 'drivers.perYear', {
      ...d.perYear,
      revenue: resizeArr(d.perYear.revenue, y),
      ebitda: resizeArr(d.perYear.ebitda, y),
      da: resizeArr(d.perYear.da, y),
      capex: resizeArr(d.perYear.capex, y),
      nwc: resizeArr(d.perYear.nwc, y),
    });
  }
  if (d.growthCustom) out = deepSet(out, 'drivers.growthCustom', resizeArr(d.growthCustom, y));
  if (d.marginCustom) out = deepSet(out, 'drivers.marginCustom', resizeArr(d.marginCustom, y));
  const numRow = (r, keys) => {
    const o = { ...r };
    for (const k of keys) {
      const n = parseFloat(o[k]);
      o[k] = isFinite(n) ? n : 0;
    }
    return o;
  };
  // base multiples default to 0; extended regression variables stay blank (NaN)
  out = deepSet(out, 'precedent.deals', out.precedent.deals.map((r) => numRow(r, ['cashOffer', 'exchangeRatio', 'acquirerPrice'])));
  out = deepSet(out, 'lbo.exitYear', Math.round(Math.min(y, Math.max(1, out.lbo.exitYear))));
  return out;
}

function Field({ draft, onSet, def }) {
  const [path, label, type] = def;
  const v = get(draft, path);
  if (type === 'check') {
    return (
      <label className="bfield bcheck">
        <input type="checkbox" checked={!!v} onChange={(e) => onSet(path, e.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }
  if (Array.isArray(type)) {
    return (
      <label className="bfield">
        <span>{label}</span>
        <select value={v} onChange={(e) => onSet(path, e.target.value)}>
          {type.map((o) => {
            const [val, lbl] = o.split('|');
            return <option key={val} value={val}>{lbl}</option>;
          })}
        </select>
      </label>
    );
  }
  if (type === 'text') {
    return (
      <label className="bfield">
        <span>{label}</span>
        <input type="text" value={v ?? ''} onChange={(e) => onSet(path, e.target.value)} />
      </label>
    );
  }
  return (
    <label className="bfield">
      <span>{label}</span>
      <input
        type="number"
        step="any"
        value={v === '' || v == null || (typeof v === 'number' && !isFinite(v)) ? '' : v}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          onSet(path, e.target.value !== '' && isFinite(n) ? n : '');
        }}
      />
    </label>
  );
}

function RowsEditor({ rows, cols, onChange, blank, rowAction }) {
  const setCell = (i, key, val) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  return (
    <div>
      <table className="peers">
        <thead>
          <tr>
            {cols.map((c) => <th key={c.key}>{c.label}</th>)}
            <th colSpan={rowAction ? 2 : 1} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key}>
                  <input
                    className={c.type === 'text' ? 'pname' : ''}
                    type={c.type === 'text' ? 'text' : 'number'}
                    step="any"
                    value={c.type === 'text' ? (r[c.key] ?? '') : (typeof r[c.key] === 'number' && isFinite(r[c.key]) ? r[c.key] : '')}
                    onChange={(e) =>
                      setCell(i, c.key, c.type === 'text' ? e.target.value : e.target.value === '' ? '' : parseFloat(e.target.value))
                    }
                  />
                </td>
              ))}
              {rowAction && <td>{rowAction(r, i)}</td>}
              <td>
                <button className="peer-del" title="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="pyfill" style={{ marginTop: 6 }} onClick={() => onChange([...rows, { ...blank }])}>+ Add row</button>
    </div>
  );
}

/**
 * Method-scoped data entry: opens on the active view's inputs (switch methods
 * with the tabs, or All for everything), with the per-year grid, Yahoo peer
 * fetch, and a JSON view for copy/save/paste-apply in one go.
 */
export default function DataEntry({ a, onApply, onClose, initialMethod = 'all' }) {
  const [draft, setDraft] = useState(a);
  const [view, setView] = useState('form');
  const [method, setMethod] = useState(() => (METHOD_TABS.some((t) => t.id === initialMethod) ? initialMethod : 'all'));
  const [jsonText, setJsonText] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [editPeer, setEditPeer] = useState(null);   // peer whose input page is open
  const [pastePeers, setPastePeers] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onSet = (path, v) => setDraft((prev) => deepSet(prev, path, v));

  const gridOn = !!draft.drivers.perYear;
  const toggleGrid = (on) =>
    setDraft((prev) => ({
      ...prev,
      drivers: {
        ...prev.drivers,
        years: clampYears(prev.drivers.years),
        perYear: on ? buildPerYearGrid({ ...prev.drivers, years: clampYears(prev.drivers.years) }) : null,
        growthCustom: null,
        marginCustom: null,
      },
    }));

  const switchView = (v) => {
    if (v === 'json') {
      const s = sanitize(draft, a);
      setDraft(s);
      setJsonText(JSON.stringify(s, null, 2));
    }
    setErr('');
    setView(v);
  };

  const apply = () => {
    if (view === 'form') {
      onApply(sanitize(draft, a));
      return;
    }
    try {
      const parsed = JSON.parse(jsonText);
      onApply(sanitize(mergeAssumptions(parsed), a));
    } catch (e) {
      setErr(`Invalid JSON — nothing applied. ${e.message}`);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const tab = METHOD_TABS.find((t) => t.id === method) || METHOD_TABS[METHOD_TABS.length - 1];
  const secs = SECTIONS.filter((sec) => tab.secs.includes(sec.key));
  const showRows = (k) => (tab.rows || []).includes(k);

  return (
    <div className="bulk-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bulk-modal">
        <div className="bulk-head">
          <h2>Enter data — {tab.label === 'All' ? 'full model' : tab.label}</h2>
          <div className="sub">Only the fields this method uses. Nothing changes until you Apply.</div>
          <div style={{ flex: 1 }} />
          <div className="seg" style={{ margin: 0 }}>
            <button className={view === 'form' ? 'on' : ''} onClick={() => switchView('form')}>Form</button>
            <button className={view === 'json' ? 'on' : ''} onClick={() => switchView('json')}>JSON (copy / paste)</button>
          </div>
          <button className="btn ghost" onClick={onClose} style={{ fontSize: 16, padding: '4px 10px' }}>✕</button>
        </div>

        {view === 'form' && (
          <div className="seg entry-methods" style={{ marginTop: 0 }}>
            {METHOD_TABS.map((t) => (
              <button key={t.id} className={method === t.id ? 'on' : ''} onClick={() => setMethod(t.id)}>{t.label}</button>
            ))}
          </div>
        )}

        {view === 'form' ? (
          <>
            {secs.map((sec) => (
              <div className="bulk-sec" key={sec.key}>
                <h4>{sec.title}</h4>
                {sec.note && <div className="sec-note">{sec.note}</div>}
                <div className="bulk-grid">
                  {sec.fields.map((f) => <Field key={f[0]} def={f} draft={draft} onSet={onSet} />)}
                </div>
                {sec.key === 'drivers' && (
                  <div style={{ marginTop: 12 }}>
                    <label className="toggle">
                      <input type="checkbox" checked={gridOn} onChange={(e) => toggleGrid(e.target.checked)} />
                      Enter each year's data (grid) — paste a row straight from Excel/Sheets
                    </label>
                    {gridOn && (
                      <PerYearGrid
                        grid={draft.drivers.perYear}
                        years={clampYears(draft.drivers.years)}
                        onChange={(g) => onSet('drivers.perYear', g)}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
            {(showRows('peers') || showRows('peersExt')) && (
              <div className="bulk-sec">
                <h4>Comparable companies</h4>
                <div className="sec-note">
                  Three ways in: <b>search</b> a listed company and pull what the feed reports, <b>paste</b> a table
                  straight out of Excel, or <b>type</b> a page in full — the route for private companies, which have no
                  ticker and no feed. All three land in the same input page, so you can fetch and then finish by hand.
                </div>

                <div className="peer-entry">
                  <div className="peer-entry-rail">
                    <div className="peer-entry-h">Peers ({draft.comps.peers.length})</div>
                    {draft.comps.peers.map((p) => {
                      const bad = validateCompany(computeCompany(p)).some((i) => i.level === 'error');
                      return (
                        <button
                          key={p.id}
                          className={`cp-pick${editPeer === p.id ? ' on' : ''}`}
                          onClick={() => setEditPeer(editPeer === p.id ? null : p.id)}
                        >
                          {p.name || 'Unnamed'}
                          {bad && <span className="peer-dot" title="Has errors" />}
                        </button>
                      );
                    })}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      <button className="btn sm" onClick={() => {
                        const co = blankCompany({ name: `Peer ${draft.comps.peers.length + 1}`, tierId: draft.comps.tiers?.[0]?.id ?? null });
                        onSet('comps.peers', (rows) => [...rows, co]);
                        setEditPeer(co.id);
                      }}>+ Private company</button>
                      <button className="btn sm" onClick={() => setPastePeers(true)}>Paste table</button>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <PeerSearchAdd onAdd={(m) => onSet('comps.peers', (rows) => [...rows, mergePeerRow(blankCompany({ name: '' }), m, draft.settings)])} />
                    </div>
                  </div>

                  <div className="peer-entry-body">
                    {editPeer && draft.comps.peers.find((p) => p.id === editPeer) ? (
                      <CompanyPageEditor
                        co={draft.comps.peers.find((p) => p.id === editPeer)}
                        settings={draft.settings}
                        tiers={draft.comps.tiers || []}
                        onChange={(next) => onSet('comps.peers', (rows) => rows.map((r) => (r.id === next.id ? next : r)))}
                        onDelete={() => {
                          onSet('comps.peers', (rows) => rows.filter((r) => r.id !== editPeer));
                          setEditPeer(null);
                        }}
                      />
                    ) : (
                      <div className="sec-note" style={{ padding: 20 }}>
                        Pick a peer on the left to enter its financials, or add a private company. This is the same input
                        page as the Comps tab — edit it in either place.
                      </div>
                    )}
                  </div>
                </div>

                {pastePeers && (
                  <PasteDialog
                    mode="wide"
                    tiers={draft.comps.tiers || []}
                    onApply={(rows) => onSet('comps.peers', (prev) => [...prev, ...rows])}
                    onClose={() => setPastePeers(false)}
                  />
                )}
              </div>
            )}
            {showRows('deals') && (
              <div className="bulk-sec">
                <h4>Precedent transactions</h4>
                <div className="sec-note">
                  Deal terms and premia come from announcements and merger proxies — there's no public feed, so these
                  stay hand-entered. Identity and the cash offer are editable here; the target's reported financials,
                  the exchange ratio and the unaffected prices live on each deal's input page in the Precedent tab.
                </div>
                <RowsEditor
                  rows={draft.precedent.deals}
                  cols={DEAL_COLS}
                  blank={blankDeal()}
                  onChange={(rows) => onSet('precedent.deals', rows)}
                />
              </div>
            )}
          </>
        ) : (
          <div className="bulk-sec">
            <div className="sec-note">
              The whole model as one JSON block. Copy it to save or share a data set; edit numbers directly; or paste a
              previously saved block and Apply. Unknown fields are ignored, missing ones keep their current values.
            </div>
            <textarea
              className="bjson"
              spellCheck={false}
              value={jsonText}
              onChange={(e) => { setJsonText(e.target.value); setErr(''); }}
            />
          </div>
        )}

        <div className="bulk-foot">
          {view === 'json' && <button className="btn" onClick={copy}>{copied ? '✓ Copied' : 'Copy JSON'}</button>}
          <span className="berr">{err}</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={apply}>Apply to model</button>
        </div>
      </div>
    </div>
  );
}

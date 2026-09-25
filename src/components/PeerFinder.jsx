import React, { useState } from 'react';
import { findPeers, WEIGHTS, times } from '../lib/peerFinder.js';
import { UNIT_FACTOR } from '../lib/yahoo.js';
import { fmtMoney, fmtPct } from '../lib/format.js';

const SIGNAL_LABEL = { industry: 'Industry', market: 'Market', size: 'Size', margin: 'EBITDA margin', growth: 'Growth' };
const FROM_LABEL = { inputs: 'your inputs', seed: 'the seed listing' };
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const pctOrNA = (x) => (fin(x) ? fmtPct(x * 100, 1) : 'NA');
const FIG_LABEL = { revenue: 'revenue', marketCap: 'market cap', margin: 'margin', growth: 'growth' };
/** { revenue: 'inputs', margin: 'seed', … } → "from your inputs: revenue, margin; from the seed listing: growth" */
const sourceText = (from) => {
  const groups = ['inputs', 'seed'].map((src) => [src, Object.keys(FIG_LABEL).filter((k) => from[k] === src)]).filter(([, ks]) => ks.length);
  return groups.length ? groups.map(([src, ks]) => `from ${FROM_LABEL[src]}: ${ks.map((k) => FIG_LABEL[k]).join(', ')}`).join('; ') : 'no figures on either side';
};

/**
 * Peer finder panel (comps Peer step): ranks Yahoo candidates against the
 * target on industry, market, size, margin and growth (lib/peerFinder.js),
 * shows why for each, and hands the ticked symbols to `onFetch` — which runs
 * the normal peer fetch with its rate confirmation. Nothing here writes to
 * the model.
 */
export default function PeerFinder({ company, inputs, defaultSeed = '', exclude = [], onFetch, onClose }) {
  const [seed, setSeed] = useState(defaultSeed);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [res, setRes] = useState(null);
  const [ticked, setTicked] = useState(() => new Set());
  const [open, setOpen] = useState(null);
  const uf = UNIT_FACTOR[company.unit];

  const run = async () => {
    if (!seed.trim() || running) return;
    setRunning(true); setErr(''); setRes(null); setTicked(new Set()); setOpen(null); setProgress('');
    try {
      const out = await findPeers({
        seed: seed.trim(), inputs, currency: company.currency, unit: company.unit, exclude, onProgress: setProgress,
      });
      setRes(out);
      if (!out.candidates.length) setErr('Every co-watched name is already in the set, or none is a listed company.');
    } catch (e) {
      setErr(`${e?.message || 'Peer search failed'}${/Yahoo returned|fetch/i.test(e?.message || '') ? ' — the Yahoo proxy needs the dev server (npm run dev).' : ''}`);
    } finally {
      setRunning(false); setProgress('');
    }
  };

  const toggle = (sym) => setTicked((t) => {
    const n = new Set(t);
    if (n.has(sym)) n.delete(sym); else n.add(sym);
    return n;
  });
  const tickTop = (k) => setTicked(new Set(res.candidates.slice(0, k).map((c) => c.symbol)));
  const money = (v) => (fin(v) && fin(uf) ? fmtMoney(v / uf, company, 0) : 'NA');
  const ref = res?.ref;

  return (
    <div className="peer-finder">
      <div className="pf-head">
        <div className="tool-h" style={{ margin: 0 }}>Find peers</div>
        <button className="peer-del" title="Close the peer finder" onClick={onClose}>×</button>
      </div>
      <div className="yf-search">
        <input
          value={seed} placeholder="Target ticker — or a close listed competitor if the target is private"
          onChange={(e) => { setSeed(e.target.value); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }}
        />
        <button className="btn" onClick={run} disabled={running || !seed.trim()}>{running ? 'Searching…' : 'Find'}</button>
      </div>
      {running && <div className="fld-h pf-progress">{progress || 'Starting…'}</div>}
      {err && <div className="fld-e" style={{ marginTop: 6 }}>{err}</div>}

      {res && ref && (
        <>
          <div className="pf-ref">
            <b>Compared with {ref.name || ref.symbol}</b> ({ref.symbol}) · {ref.industry || 'industry not reported'}
            {ref.sector ? ` · ${ref.sector}` : ''} · {ref.exchange || 'exchange NA'}
            <div className="fld-h">
              Size {fin(ref.marketCap) ? `market cap ${money(ref.marketCap)}` : `revenue ${money(ref.revenue)}`} ·
              EBITDA margin {pctOrNA(ref.margin)}{ref.marginLabel ? ` (${ref.marginLabel})` : ''} · revenue growth {pctOrNA(ref.growth)} —
              {' '}{sourceText(ref.from)}.
            </div>
          </div>

          {res.candidates.length > 0 && (
            <div className="tablewrap pf-table">
              <table className="fin">
                <thead>
                  <tr>
                    <th>Company</th><th>Score</th><th>Industry · exchange</th><th title="Candidate ÷ target: market cap, or revenue when a market cap is missing">Size ÷ target</th><th title="EBITDA margin (LTM, or the latest fiscal year when LTM EBITDA is not reported)">Margin</th><th title="Revenue growth, last fiscal year">Growth</th>
                  </tr>
                </thead>
                <tbody>
                  {res.candidates.map((c) => {
                    const size = fin(c.sizeRatio) ? `${times(c.sizeRatio)}${c.sizeBasis === 'revenue' ? ' rev.' : ''}` : 'NA';
                    const isOpen = open === c.symbol;
                    return (
                      <React.Fragment key={c.symbol}>
                        <tr className={`pf-row${ticked.has(c.symbol) ? ' on' : ''}`}>
                          <td>
                            <label className="pf-pick">
                              <input type="checkbox" checked={ticked.has(c.symbol)} onChange={() => toggle(c.symbol)} />
                              <span>{c.name}<small>{c.symbol}</small></span>
                            </label>
                          </td>
                          <td>
                            <button className="pf-score" onClick={() => setOpen(isOpen ? null : c.symbol)} title="Why this score">
                              <span className={`pf-badge ${c.score === null ? 'na' : c.score >= 70 ? 'hi' : c.score >= 40 ? 'mid' : 'lo'}`}>{c.score ?? 'NA'}</span>
                              <small>{c.coverage}/5 {isOpen ? '▾' : '▸'}</small>
                            </button>
                          </td>
                          <td className="pf-txt">{c.industry || 'Industry NA'}<small>{c.exchange || 'exchange NA'}</small></td>
                          <td>{size}</td>
                          <td>{pctOrNA(c.snap?.margin)}</td>
                          <td>{pctOrNA(c.snap?.growth)}</td>
                        </tr>
                        {isOpen && (
                          <tr className="pf-why">
                            <td colSpan={6}>
                              {c.parts.map((p) => (
                                <div key={p.key} className={p.pts === null ? 'na' : ''}>
                                  <b>{SIGNAL_LABEL[p.key]}</b>
                                  <span>{p.pts === null ? `NA · not scored (of ${WEIGHTS[p.key]})` : `${p.pts.toFixed(1)} of ${p.max}`}</span>
                                  {p.text}
                                </div>
                              ))}
                              {c.snap && (
                                <div className="na">
                                  <b>Figures</b><span />
                                  Market cap {money(c.marketCapV)} · LTM revenue {money(c.revenueV)}{c.snap.ltmLabel ? ` (${c.snap.ltmLabel})` : ''}
                                  {c.snap.growthLabel ? ` · growth ${c.snap.growthLabel}` : ''}
                                  {c.snap.adr ? ` · priced in ${c.snap.priceCurrency}, reports in ${c.snap.financialCurrency}: likely a depositary receipt, so size uses revenue` : ''}
                                </div>
                              )}
                              {c.snap === null && <div className="na"><b>Figures</b><span />Yahoo returned no figures for this listing — only its profile is scored.</div>}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="row-btns pf-actions">
            <button className="btn sm" onClick={() => tickTop(5)} disabled={!res.candidates.length}>Tick top 5</button>
            <button className="btn sm ghost" onClick={() => setTicked(new Set())} disabled={!ticked.size}>Clear ticks</button>
            <button className="btn sm primary" disabled={!ticked.size} onClick={() => onFetch(res.candidates.filter((c) => ticked.has(c.symbol)).map((c) => c.symbol))}>
              Fetch ticked ({ticked.size})
            </button>
          </div>
          <div className="fld-h">
            {res.screened} listed candidates screened{res.dropped ? ` (${res.dropped} dropped: funds, indices or no Yahoo profile)` : ''}; the best {res.compared} by
            profile compared on figures. Score = points ÷ points available, out of 100: industry {WEIGHTS.industry}, market {WEIGHTS.market},
            size {WEIGHTS.size}, margin {WEIGHTS.margin}, growth {WEIGHTS.growth}. A signal either side lacks is NA and not scored — check
            the coverage (x/5) beside each score. Foreign sizes use live FX for this ranking only; ticked peers are fetched and converted at the rates you confirm.
          </div>
        </>
      )}
    </div>
  );
}

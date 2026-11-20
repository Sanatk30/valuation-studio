import React, { useState } from 'react';
import { findPeers, WEIGHTS, GROUP_LABEL, MIN_SIZE_RATIO, times, resultStale } from '../lib/peerFinder.js';
import { UNIT_FACTOR } from '../lib/yahoo.js';
import { fmtMoney, fmtPct } from '../lib/format.js';
import { YF_HINT } from '../lib/yfBase.js';

const SIGNAL_LABEL = { market: 'Market', size: 'Size', margin: 'EBITDA margin', growth: 'Growth' };
const N_SIGNALS = Object.keys(WEIGHTS).length;
const GROUP_NOTE = {
  1: 'Yahoo classifies these in the same industry as the target — the comparable set.',
  2: 'Same sector, other industry: related businesses, not direct peers. Tick one only if you know it competes.',
  0: 'Yahoo reports no industry for these (or for the target), so they cannot be grouped.',
};
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
 * Peer finder panel (comps Peer step): candidates from Yahoo (co-watched
 * names, an industry crawl and an industry search — lib/peerFinder.js),
 * grouped by Yahoo's own industry classification. Same-industry names are
 * ranked by fit (size, margin, growth, market) with the reason for each;
 * same-sector names sit in their own section, closed; other sectors and
 * names under 1% of the target's size are only listed. The ticked symbols go
 * to `onFetch`, which runs the normal peer fetch with its rate confirmation.
 * Nothing here writes to the model.
 */
export default function PeerFinder({ company, inputs, defaultSeed = '', exclude = [], onFetch, onClose }) {
  const [seed, setSeed] = useState(defaultSeed);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [res, setRes] = useState(null);
  const [ticked, setTicked] = useState(() => new Set());
  const [open, setOpen] = useState(null);
  const [shown, setShown] = useState(() => new Set([1]));   // groups whose rows are shown
  const uf = UNIT_FACTOR[company.unit];

  const run = async () => {
    if (!seed.trim() || running) return;
    setRunning(true); setErr(''); setRes(null); setTicked(new Set()); setOpen(null); setProgress(''); setShown(new Set([1]));
    try {
      const out = await findPeers({
        seed: seed.trim(), inputs, currency: company.currency, unit: company.unit, exclude, onProgress: setProgress,
      });
      setRes(out);
      if (!out.candidates.length) setErr('No listed company in the target’s industry or sector was found that is not already in the set — add peers by ticker.');
      else if (!out.candidates.some((c) => c.group === 1)) setShown(new Set([1, 2, 0]));
    } catch (e) {
      setErr(`${e?.message || 'Peer search failed'}${/Yahoo returned|fetch/i.test(e?.message || '') ? ` — ${YF_HINT}.` : ''}`);
    } finally {
      setRunning(false); setProgress('');
    }
  };

  const toggle = (sym) => setTicked((t) => {
    const n = new Set(t);
    if (n.has(sym)) n.delete(sym); else n.add(sym);
    return n;
  });
  const sameInd = res ? res.candidates.filter((c) => c.group === 1) : [];
  const tickTop = (k) => setTicked(new Set(sameInd.slice(0, k).map((c) => c.symbol)));
  const toggleGroup = (g) => setShown((s0) => { const n = new Set(s0); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const groups = res ? [1, 2, 0].map((g) => ({ g, rows: res.candidates.filter((c) => c.group === g) })).filter((x) => x.rows.length) : [];
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

      {resultStale(res, company.currency) && (
        <div className="fld-e" style={{ marginTop: 6 }}>
          The valuation currency changed to {company.currency} after this search (its sizes and FX were in {res.currency}) — press Find to rank again.
        </div>
      )}
      {res && ref && !resultStale(res, company.currency) && (
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
                    <th>Company</th><th title="Fit inside the group: size, EBITDA margin, growth and market">Fit</th><th>Industry · exchange</th><th title="Candidate ÷ target: market cap, or revenue when a market cap is missing">Size ÷ target</th><th title="EBITDA margin (LTM, or the latest fiscal year when LTM EBITDA is not reported)">Margin</th><th title="Revenue growth, last fiscal year">Growth</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(({ g, rows }) => (
                  <React.Fragment key={g}>
                  <tr className="pf-group">
                    <td colSpan={6}>
                      <button className="pf-group-btn" onClick={() => toggleGroup(g)} aria-expanded={shown.has(g)}>
                        {shown.has(g) ? '▾' : '▸'} {GROUP_LABEL[g]} — {rows.length}
                      </button>
                      <small>{GROUP_NOTE[g]}</small>
                    </td>
                  </tr>
                  {shown.has(g) && rows.map((c) => {
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
                            <button className="pf-score" onClick={() => setOpen(isOpen ? null : c.symbol)} title="Why this fit">
                              <span className={`pf-badge ${c.score === null ? 'na' : c.score >= 70 ? 'hi' : c.score >= 40 ? 'mid' : 'lo'}`}>{c.score ?? 'NA'}</span>
                              <small>{c.coverage}/{N_SIGNALS} {isOpen ? '▾' : '▸'}</small>
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
                              {c.sources?.length > 0 && <div className="na"><b>Found via</b><span />{c.sources.join(', ')}{fin(c.popularity) ? ` · Yahoo popularity ${Math.round(c.popularity).toLocaleString('en-US')}` : ''}</div>}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {res.tooSmall?.length > 0 && (
            <div className="fld-h pf-list">
              <b>Too small to compare</b> (under {Math.round(MIN_SIZE_RATIO * 100)}% of the target’s size): {res.tooSmall.map((c) => `${c.name} (${c.symbol}, ${times(c.sizeRatio)})`).join(' · ')}
            </div>
          )}
          {res.others?.length > 0 && (
            <div className="fld-h pf-list">
              <b>Other sectors, left out</b> — co-watched on Yahoo but in another sector: {res.others.slice(0, 40).map((c) => `${c.name} (${c.industry || c.sector || 'NA'})`).join(' · ')}{res.others.length > 40 ? ` · and ${res.others.length - 40} more` : ''}
            </div>
          )}

          <div className="row-btns pf-actions">
            <button className="btn sm" onClick={() => tickTop(5)} disabled={!sameInd.length} title="The five best fits in the target's industry">Tick top 5 in the industry</button>
            <button className="btn sm ghost" onClick={() => setTicked(new Set())} disabled={!ticked.size}>Clear ticks</button>
            <button className="btn sm primary" disabled={!ticked.size} onClick={() => onFetch(res.candidates.filter((c) => ticked.has(c.symbol)).map((c) => c.symbol))}>
              Fetch ticked ({ticked.size})
            </button>
          </div>
          <div className="fld-h">
            {res.screened} listed companies found ({Object.entries(res.sources || {}).map(([k, v]) => `${v} ${k}`).join(', ')}){res.dropped ? `; ${res.dropped} dropped (funds, indices or no Yahoo profile)` : ''}.
            A company listed on several exchanges is shown once. Peers are grouped by Yahoo’s industry classification; inside a group
            the fit = points ÷ points available, out of 100: size {WEIGHTS.size}, EBITDA margin {WEIGHTS.margin}, growth {WEIGHTS.growth},
            market {WEIGHTS.market}. A signal either side lacks is NA and not scored — check the coverage (x/{N_SIGNALS}) beside each fit.
            The {res.compared} closest by profile were compared on figures{res.notCompared ? ` (${res.notCompared} more in the industry or sector were not)` : ''}.
            Foreign sizes use live FX for this ranking only; ticked peers are fetched and converted at the rates you confirm.
          </div>
        </>
      )}
    </div>
  );
}

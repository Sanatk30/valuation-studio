import React from 'react';
import { fmtNum, fmtPct, fmtPrice, fmtX, CURRENCIES } from '../lib/format.js';

/**
 * A tiered benchmarking / output page: the target on top, then each tier with
 * its own Mean & Median, then an Overall Mean / Median / High / Low block.
 * Driven by the same column specs as the Excel export, so the two can't drift.
 */
export default function BenchmarkTable({ groups, comps, settings, onPick }) {
  const locale = CURRENCIES[settings.currency].locale;
  const cols = groups.flatMap((g) => g.cols);

  // NA = not available (no input); NM = not meaningful (a multiple on a
  // non-positive denominator). Only the trading-multiple columns can be NM.
  const fmt = (kind, v, nm) => {
    if (kind === 'text') return v || '—';
    if (kind === 'date') return v || '—';
    if (!isFinite(v)) return nm ? 'NM' : 'NA';
    if (kind === 'money') return fmtNum(v, 0, locale);
    if (kind === 'price') return fmtPrice(v, settings, 2);
    if (kind === 'pct') return fmtPct(v * 100, 1);
    if (kind === 'x') return fmtX(v, 2);
    return fmtNum(v, 2, locale);
  };

  const valueCells = (page) => cols.map((c, i) => (
    <td key={i} className={c.kind === 'text' || c.kind === 'date' ? 'txt' : ''}>{fmt(c.kind, c.get(page), c.nm)}</td>
  ));
  const statCells = (block, key) => cols.map((c, i) => (
    <td key={i}>{c.stat && block[c.key] ? fmt(c.kind, block[c.key][key], c.nm) : ''}</td>
  ));

  // which statistics block on the comps result this table reads
  const blockOf = (t) => (groups === comps.cols.bench1 ? t.bench1 : groups === comps.cols.bench2 ? t.bench2 : t.output);

  return (
    <div className="tablewrap bm">
      <table className="fin">
        <thead>
          <tr className="bm-groups">
            <th colSpan={2} />
            {groups.map((g, gi) => <th key={gi} colSpan={g.cols.length} className="bm-grp">{g.title}</th>)}
          </tr>
          <tr>
            <th>Company</th><th>Ticker</th>
            {cols.map((c, i) => <th key={i}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr className="bold bm-target">
            <td>{comps.targetPage.co.name}</td>
            <td className="txt">{comps.targetPage.co.ticker || '—'}</td>
            {valueCells(comps.targetPage)}
          </tr>

          {comps.tiers.filter((t) => t.pages.length).map((t) => (
            <React.Fragment key={t.id ?? 'none'}>
              <tr className="sechead"><td colSpan={2 + cols.length}>{t.name}</td></tr>
              {t.pages.map((p) => (
                <tr key={p.co.id} className={onPick ? 'clickable' : ''} onClick={onPick ? () => onPick(p.co.id) : undefined}>
                  <td>{p.co.name}</td>
                  <td className="txt">{p.co.ticker || '—'}</td>
                  {valueCells(p)}
                </tr>
              ))}
              <tr className="bold"><td colSpan={2}>Mean</td>{statCells(blockOf(t), 'mean')}</tr>
              <tr className="sub"><td colSpan={2}>Median</td>{statCells(blockOf(t), 'median')}</tr>
            </React.Fragment>
          ))}

          <tr className="sechead"><td colSpan={2 + cols.length}>Overall</td></tr>
          <tr className="bold"><td colSpan={2}>Mean</td>{statCells(blockOf(comps.overall), 'mean')}</tr>
          <tr className="bold"><td colSpan={2}>Median</td>{statCells(blockOf(comps.overall), 'median')}</tr>
          <tr className="sub"><td colSpan={2}>High</td>{statCells(blockOf(comps.overall), 'high')}</tr>
          <tr className="sub"><td colSpan={2}>Low</td>{statCells(blockOf(comps.overall), 'low')}</tr>
        </tbody>
      </table>
    </div>
  );
}

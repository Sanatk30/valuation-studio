import React, { useMemo } from 'react';
import { IS_LINES, BS_LINES, CF_LINES, computePage, fyValues, setCell } from '../lib/engine/companyPage.js';
import { CURRENCIES, UNITS, fmtTpl } from '../lib/format.js';
import { NumBox } from '../wizard/Field.jsx';
import { Roll } from '../lib/motion.jsx';

/**
 * The historical statements as three panels (the chosen DCF Company design,
 * option B): income statement on the left, balance sheet and cash flow on the
 * right; every input number editable in place, each line with its trend and
 * growth a year (CAGR) so a wrong number stands out.
 */
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

export function Spark({ data, w = 66, h = 20 }) {
  const v = data.map((x) => (fin(x) ? x : null));
  const a = v.filter((x) => x !== null);
  if (a.length < 2) return <span className="fa">—</span>;
  const mn = Math.min(...a), mx = Math.max(...a), n = v.length;
  const pts = v.map((x, i) => (x === null ? null : [2 + (i / (n - 1)) * (w - 4), h - 3 - ((x - mn) / (mx - mn || 1)) * (h - 6)])).filter(Boolean);
  const up = a[a.length - 1] >= a[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={`spk ${up ? 'up' : 'dn'}`} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.3" />
    </svg>
  );
}

export function cagr(vals) {
  const a = vals.filter(fin);
  if (a.length < 2 || !(a[0] > 0) || !(a[a.length - 1] > 0)) return null;
  return (Math.pow(a[a.length - 1] / a[0], 1 / (a.length - 1)) - 1) * 100;
}

export default function StatementPanels({ page, onChange, n, labels, toggle = 1, company, checkLine = true }) {
  const r = useMemo(() => computePage(page, { n, toggle, ytd: false, market: {}, inv: 0 }), [page, n, toggle]);
  const locale = CURRENCIES[company?.currency]?.locale || 'en-IN';
  const unit = `${CURRENCIES[company?.currency]?.symbol || ''} ${UNITS[company?.unit] || ''}`.trim();
  const set = (key, i, v) => onChange(setCell(page, key, i, v, n));
  const fmt = (line) => (line.kind === 'shares' || line.kind === 'pershare' ? 'n2' : 'n1');

  const panel = (title, lines) => (
    <div className="box2 stp">
      <div className="stp-h"><h3>{title}</h3><span className="fa">{unit}</span></div>
      <table className="stp-t">
        <thead><tr><th>{unit}</th>{labels.map((l) => <th key={l}>{l}</th>)}<th className="c">Trend</th><th>CAGR</th></tr></thead>
        <tbody>
          {lines.filter((l) => l.key !== 'totalIncome').map((line) => {
            if (line.head) return <tr key={`h${line.row}`} className="stp-g"><td colSpan={labels.length + 3}>{line.head}</td></tr>;
            const vals = (r.v[line.key] || []).slice(0, n);
            const bad = line.key === 'check' && vals.some((x) => fin(x) && Math.abs(x) > 0.5);
            const g = cagr(vals);
            return (
              <tr key={line.key} className={`${line.sub ? 'sub' : ''}${bad ? ' bad' : ''}`}>
                <td title={line.label}>{line.label}</td>
                {labels.map((_, i) => (
                  <td key={i} className={line.input ? 'in' : ''}>
                    {line.input ? <NumBox small value={fyValues(page?.lines?.[line.key], n)[i]} onChange={(v) => set(line.key, i, v)} /> : <Roll>{fmtTpl(vals[i], fmt(line), locale)}</Roll>}
                  </td>
                ))}
                <td className="c"><Spark data={vals} /></td>
                <td className={line.sub ? 'b' : ''}>{g === null ? '—' : `${g.toFixed(1)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {title === 'Balance sheet' && checkLine && (
        <div className="stp-chk">{r.v.check.slice(0, n).some((x) => fin(x) && Math.abs(x) > 0.5)
          ? <span className="dn">✕ Assets ≠ equity + liabilities in at least one year — see the Balance Check row</span>
          : <span className="up">✓ Assets = equity + liabilities, every year</span>}</div>
      )}
    </div>
  );

  return (
    <div className="g2b stp-wrap">
      {panel('Income statement', IS_LINES)}
      <div className="stp-col">
        {panel('Balance sheet', BS_LINES)}
        {panel('Cash flow', CF_LINES)}
      </div>
    </div>
  );
}

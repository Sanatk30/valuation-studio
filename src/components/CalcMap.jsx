import React, { useLayoutEffect, useRef, useState } from 'react';
import { Spark } from './StatementPanels.jsx';
import { CountUp } from '../lib/motion.jsx';

/**
 * A result drawn as a calculation map (the chosen DCF / IPO result design):
 * columns of boxes — inputs → working → value → the result — with lines
 * showing what feeds what. Input boxes open the step they come from.
 *   cols   — [{ title, groups: [{ name?, nodes: [{ id, label, value, sub, spark, input, warn, onClick }] }] }]
 *   result — { id, label, value, sub, rows: [[k, v]], action: { label, onClick } }
 *   edges  — [[fromId, toId, hot]]
 */
export default function CalcMap({ cols, result, edges, widths }) {
  const wrap = useRef(null);
  const [paths, setPaths] = useState([]);
  const sig = JSON.stringify([cols.map((c) => c.groups.map((g) => g.nodes.map((n) => [n.id, n.value]))), edges]);
  useLayoutEffect(() => {
    const draw = () => {
      const box = wrap.current;
      if (!box) return;
      const cv = box.getBoundingClientRect();
      const pt = (id, right) => {
        const e = box.querySelector(`[data-cm="${id}"]`);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: right ? r.right - cv.left : r.left - cv.left, y: r.top - cv.top + Math.min(r.height / 2, 26), col: e.closest('.cm-col')?.dataset.col };
      };
      const out = [];
      edges.forEach(([a, b, hot]) => {
        const A = pt(a, true), B = pt(b, false);
        if (!A || !B || A.col === B.col) return;
        out.push({ k: `${a}>${b}`, d: `M${A.x},${A.y} C${(A.x + B.x) / 2},${A.y} ${(A.x + B.x) / 2},${B.y} ${B.x},${B.y}`, hot });
      });
      setPaths(out);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cm" ref={wrap} style={{ gridTemplateColumns: widths || `repeat(${cols.length}, minmax(0, 1fr)) minmax(260px, 310px)` }}>
      <svg className="cm-wires" aria-hidden="true">{paths.map((p) => <path key={p.k} d={p.d} pathLength="1" className={`draw${p.hot ? ' hot' : ''}`} />)}</svg>
      {cols.map((c, ci) => (
        <div className="cm-col" key={c.title} data-col={ci}>
          <h5>{c.title}</h5>
          {c.groups.map((g, gi) => (
            <React.Fragment key={gi}>
              {g.name && <div className="cm-g">{g.name}</div>}
              {g.nodes.map((n) => {
                const Tag = n.onClick ? 'button' : 'div';
                return (
                  <Tag key={n.id} data-cm={n.id} className={`cm-n${n.input ? ' in' : ''}${n.warn ? ' warn' : ''}${n.sel ? ' sel' : ''}`} onClick={n.onClick} type={n.onClick ? 'button' : undefined} title={n.onClick ? 'Open the step to change it' : undefined}>
                    {n.warn ? <span className="cm-w">{n.label}</span> : (
                      <>
                        <span className="cm-r"><span className="cm-l">{n.label}</span><b className="cm-v"><CountUp>{n.value}</CountUp></b></span>
                        {n.sub && <small>{n.sub}</small>}
                        {n.spark && <span className="cm-sp"><Spark data={n.spark} w={220} h={26} /></span>}
                      </>
                    )}
                  </Tag>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      ))}
      <div className="cm-col" data-col={cols.length}>
        <h5>{result.title || 'Result'}</h5>
        <div className="cm-res" data-cm={result.id}>
          <span className="cm-res-l">{result.label}</span>
          <b className="cm-res-v"><CountUp>{result.value}</CountUp></b>
          {result.sub && <span className={`cm-res-s ${result.tone || ''}`}>{result.sub}</span>}
          {(result.rows || []).map(([k, v]) => <span className="cm-res-r" key={k}><span>{k}</span><b>{v}</b></span>)}
          {result.action && <button type="button" className="cm-res-b" onClick={result.action.onClick}>{result.action.label}</button>}
        </div>
      </div>
    </div>
  );
}

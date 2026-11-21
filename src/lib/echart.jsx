import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { COL } from './chartkit.js';

/* The theme/helpers live in chartkit.js (pure, no echarts) so option
   builders don't drag echarts into the main bundle; re-export them here
   for the lazy views (Charts/Ratios) that import everything from us. */
export * from './chartkit.js';

const GHOST_HOLD_MS = 2100; // how long the before-trace lingers after the last change
const BURST_GAP_MS = 900;   // quiet time after which the next change starts a new trace

const xSig = (option) => {
  const x = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
  return JSON.stringify(x?.data ?? null);
};

const ghostable = (s) =>
  (s.type === 'line' || s.type === 'bar') && !s.silent && !s.stack && Array.isArray(s.data) &&
  s.name && !String(s.name).startsWith('\u200b') && !['base', 'pad', '_lo'].includes(s.name) &&
  !String(s.id || '').startsWith('scen:');

/** Faint dashed snapshot of where each changed series was before the current drag. */
function makeGhosts(prev, next) {
  if (xSig(prev) !== xSig(next)) return null;
  const nextByName = new Map((next.series || []).map((s) => [s.name, s]));
  const ghosts = [];
  for (const s of prev.series || []) {
    if (!ghostable(s)) continue;
    const ns = nextByName.get(s.name);
    if (!ns || JSON.stringify(ns.data) === JSON.stringify(s.data)) continue;
    ghosts.push({
      id: `ghost:${s.name}`, name: '\u200b' + s.name, type: 'line',
      smooth: s.smooth ?? false, showSymbol: false, silent: true, animation: false, z: 1,
      xAxisIndex: s.xAxisIndex || 0, yAxisIndex: s.yAxisIndex || 0,
      lineStyle: { color: COL.ref, width: 1.3, type: [3, 4], opacity: 0.8 },
      itemStyle: { color: COL.ref },
      data: s.data,
    });
  }
  return ghosts.length ? ghosts : null;
}

/**
 * React wrapper: one ECharts instance, merge-updates (so values tween), auto-resize.
 *  - group:    echarts.connect group id — charts in the same group share the crosshair/tooltip.
 *  - onEvents: { click: (params) => … } handlers bound to the instance.
 *  - ghost:    while assumptions are dragged, a faint dashed "before" trace of every
 *              changed line/bar series lingers for ~2s so the move is visible (default on).
 */
export default function EChart({ option, style, className, group, onEvents, ghost = true }) {
  const elRef = useRef(null);
  const instRef = useRef(null);
  const prevRef = useRef(null);       // last base option rendered (without ghosts)
  const ghostsRef = useRef(null);     // active before-trace series
  const lastChangeRef = useRef(0);
  const timerRef = useRef(null);
  const eventsRef = useRef(onEvents);
  eventsRef.current = onEvents;

  useEffect(() => {
    const inst = echarts.init(elRef.current, null, { renderer: 'canvas' });
    instRef.current = inst;
    if (group) {
      inst.group = group;
      echarts.connect(group);
    }
    inst.on('click', (p) => eventsRef.current?.click?.(p));
    const ro = new ResizeObserver(() => inst.resize());
    ro.observe(elRef.current);
    return () => { clearTimeout(timerRef.current); ro.disconnect(); inst.dispose(); instRef.current = null; };
  }, [group]);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst || !option) return;
    let opt = option;
    if (ghost) {
      const now = Date.now();
      const idle = now - lastChangeRef.current > BURST_GAP_MS;
      lastChangeRef.current = now;
      if (prevRef.current && idle) ghostsRef.current = makeGhosts(prevRef.current, option);
      if (ghostsRef.current) {
        // keep ghosts out of the legend; tipBy already filters them from tooltips
        const names = (option.series || []).map((s) => s.name).filter((n) => n && !String(n).startsWith('\u200b'));
        opt = { ...option, legend: { ...(option.legend || {}), data: names }, series: [...(option.series || []), ...ghostsRef.current] };
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          ghostsRef.current = null;
          if (instRef.current && prevRef.current) instRef.current.setOption(prevRef.current, { replaceMerge: ['series'], lazyUpdate: true });
        }, GHOST_HOLD_MS);
      }
    }
    prevRef.current = option;
    inst.setOption(opt, { replaceMerge: ['series'], lazyUpdate: true });
  }, [option, ghost]);

  return <div ref={elRef} className={className} style={{ width: '100%', height: '100%', ...style }} />;
}

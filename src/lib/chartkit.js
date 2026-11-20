/* ===================================================================
   Shared chart theme/helpers — PURE module (no echarts import), so
   method tabs can build options without pulling echarts into the main
   bundle. The canvas itself renders via the lazy <LiveChart>.
   Gradients use ECharts' object-literal form instead of
   echarts.graphic.LinearGradient for the same reason.
   =================================================================== */

export const COL = {
  teal: '#6C8CFF', tealDeep: '#3E4E8C', gold: '#FBBF24', goldDeep: '#7A6220',
  green: '#34D399', greenDeep: '#155E43', cyan: '#22D3EE', violet: '#A78BFA',
  rose: '#F472B6', amber: '#FCD34D', red: '#F87171', outflow: '#F59E0B', outflow2: '#EF7B7B',
  axis: '#8B95A7', axisStrong: '#AAB4C5', ref: '#6E7889', text: '#E7EAF0',
};
export const PALETTE = [COL.teal, COL.gold, COL.green, COL.cyan, COL.violet, COL.rose, COL.amber, COL.red];

function withA(hex, a) {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
const lingrad = (stops) => ({ type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: stops, global: false });
/** vertical bar gradient (top→bottom) */
export const vgrad = (c, from = 0.95, to = 0.34) =>
  lingrad([{ offset: 0, color: withA(c, from) }, { offset: 1, color: withA(c, to) }]);
/** soft area fill gradient */
export const agrad = (c, from = 0.42, to = 0.02) =>
  lingrad([{ offset: 0, color: withA(c, from) }, { offset: 1, color: withA(c, to) }]);

export const xCat = (data, extra = {}) => ({
  type: 'category', data, boundaryGap: true,
  axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
  axisTick: { show: false },
  axisLabel: { color: COL.axis, fontFamily: 'Inter, sans-serif', fontSize: 11 },
  ...extra,
});
export const yVal = (extra = {}) => ({
  type: 'value',
  axisLine: { show: false }, axisTick: { show: false },
  axisLabel: { color: COL.axis, fontFamily: 'Inter, sans-serif', fontSize: 11 },
  splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
  ...extra,
});

const dot = (c) => {
  const solid = typeof c === 'string' ? c : c?.colorStops?.[0]?.color || COL.axis;
  return `<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${solid};margin-right:8px"></span>`;
};
/** axis tooltip with per-series formatting: fmtByName maps seriesName→fn; def is the fallback. */
export const tipBy = (fmtByName = {}, def = (v) => v) => ({
  trigger: 'axis',
  backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, padding: [9, 12],
  textStyle: { color: COL.text, fontFamily: 'Inter, sans-serif', fontSize: 12 },
  extraCssText: 'border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,0.6);',
  axisPointer: { type: 'line', lineStyle: { color: 'rgba(108,140,255,0.5)', type: 'dashed', width: 1 } },
  formatter: (ps) => {
    const arr = Array.isArray(ps) ? ps : [ps];
    const head = arr[0]?.axisValueLabel ?? arr[0]?.name ?? '';
    // series named with a leading zero-width space (the drag before-traces) stay out of the tooltip
    const rows = arr.filter((p) => p.value !== undefined && p.value !== null && !(Array.isArray(p.value) && p.value[1] == null) && !String(p.seriesName || '').startsWith('\u200b'))
      .map((p) => {
        const v = Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value;
        const f = fmtByName[p.seriesName] || def;
        return `<div style="display:flex;align-items:center;gap:2px;padding:2px 0">${dot(p.color)}<span style="color:#AAB4C5;margin-right:auto">${p.seriesName}</span><span style="font-family:Inter,sans-serif;font-weight:600;padding-left:14px">${f(v)}</span></div>`;
      }).join('');
    return `<div style="font-weight:700;color:#6C8CFF;font-size:11px;letter-spacing:.04em;margin-bottom:6px;font-family:Inter,sans-serif">${head}</div>${rows}`;
  },
});
/** item tooltip (pie / scatter) */
export const tipItem = (fmt = (v) => v) => ({
  trigger: 'item',
  backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, padding: [9, 12],
  textStyle: { color: COL.text, fontFamily: 'Inter, sans-serif', fontSize: 12 },
  extraCssText: 'border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,0.6);',
  formatter: (p) => `<div style="display:flex;align-items:center;gap:2px">${dot(p.color)}<span style="color:#AAB4C5;margin-right:auto">${p.name}</span><span style="font-family:Inter,sans-serif;font-weight:600;padding-left:14px">${fmt(Array.isArray(p.value) ? p.value[1] : p.value)}</span></div>`,
});

const LEGEND = { type: 'scroll', top: 6, icon: 'circle', itemWidth: 9, itemHeight: 9, itemGap: 14, textStyle: { color: COL.axis, fontSize: 12 }, inactiveColor: '#4A5264', pageIconColor: COL.teal, pageTextStyle: { color: COL.axis } };

const numCell = (v) => {
  if (v === null || v === undefined || v === '-' || !isFinite(v)) return '';
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : (Math.round(v * 100) / 100).toLocaleString('en-US');
};
/** Branded dark data-table for the toolbox dataView (the ECharts default renders light-on-light). */
function dataViewContent(opt) {
  const series = (opt.series || []).filter((s) => !s.silent && s.name !== 'base' && s.name !== 'pad' && s.name !== '_lo');
  const wrap = (inner) => `<div style="padding:16px 20px;font-family:Inter,system-ui,sans-serif;color:#E7EAF0;background:#161B25;max-height:62vh;overflow:auto">${inner}</div>`;
  const TH = 'style="text-align:right;padding:7px 14px;color:#6C8CFF;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #2A3242;position:sticky;top:0;background:#161B25"';
  const THL = TH.replace('text-align:right', 'text-align:left');
  const TD = 'style="text-align:right;padding:6px 14px;font-family:\'JetBrains Mono\',monospace;font-size:13px;border-bottom:1px solid rgba(255,255,255,0.07)"';
  const TDL = TD.replace('text-align:right', 'text-align:left');
  const table = (head, body) => wrap(`<table style="border-collapse:collapse;width:100%">${head}${body}</table>`);

  if (series.length && series.every((s) => s.type === 'pie')) {
    const head = `<tr><th ${THL}>Series</th><th ${THL}>Item</th><th ${TH}>Value</th></tr>`;
    const body = series.map((s) => (s.data || []).map((d) => `<tr><td ${TDL}>${s.name || ''}</td><td ${TDL}>${d.name}</td><td ${TD}>${numCell(d.value)}</td></tr>`).join('')).join('');
    return table(head, body);
  }
  const xAxis = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
  const cats = xAxis && xAxis.data;
  if (cats) {
    const cols = series.filter((s) => s.type !== 'pie');
    const head = `<tr><th ${THL}>Period</th>${cols.map((s) => `<th ${TH}>${s.name || ''}</th>`).join('')}</tr>`;
    const body = cats.map((cat, i) => `<tr><td ${TDL}>${cat}</td>${cols.map((s) => { let v = s.data && s.data[i]; if (Array.isArray(v)) v = v[v.length - 1]; if (v && typeof v === 'object') v = v.value; return `<td ${TD}>${numCell(v)}</td>`; }).join('')}</tr>`).join('');
    return table(head, body);
  }
  const cols = series.filter((s) => Array.isArray(s.data) && Array.isArray(s.data[0]));
  if (cols.length) {
    const maxLen = Math.max(...cols.map((s) => s.data.length));
    const head = `<tr><th ${THL}>x</th>${cols.map((s) => `<th ${TH}>${s.name || ''}</th>`).join('')}</tr>`;
    const body = Array.from({ length: maxLen }, (_, i) => `<tr><td ${TDL}>${numCell(cols[0].data[i]?.[0])}</td>${cols.map((s) => `<td ${TD}>${numCell(s.data[i]?.[1])}</td>`).join('')}</tr>`).join('');
    return table(head, body);
  }
  return wrap('<div style="color:#AAB4C5">No tabular data.</div>');
}

const TOOLBOX = {
  right: 10, top: 4, itemSize: 13, itemGap: 9,
  iconStyle: { borderColor: COL.axis }, emphasis: { iconStyle: { borderColor: COL.teal } },
  feature: {
    dataView: { readOnly: true, title: 'Data table', lang: ['Data table', 'Close', ''], backgroundColor: '#161B25', textColor: COL.text, textareaColor: '#161B25', textareaBorderColor: '#2A3242', buttonColor: COL.teal, buttonTextColor: '#fff', optionToContent: dataViewContent },
    saveAsImage: { title: 'Save PNG', backgroundColor: '#161B25', pixelRatio: 2 },
    restore: { title: 'Reset' },
  },
};
export const DATAZOOM = [
  { type: 'inside' },
  { type: 'slider', height: 16, bottom: 10, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.06)', fillerColor: 'rgba(108,140,255,0.16)', handleStyle: { color: COL.teal, borderColor: COL.teal }, moveHandleStyle: { color: COL.teal }, dataBackground: { lineStyle: { color: COL.axis }, areaStyle: { color: 'rgba(255,255,255,0.09)' } }, selectedDataBackground: { lineStyle: { color: COL.teal }, areaStyle: { color: 'rgba(108,140,255,0.14)' } }, textStyle: { color: COL.axis, fontSize: 10 } },
];

/** dashed reference line on the value axis (e.g. current price). */
export const refMarkLine = (entries) => ({
  silent: true, symbol: 'none', animation: false,
  lineStyle: { color: COL.ref, type: 'dashed', width: 1 },
  label: { color: COL.ref, fontSize: 11, fontFamily: 'Inter, sans-serif' },
  data: entries,
});

/** small mono value labels on top of bars/points — only when the series is short enough to stay legible */
export const valueLabels = (fmt, n, { max = 9, position = 'top', color = COL.axisStrong } = {}) =>
  n > max
    ? { show: false }
    : { show: true, position, color, fontFamily: 'Inter, sans-serif', fontSize: 9.5, formatter: (p) => fmt(Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value) };

/** Wrap a chart's core option with the shared theme + interactivity. */
export function themed(core, { zoom = false } = {}) {
  const o = {
    color: PALETTE,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Inter, sans-serif', color: COL.axisStrong },
    animation: true, animationDuration: 750, animationEasing: 'cubicOut',
    animationDurationUpdate: 550, animationEasingUpdate: 'cubicInOut',
    legend: LEGEND,
    toolbox: TOOLBOX,
    ...core,
  };
  o.grid = core.grid || { left: 8, right: 18, top: 48, bottom: zoom ? 56 : 14, containLabel: true };
  if (zoom) o.dataZoom = core.dataZoom || DATAZOOM;
  if (Array.isArray(o.series)) o.series = o.series.map((s) => (s.type === 'pie' ? s : { emphasis: { focus: 'series' }, blur: { itemStyle: { opacity: 0.12 }, lineStyle: { opacity: 0.1 }, areaStyle: { opacity: 0.05 } }, ...s }));
  return o;
}

/* ------------------------------------------------------------------ */
/* Option builders shared by several views                             */
/* ------------------------------------------------------------------ */

/**
 * Terminal-style waterfall: floating deltas over an invisible base,
 * totals restart from zero. items: { label, value, total? }.
 * Values are stacked SIGNED with stackStrategy 'all' (ECharts otherwise stacks
 * negatives and positives apart), so a level below zero — negative equity, a
 * negative PV of terminal value — is drawn below the axis where it belongs.
 */
export function waterfallOption(items, fmt, { showLabels = true } = {}) {
  let run = 0;
  const base = [], val = [], labels = [];
  const bar = (signed, kind, end) => ({
    value: signed, signed, kind,
    // the label sits on the bar's outer end: above a bar ending above zero, below one ending below it
    label: { position: end < 0 ? 'bottom' : 'top' },
    itemStyle: { borderRadius: signed < 0 ? [0, 0, 3, 3] : [3, 3, 0, 0] },
  });
  items.forEach((it) => {
    labels.push(it.label);
    if (it.total) {
      run = it.value;
      base.push(0);
      val.push(bar(it.value, 'total', it.value));
    } else {
      const start = run;
      run += it.value;
      base.push(start);
      val.push(bar(it.value, it.value >= 0 ? 'up' : 'down', run));
    }
  });
  const kColor = { total: COL.teal, up: COL.green, down: COL.red };
  return themed({
    tooltip: {
      ...tipBy({}, fmt),
      formatter: (ps) => {
        const p = (Array.isArray(ps) ? ps : [ps]).find((x) => x.seriesName === 'Δ');
        if (!p) return '';
        const d = val[p.dataIndex];
        return `<div style="font-weight:700;color:#6C8CFF;font-size:11px;margin-bottom:4px;font-family:Inter,sans-serif">${labels[p.dataIndex]}</div>` +
          `<span style="font-family:Inter,sans-serif;font-weight:600;color:${kColor[d.kind]}">${fmt(d.signed)}</span>` +
          `<span style="color:#8B95A7;font-size:11px;margin-left:8px">${d.kind === 'total' ? 'level' : 'change'}</span>`;
      },
    },
    legend: { show: false },
    xAxis: xCat(labels, { axisLabel: { color: COL.axis, fontFamily: 'Inter, sans-serif', fontSize: 10.5, interval: 0, rotate: labels.length > 6 ? 22 : 0 } }),
    yAxis: yVal({ axisLabel: { color: COL.axis, formatter: (v) => fmt(v) } }),
    grid: { left: 8, right: 14, top: 32, bottom: 8, containLabel: true },
    series: [
      { name: 'base', type: 'bar', stack: 'w', stackStrategy: 'all', silent: true, itemStyle: { color: 'transparent' }, emphasis: { itemStyle: { color: 'transparent' } }, data: base },
      {
        name: 'Δ', type: 'bar', stack: 'w', stackStrategy: 'all', barMaxWidth: 42,
        itemStyle: { color: (p) => vgrad(kColor[val[p.dataIndex].kind], 0.95, 0.45), borderRadius: [3, 3, 0, 0] },
        label: showLabels
          ? { show: true, position: 'top', color: COL.axisStrong, fontFamily: 'Inter, sans-serif', fontSize: 9.5, formatter: (p) => fmt(val[p.dataIndex].signed) }
          : { show: false },
        data: val,
      },
    ],
  });
}

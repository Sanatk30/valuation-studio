/* ===================================================================
   Shared chart theme/helpers — PURE module (no echarts import), so
   method tabs can build options without pulling echarts into the main
   bundle. The canvas itself renders via the lazy <LiveChart>.
   Gradients use ECharts' object-literal form instead of
   echarts.graphic.LinearGradient for the same reason.
   =================================================================== */

/*
 * Two palettes, one per theme. COL and PALETTE are filled in place by
 * setChartMode (lib/theme.js calls it before each render), so option builders
 * read the current theme's colours when they run; a view that memoises an
 * option lists the theme (useThemeMode) among its dependencies.
 */
const PALETTES = {
  light: {
    teal: '#2B7C85', tealDeep: '#BFD9DB', gold: '#E0A33A', goldDeep: '#F3DDB2',
    green: '#1E9E5A', greenDeep: '#B7E2C9', cyan: '#4FA9B3', violet: '#7C6AC4',
    rose: '#C8577E', amber: '#C98A00', red: '#E5484D', outflow: '#E0A33A', outflow2: '#E5484D',
    axis: '#8E9999', axisStrong: '#3A4646', ref: '#B5BEBE', text: '#15201F',
    tipBg: '#FFFFFF', tipBorder: '#E4E8E8', tipMuted: '#5F6B6B', tipShadow: 'rgba(21,32,31,0.10)',
    grid: 'rgba(21,32,31,0.06)', axisLine: 'rgba(21,32,31,0.14)', surface: '#FFFFFF', onBar: '#FFFFFF',
    wash: 'rgba(21,32,31,0.05)', zoomFill: 'rgba(43,124,133,0.12)', band: 'rgba(43,124,133,0.05)',
  },
  dark: {
    teal: '#5CC0C7', tealDeep: '#25494C', gold: '#F2C14E', goldDeep: '#5E4A1E',
    green: '#4ED08A', greenDeep: '#1C4632', cyan: '#7FD3D9', violet: '#A99BEA',
    rose: '#EE8DAE', amber: '#F5C451', red: '#FF6369', outflow: '#F2C14E', outflow2: '#FF6369',
    axis: '#7E8D8D', axisStrong: '#D2DADA', ref: '#5E6D6D', text: '#E5ECEC',
    tipBg: '#131A1B', tipBorder: '#32403F', tipMuted: '#9AA8A8', tipShadow: 'rgba(0,0,0,0.5)',
    grid: 'rgba(229,236,236,0.06)', axisLine: 'rgba(229,236,236,0.16)', surface: '#131A1B', onBar: '#0C1112',
    wash: 'rgba(255,255,255,0.06)', zoomFill: 'rgba(92,192,199,0.16)', band: 'rgba(92,192,199,0.06)',
  },
};
export const COL = { ...PALETTES.light };
const paletteOf = (c) => [c.teal, c.gold, c.green, c.cyan, c.violet, c.rose, c.amber, c.red];
export const PALETTE = paletteOf(COL);
let MODE = 'light';
/** Switch the chart palette to 'light' or 'dark' (mutates COL and PALETTE in place). */
export function setChartMode(mode) {
  const m = mode === 'dark' ? 'dark' : 'light';
  if (m === MODE) return;
  MODE = m;
  Object.assign(COL, PALETTES[m]);
  PALETTE.splice(0, PALETTE.length, ...paletteOf(COL));
}
export const chartMode = () => MODE;

function withA(hex, a) {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
const lingrad = (stops) => ({ type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: stops, global: false });
/** vertical bar gradient (top→bottom) — nearly solid, the flat fintech look */
export const vgrad = (c, from = 1, to = 0.78) =>
  lingrad([{ offset: 0, color: withA(c, from) }, { offset: 1, color: withA(c, to) }]);
/** soft area fill gradient */
export const agrad = (c, from = 0.32, to = 0.02) =>
  lingrad([{ offset: 0, color: withA(c, from) }, { offset: 1, color: withA(c, to) }]);
export const alpha = withA;

const FONT = 'Inter, sans-serif';
/** An axis title (name) styled for the theme: pass as `...axisName('₹ Cr')`. */
export const axisName = (name, gap = 10) => (name ? {
  name, nameGap: gap, nameTextStyle: { color: COL.axis, fontFamily: FONT, fontSize: 12.5, fontWeight: 500 },
} : {});

export const xCat = (data, extra = {}) => ({
  type: 'category', data, boundaryGap: true,
  axisLine: { lineStyle: { color: COL.axisLine } },
  axisTick: { show: false },
  axisLabel: { color: COL.axis, fontFamily: FONT, fontSize: 12 },
  ...extra,
});
export const yVal = (extra = {}) => ({
  type: 'value',
  axisLine: { show: false }, axisTick: { show: false },
  axisLabel: { color: COL.axis, fontFamily: FONT, fontSize: 12 },
  splitLine: { lineStyle: { color: COL.grid } },
  ...extra,
});

const dot = (c) => {
  const solid = typeof c === 'string' ? c : c?.colorStops?.[0]?.color || COL.axis;
  return `<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${solid};margin-right:8px"></span>`;
};
/** The tooltip box (background, border, shadow) for the current theme. */
export const tipBox = () => ({
  backgroundColor: COL.tipBg, borderColor: COL.tipBorder, borderWidth: 1, padding: [9, 12],
  textStyle: { color: COL.text, fontFamily: FONT, fontSize: 12 },
  extraCssText: `border-radius:8px;box-shadow:0 8px 22px ${COL.tipShadow};`,
});
/** tooltip head / row HTML in the theme's colours */
export const tipHead = (t) => `<div style="font-weight:700;color:${COL.teal};font-size:12px;letter-spacing:.02em;margin-bottom:6px;font-family:${FONT}">${t}</div>`;
export const tipRow = (color, name, value) => `<div style="display:flex;align-items:center;gap:2px;padding:2px 0">${color ? dot(color) : ''}<span style="color:${COL.tipMuted};margin-right:auto">${name}</span><span style="font-family:${FONT};font-weight:600;padding-left:14px;color:${COL.text}">${value}</span></div>`;

/** axis tooltip with per-series formatting: fmtByName maps seriesName→fn; def is the fallback. */
export const tipBy = (fmtByName = {}, def = (v) => v) => ({
  trigger: 'axis',
  ...tipBox(),
  axisPointer: { type: 'line', lineStyle: { color: withA(COL.teal, 0.5), type: 'dashed', width: 1 } },
  formatter: (ps) => {
    const arr = Array.isArray(ps) ? ps : [ps];
    const head = arr[0]?.axisValueLabel ?? arr[0]?.name ?? '';
    // series named with a leading zero-width space (the drag before-traces) stay out of the tooltip
    const rows = arr.filter((p) => p.value !== undefined && p.value !== null && !(Array.isArray(p.value) && p.value[1] == null) && !String(p.seriesName || '').startsWith('​') && !['base', 'pad', '_lo'].includes(p.seriesName))
      .map((p) => {
        const v = Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value;
        const f = fmtByName[p.seriesName] || def;
        return tipRow(p.color, p.seriesName, f(v));
      }).join('');
    return `${tipHead(head)}${rows}`;
  },
});
/** item tooltip (pie / scatter) */
export const tipItem = (fmt = (v) => v) => ({
  trigger: 'item',
  ...tipBox(),
  formatter: (p) => tipRow(p.color, p.name, fmt(Array.isArray(p.value) ? p.value[1] : p.value)),
});

const legend = () => ({ type: 'scroll', top: 4, left: 0, icon: 'rect', itemWidth: 14, itemHeight: 8, itemGap: 18, textStyle: { color: COL.axisStrong, fontSize: 12.5, fontFamily: FONT }, inactiveColor: withA(COL.axis, 0.35), pageIconColor: COL.teal, pageTextStyle: { color: COL.axis } });

const numCell = (v) => {
  if (v === null || v === undefined || v === '-' || !isFinite(v)) return '';
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : (Math.round(v * 100) / 100).toLocaleString('en-US');
};
/** Themed data table for the toolbox dataView (the ECharts default is unstyled). */
function dataViewContent(opt) {
  const series = (opt.series || []).filter((s) => !s.silent && s.name !== 'base' && s.name !== 'pad' && s.name !== '_lo' && !String(s.name || '').startsWith('​'));
  const wrap = (inner) => `<div style="padding:16px 20px;font-family:Inter,system-ui,sans-serif;color:${COL.text};background:${COL.surface};max-height:62vh;overflow:auto">${inner}</div>`;
  const TH = `style="text-align:right;padding:7px 14px;color:${COL.teal};font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid ${COL.tipBorder};position:sticky;top:0;background:${COL.surface}"`;
  const THL = TH.replace('text-align:right', 'text-align:left');
  const TD = `style="text-align:right;padding:6px 14px;font-family:'Roboto Mono',monospace;font-size:13px;border-bottom:1px solid ${COL.grid}"`;
  const TDL = TD.replace('text-align:right', 'text-align:left');
  const table = (head, body) => wrap(`<table style="border-collapse:collapse;width:100%">${head}${body}</table>`);

  if (series.length && series.every((s) => s.type === 'pie')) {
    const head = `<tr><th ${THL}>Series</th><th ${THL}>Item</th><th ${TH}>Value</th></tr>`;
    const body = series.map((s) => (s.data || []).map((d) => `<tr><td ${TDL}>${s.name || ''}</td><td ${TDL}>${d.name}</td><td ${TD}>${numCell(d.value)}</td></tr>`).join('')).join('');
    return table(head, body);
  }
  const catAxis = [].concat(opt.xAxis || [], opt.yAxis || []).find((ax) => ax && ax.type === 'category' && Array.isArray(ax.data));
  const cats = catAxis && catAxis.data;
  if (cats) {
    const cols = series.filter((s) => s.type !== 'pie' && s.type !== 'scatter');
    const head = `<tr><th ${THL}></th>${cols.map((s) => `<th ${TH}>${s.name || ''}</th>`).join('')}</tr>`;
    const body = cats.map((cat, i) => `<tr><td ${TDL}>${cat}</td>${cols.map((s) => { let v = s.data && s.data[i]; if (v && typeof v === 'object' && !Array.isArray(v)) v = v.value; if (Array.isArray(v)) v = v[v.length - 1]; return `<td ${TD}>${numCell(v)}</td>`; }).join('')}</tr>`).join('');
    return table(head, body);
  }
  const cols = series.filter((s) => Array.isArray(s.data) && Array.isArray(s.data[0]));
  if (cols.length) {
    const maxLen = Math.max(...cols.map((s) => s.data.length));
    const head = `<tr><th ${THL}>x</th>${cols.map((s) => `<th ${TH}>${s.name || ''}</th>`).join('')}</tr>`;
    const body = Array.from({ length: maxLen }, (_, i) => `<tr><td ${TDL}>${numCell(cols[0].data[i]?.[0])}</td>${cols.map((s) => `<td ${TD}>${numCell(s.data[i]?.[1])}</td>`).join('')}</tr>`).join('');
    return table(head, body);
  }
  return wrap(`<div style="color:${COL.axis}">No tabular data.</div>`);
}

const toolbox = () => ({
  right: 6, top: 4, itemSize: 13, itemGap: 10,
  iconStyle: { borderColor: COL.axis }, emphasis: { iconStyle: { borderColor: COL.teal, textFill: COL.teal } },
  feature: {
    dataView: { readOnly: true, title: 'Data table', lang: ['Data table', 'Close', ''], backgroundColor: COL.surface, textColor: COL.text, textareaColor: COL.surface, textareaBorderColor: COL.tipBorder, buttonColor: COL.teal, buttonTextColor: '#fff', optionToContent: dataViewContent },
    saveAsImage: { title: 'Save PNG', backgroundColor: COL.surface, pixelRatio: 2 },
    restore: { title: 'Reset' },
  },
});
export const dataZoom = () => [
  { type: 'inside' },
  { type: 'slider', height: 16, bottom: 10, borderColor: 'transparent', backgroundColor: COL.wash, fillerColor: COL.zoomFill, handleStyle: { color: COL.teal, borderColor: COL.teal }, moveHandleStyle: { color: COL.teal }, dataBackground: { lineStyle: { color: COL.axis }, areaStyle: { color: COL.wash } }, selectedDataBackground: { lineStyle: { color: COL.teal }, areaStyle: { color: COL.zoomFill } }, textStyle: { color: COL.axis, fontSize: 12 } },
];

/** dashed reference line on the value axis (e.g. current price). */
export const refMarkLine = (entries) => ({
  silent: true, symbol: 'none', animation: false,
  lineStyle: { color: COL.ref, type: 'dashed', width: 1 },
  label: { color: COL.ref, fontSize: 12, fontFamily: FONT },
  data: entries,
});

/** small value labels on top of bars/points — only when the series is short enough to stay legible */
export const valueLabels = (fmt, n, { max = 9, position = 'top', color = COL.axisStrong } = {}) =>
  n > max
    ? { show: false }
    : { show: true, position, color, fontFamily: FONT, fontSize: 12, formatter: (p) => fmt(Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value) };

/** Wrap a chart's core option with the shared theme + interactivity. */
export function themed(core, { zoom = false } = {}) {
  const o = {
    color: [...PALETTE],
    backgroundColor: 'transparent',
    textStyle: { fontFamily: FONT, color: COL.axisStrong },
    animation: true, animationDuration: 750, animationEasing: 'cubicOut',
    animationDurationUpdate: 550, animationEasingUpdate: 'cubicInOut',
    legend: legend(),
    toolbox: toolbox(),
    ...core,
  };
  if (core.legend) o.legend = core.legend.show === false ? core.legend : { ...legend(), ...core.legend };
  // value-axis titles sit above the plot: leave them a row under the legend and toolbox
  const named = [].concat(core.yAxis || []).some((ax) => ax && ax.name);
  o.grid = core.grid || { left: 4, right: 18, top: named ? 70 : 52, bottom: zoom ? 58 : 16, containLabel: true };
  if (zoom) o.dataZoom = core.dataZoom || dataZoom();
  if (Array.isArray(o.series)) o.series = o.series.map((s) => (s.type === 'pie' ? s : { ...(s.type === 'bar' ? { animationDelay: (idx) => idx * 70 } : {}), emphasis: { focus: 'series' }, blur: { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.12 }, areaStyle: { opacity: 0.05 } }, ...s }));
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
    itemStyle: { borderRadius: signed < 0 ? [0, 0, 2, 2] : [2, 2, 0, 0] },
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
  // dashed connectors carry each bar's closing level across to the next bar
  const levels = [];
  { let r = 0; items.forEach((it) => { r = it.total ? it.value : r + it.value; levels.push(r); }); }
  const connectors = levels.slice(0, -1).map((lv, i) => [{ coord: [labels[i], lv], symbol: 'none' }, { coord: [labels[i + 1], lv], symbol: 'none' }]);
  return themed({
    tooltip: {
      ...tipBy({}, fmt),
      formatter: (ps) => {
        const p = (Array.isArray(ps) ? ps : [ps]).find((x) => x.seriesName === 'Δ');
        if (!p) return '';
        const d = val[p.dataIndex];
        return tipHead(labels[p.dataIndex]) +
          `<span style="font-family:Inter,sans-serif;font-weight:600;color:${kColor[d.kind]}">${fmt(d.signed)}</span>` +
          `<span style="color:${COL.tipMuted};font-size:11px;margin-left:8px">${d.kind === 'total' ? 'level' : d.signed >= 0 ? 'adds' : 'deducts'}</span>`;
      },
    },
    legend: { show: false },
    xAxis: xCat(labels, { axisLabel: { color: COL.axis, fontFamily: FONT, fontSize: 12.5, interval: 0, rotate: labels.length > 6 ? 22 : 0, hideOverlap: true } }),
    yAxis: yVal({ axisLabel: { color: COL.axis, formatter: (v) => fmt(v) } }),
    grid: { left: 8, right: 14, top: 46, bottom: 8, containLabel: true },
    series: [
      { name: 'base', type: 'bar', stack: 'w', stackStrategy: 'all', silent: true, itemStyle: { color: 'transparent' }, emphasis: { itemStyle: { color: 'transparent' } }, data: base },
      {
        name: 'Δ', type: 'bar', stack: 'w', stackStrategy: 'all', barMaxWidth: 42,
        itemStyle: { color: (p) => vgrad(kColor[val[p.dataIndex].kind], 1, 0.86), borderRadius: [2, 2, 0, 0] },
        label: showLabels
          ? { show: true, position: 'top', color: COL.axisStrong, fontFamily: FONT, fontSize: 12, fontWeight: 600, formatter: (p) => { const d = val[p.dataIndex]; return d.kind === 'total' ? fmt(d.signed) : `${d.signed >= 0 ? '+' : '−'}${fmt(Math.abs(d.signed))}`; } }
          : { show: false },
        markLine: { silent: true, symbol: 'none', animation: false, lineStyle: { color: COL.ref, type: [3, 3], width: 1 }, label: { show: false }, data: connectors },
        data: val,
      },
    ],
  });
}

/**
 * Football field: one horizontal bar per method from its low to its high, a
 * dot at the value it gives, and a dashed line at the market price. Hover a
 * row for its low / value / high and the gap to the market.
 * items: { label, low, mid, high, highlight?, alt? }   price: number or NaN
 */
export function footballOption(items, { price = NaN, fmt = (v) => v, axisTitle = '' } = {}) {
  const rows = items.filter((it) => isFinite(it.low) && isFinite(it.high));
  if (!rows.length) return null;
  const hasPx = isFinite(price) && price > 0;
  const vals = rows.flatMap((r) => [r.low, r.high, ...(isFinite(r.mid) ? [r.mid] : [])]).concat(hasPx ? [price] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.16 || Math.abs(hi) * 0.1 || 1;
  lo -= pad; hi += pad;
  const colorOf = (r) => (r.alt ? COL.cyan : r.highlight ? COL.gold : COL.teal);
  const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  return themed({
    legend: { show: false },
    grid: { left: 4, right: 12, top: hasPx ? 44 : 22, bottom: axisTitle ? 34 : 16, containLabel: true },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: COL.band } }, ...tipBox(),
      formatter: (ps) => {
        const i = (Array.isArray(ps) ? ps : [ps])[0]?.dataIndex;
        const r = rows[i];
        if (!r) return '';
        const vs = (v) => (hasPx && isFinite(v) ? ` <span style="color:${v >= price ? COL.green : COL.red}">(${pct(v / price - 1)})</span>` : '');
        return tipHead(r.label)
          + tipRow(null, 'Low', fmt(r.low) + vs(r.low))
          + (isFinite(r.mid) ? tipRow(colorOf(r), 'Value', `<b>${fmt(r.mid)}</b>${vs(r.mid)}`) : '')
          + tipRow(null, 'High', fmt(r.high) + vs(r.high))
          + (hasPx ? `<div style="margin-top:6px;color:${COL.tipMuted};font-size:11px">Market ${fmt(price)}</div>` : '');
      },
    },
    yAxis: [
      {
        type: 'category', inverse: true, data: rows.map((r) => r.label),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: COL.axisStrong, fontFamily: FONT, fontSize: 13, width: 150, overflow: 'truncate', margin: 14 },
      },
      {
        // the value of each row and its gap to the market, read off at the right
        type: 'category', inverse: true, position: 'right', data: rows.map((r) => r.label),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: {
          fontFamily: FONT, fontSize: 13, margin: 18,
          formatter: (_, i) => {
            const r = rows[i];
            if (!r || !isFinite(r.mid)) return '';
            const g = hasPx ? r.mid / price - 1 : NaN;
            return `{v|${fmt(r.mid)}}${isFinite(g) ? `  {${g >= 0 ? 'up' : 'dn'}|${pct(g)}}` : ''}`;
          },
          rich: {
            v: { color: COL.text, fontFamily: FONT, fontSize: 14, fontWeight: 600 },
            up: { color: COL.green, fontFamily: 'Roboto Mono, monospace', fontSize: 12 },
            dn: { color: COL.red, fontFamily: 'Roboto Mono, monospace', fontSize: 12 },
          },
        },
      },
    ],
    xAxis: yVal({ min: lo, max: hi, ...axisName(axisTitle, 22), nameLocation: 'middle', axisLabel: { color: COL.axis, fontFamily: FONT, fontSize: 12.5, formatter: (v) => fmt(v), hideOverlap: true, showMinLabel: false, showMaxLabel: false } }),
    series: [
      { name: '_lo', type: 'bar', stack: 'ff', stackStrategy: 'all', silent: true, itemStyle: { color: 'transparent' }, emphasis: { disabled: true },
        label: { show: true, position: 'insideRight', distance: -4, color: COL.axis, fontSize: 12.5, fontFamily: FONT, formatter: (p) => (rows[p.dataIndex].high > rows[p.dataIndex].low ? fmt(rows[p.dataIndex].low) : ''), align: 'right', offset: [-8, 0] },
        data: rows.map((r) => r.low) },
      { name: 'Range', type: 'bar', stack: 'ff', stackStrategy: 'all', barMaxWidth: 22, barCategoryGap: '40%',
        itemStyle: { borderRadius: 4 },
        label: { show: true, position: 'right', color: COL.axis, fontSize: 12.5, fontFamily: FONT, formatter: (p) => (rows[p.dataIndex].high > rows[p.dataIndex].low ? fmt(rows[p.dataIndex].high) : '') },
        data: rows.map((r) => ({ value: Math.max(r.high - r.low, (hi - lo) * 0.004), itemStyle: { color: withA(colorOf(r), r.highlight || r.alt ? 0.9 : 0.42) } })) },
      { name: 'Value', type: 'scatter', symbolSize: 13, z: 5,
        itemStyle: { color: COL.text, borderColor: COL.surface, borderWidth: 2 },
        data: rows.map((r) => (isFinite(r.mid) ? [r.mid, r.label] : null)).filter(Boolean),
        ...(hasPx ? { markLine: {
          silent: true, symbol: 'none', animation: false,
          lineStyle: { color: COL.gold, type: [6, 4], width: 1.8 },
          label: { show: true, position: 'start', distance: 8, formatter: `Market price ${fmt(price)}`, color: COL.gold, fontFamily: FONT, fontSize: 12, fontWeight: 600 },
          data: [{ xAxis: price }],
        } } : {}) },
    ],
  });
}

/**
 * Peers scatter with the fitted line and the target: x and y are numbers,
 * fit = { slope, intercept } (or null), target = { x, y, name } (or null).
 */
export function fitScatterOption(points, { fit = null, target = null, fx = (v) => v, fy = (v) => v, xTitle = '', yTitle = '', r2 = NaN } = {}) {
  const pts = points.filter((p) => isFinite(p.x) && isFinite(p.y));
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x).concat(target && isFinite(target.x) ? [target.x] : []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const pad = (x1 - x0 || Math.abs(x1) || 1) * 0.08;
  const line = fit && isFinite(fit.slope) ? [[x0 - pad, fit.intercept + fit.slope * (x0 - pad)], [x1 + pad, fit.intercept + fit.slope * (x1 + pad)]] : null;
  const valAx = (title, f, gap) => yVal({ scale: true, ...axisName(title, gap), nameLocation: 'middle', axisLabel: { color: COL.axis, fontFamily: FONT, fontSize: 12.5, formatter: (v) => f(v), hideOverlap: true } });
  return themed({
    legend: { data: ['Peers', ...(line ? ['Fitted line'] : []), ...(target ? ['Target'] : [])] },
    grid: { left: 14, right: 22, top: 44, bottom: 34, containLabel: true },
    tooltip: { trigger: 'item', ...tipBox(), formatter: (p) => (p.seriesName === 'Fitted line' ? '' : tipHead(p.data[2] || p.seriesName) + tipRow(null, xTitle || 'x', fx(p.data[0])) + tipRow(null, yTitle || 'y', fy(p.data[1]))) },
    xAxis: { ...valAx(xTitle, fx, 24), splitLine: { show: false } },
    yAxis: valAx(yTitle, fy, 40),
    series: [
      ...(line ? [{ name: 'Fitted line', type: 'line', symbol: 'none', silent: true, lineStyle: { color: COL.axis, type: [6, 4], width: 1.6 }, data: line,
        endLabel: { show: isFinite(r2), formatter: `R² ${isFinite(r2) ? r2.toFixed(2) : ''}`, color: COL.axis, fontSize: 12.5, fontFamily: FONT } }] : []),
      { name: 'Peers', type: 'scatter', symbolSize: 11, itemStyle: { color: COL.teal, borderColor: COL.surface, borderWidth: 1.5 },
        label: { show: pts.length <= 14, position: 'top', color: COL.axis, fontSize: 12.5, fontFamily: FONT, formatter: (p) => p.data[2] },
        data: pts.map((p) => [p.x, p.y, p.name]) },
      ...(target && isFinite(target.x) && isFinite(target.y) ? [{ name: 'Target', type: 'scatter', symbol: 'circle', symbolSize: 15, z: 6,
        itemStyle: { color: COL.surface, borderColor: COL.gold, borderWidth: 3 },
        label: { show: true, position: 'bottom', color: COL.gold, fontSize: 12.5, fontWeight: 700, fontFamily: FONT, formatter: (p) => p.data[2] },
        data: [[target.x, target.y, target.name || 'Target']] }] : []),
    ],
  });
}

/**
 * Donut: parts [{ name, value, color? }] with the total (or a label) in the
 * hole and each slice's share on a leader line. Hover for the value.
 */
export function donutOption(parts, { center = '', sub = '', fmt = (v) => v, labels = true } = {}) {
  const data = parts.filter((p) => isFinite(p.value) && p.value > 0);
  if (!data.length) return null;
  const tot = data.reduce((s, p) => s + p.value, 0);
  return themed({
    legend: { show: false },
    toolbox: { show: false },
    tooltip: { trigger: 'item', ...tipBox(), formatter: (p) => tipHead(p.name) + tipRow(p.color, 'Value', fmt(p.value)) + tipRow(null, 'Share', `${(p.value / tot * 100).toFixed(1)}%`) },
    title: center ? {
      text: center, subtext: sub, left: 'center', top: 'center', itemGap: 4,
      textStyle: { color: COL.text, fontFamily: FONT, fontSize: 20, fontWeight: 600 },
      subtextStyle: { color: COL.axis, fontFamily: FONT, fontSize: 12 },
    } : undefined,
    series: [{
      type: 'pie', radius: labels ? ['46%', '68%'] : ['64%', '86%'], center: ['50%', '50%'], avoidLabelOverlap: true, padAngle: labels ? 0 : 2,
      label: labels ? { color: COL.axisStrong, fontFamily: FONT, fontSize: 12, overflow: 'none', edgeDistance: 6, formatter: (p) => `${p.name}\n${p.percent.toFixed(0)}%`, lineHeight: 16 } : { show: false },
      labelLine: { show: labels, lineStyle: { color: COL.ref } },
      itemStyle: { borderColor: COL.surface, borderWidth: labels ? 2 : 0, borderRadius: labels ? 0 : 6 },
      emphasis: { scaleSize: 6 },
      data: data.map((p, i) => ({ name: p.name, value: p.value, itemStyle: { color: p.color || PALETTE[i % PALETTE.length] } })),
    }],
  });
}

/**
 * Smooth area trend: the first series teal with a soft fill, the others as
 * quiet grey lines; an axis tooltip card. series [{ name, data, color? }]
 * nHist: the first nHist points are actuals (the forecast part is shaded).
 */
export function areaTrendOption(labels, series, { fmt = (v) => v, nHist = 0 } = {}) {
  if (!labels.length || !series.length) return null;
  const n = labels.length;
  const cols = [COL.teal, COL.ref, COL.gold];
  return themed({
    legend: { top: 0, right: 0, left: 'auto', icon: 'circle', itemWidth: 9, itemHeight: 9 },
    toolbox: { show: false },
    tooltip: tipBy({}, fmt),
    grid: { left: 4, right: 12, top: 40, bottom: 8, containLabel: true },
    xAxis: { ...xCat(labels), boundaryGap: false, axisLine: { show: false } },
    yAxis: yVal({ axisLabel: { color: COL.axis, fontFamily: FONT, fontSize: 12, formatter: (v) => fmt(v) }, splitLine: { lineStyle: { color: COL.grid, type: [4, 4] } } }),
    series: series.map((s, i) => ({
      name: s.name, type: 'line', smooth: 0.35, symbol: 'circle', symbolSize: 7, showSymbol: false,
      lineStyle: { width: i === 0 ? 2.6 : 2, color: s.color || cols[i % cols.length] },
      itemStyle: { color: s.color || cols[i % cols.length], borderColor: COL.surface, borderWidth: 2 },
      areaStyle: i === 0 ? { color: agrad(s.color || cols[0], 0.22, 0.01) } : undefined,
      emphasis: { focus: 'none' },
      data: s.data.map((v) => (isFinite(v) ? Math.round(v * 10) / 10 : null)),
      ...(i === 0 && nHist > 0 && nHist < n ? {
        markArea: { silent: true, itemStyle: { color: COL.band }, label: { show: true, position: 'insideTop', color: COL.axis, fontSize: 12, distance: 6 }, data: [[{ name: 'Forecast', xAxis: labels[nHist] }, { xAxis: labels[n - 1] }]] },
      } : {}),
    })),
  });
}

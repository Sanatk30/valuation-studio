/**
 * ECharts option builders shared by the output pages (pure — no echarts
 * import; the canvas renders through the lazy <LiveChart>). Ported from the
 * old Charts gallery and method tabs without the scenario ghosts and the
 * click-to-assumption handlers.
 *
 * Missing values are passed to ECharts as null (a gap), never as 0.
 */
import { themed, xCat, yVal, tipBy, tipItem, vgrad, agrad, refMarkLine, valueLabels, COL } from '../../lib/chartkit.js';
import { fmtPct, fmtX } from '../../lib/format.js';
import { fin, rnd } from './format.js';

export const barStyle = (c, r = [4, 4, 0, 0]) => ({ color: vgrad(c), borderRadius: r });
export const lineSeries = (name, c, data, { area = false, smooth = true, width = 2.4, symbol = true, dashed = false, yAxisIndex } = {}) => ({
  name, type: 'line', smooth, showSymbol: symbol, symbolSize: 6,
  lineStyle: { width, color: c, ...(dashed ? { type: 'dashed' } : {}) }, itemStyle: { color: c },
  ...(area ? { areaStyle: { color: agrad(c) } } : {}),
  ...(yAxisIndex !== undefined ? { yAxisIndex } : {}),
  data,
});
export const barSeries = (name, c, data, extra = {}) => ({ name, type: 'bar', barMaxWidth: 28, itemStyle: barStyle(c), data, ...extra });

const pctAxis = (extra = {}) => yVal({ axisLabel: { color: COL.axis, formatter: '{value}%' }, ...extra });
const moneyAxis = (f, extra = {}) => yVal({ axisLabel: { color: COL.axis, formatter: f.short }, ...extra });

/** Linear percentile over the finite values (chart bands only). */
export function pctl(arr, q) {
  const s = arr.filter(fin).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** Revenue & EBITDA bars with the EBITDA-margin line (projection years). */
export function projectionOption(f, labels, ops) {
  const n = labels.length;
  const margins = ops.margin.filter(fin);
  const avg = margins.length ? margins.reduce((x, v) => x + v, 0) / margins.length : NaN;
  return themed({
    tooltip: tipBy({ 'EBITDA margin': (v) => fmtPct(v, 1) }, f.num),
    xAxis: xCat(labels),
    yAxis: [moneyAxis(f), yVal({ position: 'right', splitLine: { show: false }, axisLabel: { color: COL.gold, formatter: '{value}%' } })],
    series: [
      barSeries('Revenue', COL.tealDeep, ops.revenue.map((v) => rnd(v))),
      barSeries('EBITDA', COL.teal, ops.ebitda.map((v) => rnd(v)), { label: valueLabels(f.num, n) }),
      {
        ...lineSeries('EBITDA margin', COL.gold, ops.margin.map((v) => rnd(v, 2)), { yAxisIndex: 1 }),
        ...(fin(avg) ? { markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.gold, type: 'dashed', width: 1, opacity: 0.6 }, label: { color: COL.gold, fontSize: 9.5, formatter: `avg ${fmtPct(avg, 1)}`, position: 'insideEndTop' }, data: [{ yAxis: +avg.toFixed(2) }] } } : {}),
      },
    ],
  }, { zoom: n > 9 });
}

/** Revenue growth % bars. */
export function growthOption(f, labels, growth) {
  return themed({
    tooltip: tipBy({}, (v) => fmtPct(v, 1)),
    xAxis: xCat(labels), yAxis: pctAxis(),
    legend: { show: false },
    series: [barSeries('Revenue growth', COL.green, growth.map((v) => rnd(v, 2)), { barMaxWidth: 44, label: valueLabels((v) => fmtPct(v, 1), labels.length) })],
  });
}

/**
 * Bars per company / deal with the median line and the Q1–Q3 band.
 * items: [{ name, value }] — only finite values are plotted.
 */
export function bandBarsOption(items, { color = COL.teal, name = 'Multiple', fmt = (v) => fmtX(v, 2), rotate = 12 } = {}) {
  const pts = items.filter((it) => fin(it.value));
  if (!pts.length) return null;
  const vals = pts.map((p) => +p.value.toFixed(2));
  const q1 = pctl(vals, 0.25), q3 = pctl(vals, 0.75), med = pctl(vals, 0.5);
  return themed({
    tooltip: { ...tipBy({}, fmt), axisPointer: { type: 'shadow' } }, legend: { show: false },
    xAxis: xCat(pts.map((p) => p.name), { axisLabel: { color: COL.axis, fontSize: 10.5, interval: 0, rotate } }),
    yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: '{value}x' } }),
    series: [{
      name, type: 'bar', barMaxWidth: 40, itemStyle: barStyle(color), data: vals,
      markArea: { silent: true, itemStyle: { color: 'rgba(108,140,255,0.09)' }, label: { show: true, position: 'insideTopLeft', color: COL.teal, fontSize: 10, formatter: 'Q1–Q3' }, data: [[{ yAxis: q1 }, { yAxis: q3 }]] },
      markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.gold, type: 'dashed' }, label: { formatter: `median ${fmtX(med, 1)}`, color: COL.gold, fontSize: 11 }, data: [{ yAxis: med }] },
    }],
  });
}

/**
 * Box & whisker over several multiples.
 * groups: [{ label, values: number[] }] — groups with no finite value are dropped.
 */
export function boxOption(groups) {
  const g = groups.map((x) => ({ ...x, v: x.values.filter(fin) })).filter((x) => x.v.length);
  if (!g.length) return null;
  const box = (v) => [Math.min(...v), pctl(v, 0.25), pctl(v, 0.5), pctl(v, 0.75), Math.max(...v)];
  return themed({
    tooltip: {
      trigger: 'item', backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, textStyle: { color: COL.text },
      formatter: (p) => {
        const d = p.value;
        return Array.isArray(d) && d.length >= 6
          ? `<div style="font-weight:700;color:#AAB4C5;font-size:11px;margin-bottom:4px">${p.name}</div><div style="font-family:Inter,sans-serif">max ${fmtX(d[5], 1)}<br>Q3 ${fmtX(d[4], 1)}<br>median ${fmtX(d[3], 1)}<br>Q1 ${fmtX(d[2], 1)}<br>min ${fmtX(d[1], 1)}</div>`
          : '';
      },
    },
    legend: { show: false },
    xAxis: xCat(g.map((x) => x.label)),
    yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: '{value}x' } }),
    series: [{ type: 'boxplot', data: g.map((x) => box(x.v)), itemStyle: { color: 'rgba(108,140,255,0.14)', borderColor: COL.teal, borderWidth: 1.6 }, emphasis: { itemStyle: { borderColor: COL.gold } } }],
  });
}

/** Two stacked 100% bars: pre vs post ownership. */
export function ownershipOption(existingPostPct, newPostPct) {
  const lbl = () => ({ show: true, position: 'inside', color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 10.5, fontWeight: 700, formatter: (p) => (p.value > 4 ? `${p.value}%` : '') });
  return themed({
    tooltip: tipBy({}, (v) => fmtPct(v, 1)),
    xAxis: xCat(['Pre-IPO', 'Post-IPO'], { axisLabel: { color: COL.axisStrong, fontFamily: 'Inter, sans-serif', fontSize: 12 } }),
    yAxis: yVal({ max: 100, axisLabel: { color: COL.axis, formatter: '{value}%' } }),
    series: [
      { name: 'Existing holders', type: 'bar', stack: 'o', barMaxWidth: 90, itemStyle: { color: vgrad(COL.teal) }, label: lbl(), data: [100, rnd(existingPostPct, 1)] },
      { name: 'New investors', type: 'bar', stack: 'o', barMaxWidth: 90, itemStyle: { color: vgrad(COL.rose), borderRadius: [3, 3, 0, 0] }, label: lbl(), data: [0, rnd(newPostPct, 1)] },
    ],
  });
}

/** A pie / ring of named parts. */
export function ringOption(parts, fmt) {
  const data = parts.filter((p) => fin(p.value) && p.value > 0);
  if (!data.length) return null;
  return themed({
    tooltip: tipItem(fmt), legend: { show: false },
    series: [{
      type: 'pie', radius: ['52%', '74%'], center: ['50%', '54%'], padAngle: 3,
      itemStyle: { borderRadius: 6, borderColor: '#161B25', borderWidth: 2 },
      label: { color: COL.axisStrong, formatter: '{b}\n{d}%', fontSize: 11 }, labelLine: { lineStyle: { color: COL.axis } },
      data: data.map((p) => ({ name: p.name, value: Math.round(p.value), itemStyle: { color: vgrad(p.color) } })),
    }],
  });
}

/** Stacked bars (e.g. balance-sheet composition) with an optional total line. */
export function stackedOption(f, labels, stacks, { line } = {}) {
  return themed({
    tooltip: { ...tipBy({}, f.num), axisPointer: { type: 'shadow' } },
    xAxis: xCat(labels), yAxis: moneyAxis(f),
    series: [
      ...stacks.map((s) => ({ name: s.name, type: 'bar', stack: 'a', barMaxWidth: 40, itemStyle: { color: vgrad(s.color) }, data: s.data.map((v) => rnd(v)) })),
      ...(line ? [lineSeries(line.name, line.color, line.data.map((v) => rnd(v)))] : []),
    ],
  });
}

export { themed, xCat, yVal, tipBy, tipItem, vgrad, agrad, refMarkLine, valueLabels, COL, moneyAxis, pctAxis };

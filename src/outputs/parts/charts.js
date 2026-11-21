/**
 * ECharts option builders shared by the output pages (pure — no echarts
 * import; the canvas renders through the lazy <LiveChart>). Ported from the
 * old Charts gallery and method tabs without the scenario ghosts and the
 * click-to-assumption handlers.
 *
 * Missing values are passed to ECharts as null (a gap), never as 0.
 */
import { themed, xCat, yVal, tipBy, tipItem, tipBox, tipHead, tipRow, vgrad, agrad, alpha, axisName, refMarkLine, valueLabels, footballOption, fitScatterOption, COL } from '../../lib/chartkit.js';
import { fmtPct, fmtX } from '../../lib/format.js';
import { fin, rnd } from './format.js';

export const barStyle = (c, r = [2, 2, 0, 0]) => ({ color: vgrad(c), borderRadius: r });
export const lineSeries = (name, c, data, { area = false, smooth = false, width = 2.2, symbol = true, dashed = false, yAxisIndex, end = null } = {}) => ({
  name, type: 'line', smooth, showSymbol: symbol, symbolSize: 7, symbol: 'circle',
  ...(end ? { endLabel: { show: true, color: c, fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, distance: 8, formatter: (p) => end(Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value) } } : {}),
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

/**
 * Revenue & EBITDA bars with the EBITDA-margin line (right axis). Optional:
 *   nHist  — the first nHist columns are actuals: lighter bars, and the forecast
 *            columns are shaded and labelled "Forecast"
 *   cash   — { name, data } a cash-flow line (e.g. FCFF) over the forecast years
 */
export function projectionOption(f, labels, ops, { nHist = 0, cash = null } = {}) {
  const n = labels.length;
  const margins = ops.margin.filter(fin);
  const avg = margins.length ? margins.reduce((x, v) => x + v, 0) / margins.length : NaN;
  const histBar = (c, i) => (i < nHist ? { itemStyle: { color: alpha(c, 0.45), borderRadius: [2, 2, 0, 0] } } : {});
  const fcstArea = nHist > 0 && nHist < n ? {
    markArea: {
      silent: true, itemStyle: { color: COL.band },
      label: { show: true, position: 'insideTop', color: COL.axis, fontSize: 12.5, fontWeight: 600, distance: 6 },
      data: [[{ name: 'Forecast →', xAxis: labels[nHist] }, { xAxis: labels[n - 1] }]],
    },
  } : {};
  // compound growth of revenue from the last actual year to the last forecast year
  const r0 = ops.revenue[nHist - 1], r1 = ops.revenue[n - 1];
  const cagr = nHist > 0 && nHist < n && r0 > 0 && r1 > 0 ? (Math.pow(r1 / r0, 1 / (n - nHist)) - 1) * 100 : NaN;
  const cagrMark = fin(cagr) ? {
    markPoint: {
      symbol: 'circle', symbolSize: 0, silent: true, animation: false,
      label: { show: true, position: 'top', distance: 26, color: COL.axisStrong, fontSize: 12, fontWeight: 600, formatter: `Revenue CAGR ${labels[nHist - 1]}–${labels[n - 1]}: ${fmtPct(cagr, 1)}` },
      data: [{ coord: [labels[n - 1], rnd(r1)] }],
    },
  } : {};
  return themed({
    tooltip: tipBy({ 'EBITDA margin': (v) => fmtPct(v, 1) }, f.num),
    xAxis: xCat(labels),
    yAxis: [
      moneyAxis(f, { ...axisName(f.unitLabel, 14) }),
      yVal({ position: 'right', splitLine: { show: false }, ...axisName('margin', 14), axisLabel: { color: COL.gold, formatter: '{value}%' } }),
    ],
    series: [
      { ...barSeries('Revenue', COL.tealDeep, ops.revenue.map((v, i) => ({ value: rnd(v), ...histBar(COL.tealDeep, i) }))), ...fcstArea },
      barSeries('EBITDA', COL.teal, ops.ebitda.map((v, i) => ({ value: rnd(v), ...histBar(COL.teal, i) })), { label: valueLabels(f.num, n) }),
      ...(cash ? [lineSeries(cash.name, COL.green, cash.data.map((v) => (fin(v) ? rnd(v) : null)), { width: 2.4, end: (v) => `${cash.name} ${f.num(v)}` })] : []),
      {
        ...lineSeries('EBITDA margin', COL.gold, ops.margin.map((v) => rnd(v, 2)), { yAxisIndex: 1, dashed: true, width: 2, end: (v) => `margin ${fmtPct(v, 1)}` }),
        ...(fin(avg) ? { markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.gold, type: 'dotted', width: 1, opacity: 0.7 }, label: { color: COL.gold, fontSize: 12, formatter: `avg ${fmtPct(avg, 1)}`, position: 'insideEndBottom' }, data: [{ yAxis: +avg.toFixed(2) }] } } : {}),
      },
    ],
    grid: { left: 4, right: 120, top: 72, bottom: n > 9 ? 58 : 16, containLabel: true },
  }, { zoom: n > 9 });
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
      trigger: 'item', ...tipBox(),
      formatter: (p) => {
        const d = p.value;
        if (!Array.isArray(d) || d.length < 6) return '';
        const n = g.find((x) => x.label === p.name)?.v.length;
        return tipHead(`${p.name}${n ? ` · ${n} value${n === 1 ? '' : 's'}` : ''}`)
          + tipRow(null, 'High', fmtX(d[5], 1)) + tipRow(null, 'Upper quartile', fmtX(d[4], 1))
          + tipRow(COL.teal, 'Median', `<b>${fmtX(d[3], 1)}</b>`) + tipRow(null, 'Lower quartile', fmtX(d[2], 1)) + tipRow(null, 'Low', fmtX(d[1], 1));
      },
    },
    legend: { show: false },
    xAxis: xCat(g.map((x) => x.label)),
    yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: '{value}x' } }),
    series: [
      { name: 'Distribution', type: 'boxplot', boxWidth: [14, 40], data: g.map((x) => box(x.v)), itemStyle: { color: alpha(COL.teal, 0.16), borderColor: COL.teal, borderWidth: 1.6 }, emphasis: { itemStyle: { borderColor: COL.gold } } },
      { name: 'Median', type: 'scatter', symbol: 'rect', symbolSize: [26, 2], silent: true, itemStyle: { color: COL.gold },
        label: { show: true, position: 'right', distance: 22, color: COL.axisStrong, fontSize: 12, fontWeight: 600, formatter: (p) => `${(+p.value[1]).toFixed(1)}x` },
        data: g.map((x) => [x.label, +pctl(x.v, 0.5).toFixed(3)]) },
      // each value as a dot beside its box, so a small peer set shows every observation
      { name: 'Values', type: 'scatter', symbolSize: 6, silent: true, itemStyle: { color: alpha(COL.text, 0.55) },
        data: g.flatMap((x) => x.v.map((v) => [x.label, +v.toFixed(3)])) },
    ],
  });
}

/** Two stacked 100% bars: pre vs post ownership. */
export function ownershipOption(existingPostPct, newPostPct) {
  const lbl = () => ({ show: true, position: 'inside', color: COL.onBar, fontFamily: 'Inter, sans-serif', fontSize: 12.5, fontWeight: 700, formatter: (p) => (p.value > 4 ? `${p.value}%` : '') });
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

export { themed, xCat, yVal, tipBy, tipItem, tipBox, tipHead, tipRow, vgrad, agrad, alpha, axisName, refMarkLine, valueLabels, footballOption, fitScatterOption, COL, moneyAxis, pctAxis };

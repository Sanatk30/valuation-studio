import React, { useEffect, useMemo, useState } from 'react';
import Hero from '../components/Hero.jsx';
import EChart, { themed, xCat, yVal, tipBy, tipItem, vgrad, agrad, COL, PALETTE, DATAZOOM, refMarkLine, scenGhostSeries } from '../lib/echart.jsx';
import { applyScenario, SCENARIOS } from '../lib/engine/scenario.js';
import { requestAssumption } from '../lib/assume.js';
import { projectOperations } from '../lib/engine/drivers.js';
import { computeDcf, dcfPriceWaccGrowth, dcfPriceWaccExit } from '../lib/engine/dcf.js';
import { computeThreeStatement } from '../lib/engine/threeStatement.js';
import { computeLbo, lboHoldSensitivity } from '../lib/engine/lbo.js';
import { computeComps } from '../lib/engine/comps.js';
import { computePrecedent } from '../lib/engine/precedent.js';
import { computeIpo } from '../lib/engine/ipo.js';
import { computeRegression } from '../lib/engine/regression.js';
import { fmtPct, fmtX, fmtNum, fmtPrice, CURRENCIES, UNITS } from '../lib/format.js';
import { periodLabels } from '../lib/period.js';

const pctl = (arr, q) => {
  const s = [...arr].filter(isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const bar = (c, r = [5, 5, 0, 0]) => ({ color: vgrad(c), borderRadius: r });
const lineS = (c, { area = false, smooth = true, width = 2.6, symbol = false } = {}) => ({
  type: 'line', smooth, showSymbol: symbol, symbolSize: 7,
  lineStyle: { width, color: c }, itemStyle: { color: c },
  ...(area ? { areaStyle: { color: agrad(c) } } : {}),
});
/* Click-to-assumption targets: which dock sliders a chart's series answer to. */
const D_GROWTH = { labels: ['Revenue growth — Year 1'], section: 'Operating Drivers' };
const D_MARGIN = { labels: ['EBITDA margin — Year 1'], section: 'Operating Drivers' };
const D_TV = { labels: ['Terminal growth', 'Exit EV/EBITDA (DCF)'], section: 'Key Levers' };
const D_WACC = { labels: ['Equity risk premium'], section: 'Cost of Capital (WACC)' };
const D_LBO = { labels: ['LBO entry multiple'], section: 'Key Levers' };
const D_BAL = { labels: ['Gross debt', 'Cash & equivalents'], section: 'Company & Market' };

/* Each chart: { id, group, title(ctx), zoom?, build(ctx) -> ECharts option,
   scen?: series names that get Bear/Bull ghost overlays,
   sync?: shares the gallery crosshair (year-axis charts only),
   drill?: click target — an assumption descriptor or (params) => descriptor }. */
const CHARTS = [
  {
    id: 'revenue_ebitda', group: 'Operating', title: (c) => `Revenue & EBITDA (${c.unitLabel}) with margin %`,
    scen: ['EBITDA'], sync: true,
    drill: (p) => (p.seriesName === 'Revenue' ? D_GROWTH : D_MARGIN),
    build: (c) => themed({
      tooltip: tipBy({ Margin: c.pctF }, c.numF),
      xAxis: xCat(c.yearLabels),
      yAxis: [yVal({ axisLabel: { color: COL.axis, formatter: c.short } }), yVal({ position: 'right', splitLine: { show: false }, axisLabel: { color: COL.gold, formatter: '{value}%' } })],
      series: [
        { name: 'Revenue', type: 'bar', barMaxWidth: 30, itemStyle: bar(COL.tealDeep), data: c.ops.revenue.map(Math.round) },
        { name: 'EBITDA', type: 'bar', barMaxWidth: 30, itemStyle: bar(COL.teal), data: c.ops.ebitda.map(Math.round) },
        { name: 'Margin', yAxisIndex: 1, ...lineS(COL.gold, { symbol: true }), data: c.ops.margin.map((v) => +v.toFixed(2)) },
      ],
    }),
  },
  {
    id: 'growth_bars', group: 'Operating', title: () => 'Revenue growth % by year',
    scen: ['Growth'], sync: true, drill: D_GROWTH,
    build: (c) => themed({
      tooltip: tipBy({}, c.pctF),
      xAxis: xCat(c.yearLabels), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: '{value}%' } }),
      series: [{ name: 'Growth', type: 'bar', barMaxWidth: 46, itemStyle: bar(COL.green), label: { show: true, position: 'top', color: COL.axisStrong, fontFamily: 'Inter, sans-serif', fontSize: 10, formatter: (p) => `${p.value}%` }, data: c.ops.growth.map((v) => +v.toFixed(2)) }],
    }),
  },
  {
    id: 'margins_trend', group: 'Operating', title: () => 'Margin ladder — EBITDA / EBIT / net %',
    scen: ['EBITDA'], sync: true, drill: D_MARGIN,
    build: (c) => {
      const avg = c.ops.margin.reduce((x, v) => x + v, 0) / c.ops.n;
      return themed({
      tooltip: tipBy({}, c.pctF),
      xAxis: xCat(c.yearLabels, { boundaryGap: false }), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: '{value}%' } }),
      series: [
        { name: 'EBITDA', ...lineS(COL.teal, { area: true, symbol: true }), markLine: refMarkLine([{ yAxis: +avg.toFixed(2), label: { formatter: `avg ${avg.toFixed(1)}%`, position: 'insideEndTop' } }]), data: c.ops.margin.map((v) => +v.toFixed(2)) },
        { name: 'EBIT', ...lineS(COL.gold, { symbol: true }), data: c.ops.ebit.map((e, i) => +((e / c.ops.revenue[i]) * 100).toFixed(2)) },
        { name: 'Net', ...lineS(COL.green, { symbol: true }), data: c.ts.netIncome.map((n, i) => +((n / c.ops.revenue[i]) * 100).toFixed(2)) },
      ],
      });
    },
  },
  {
    id: 'fcf_conversion', group: 'Operating', title: (c) => `Cash conversion — EBITDA → FCFF (${c.unitLabel}) & FCFF/EBITDA %`,
    scen: ['FCFF'], sync: true,
    drill: { labels: ['EBITDA margin — Year 1', 'Capex (% of revenue)'], section: 'Operating Drivers' },
    build: (c) => themed({
      tooltip: tipBy({ 'FCFF/EBITDA': c.pctF }, c.numF),
      xAxis: xCat(c.yearLabels),
      yAxis: [yVal({ axisLabel: { color: COL.axis, formatter: c.short } }), yVal({ position: 'right', splitLine: { show: false }, axisLabel: { color: COL.gold, formatter: '{value}%' } })],
      series: [
        { name: 'EBITDA', type: 'bar', barMaxWidth: 30, itemStyle: bar(COL.tealDeep), data: c.ops.ebitda.map(Math.round) },
        { name: 'FCFF', type: 'bar', barMaxWidth: 30, itemStyle: bar(COL.teal), data: c.dcf.fcff.map(Math.round) },
        { name: 'FCFF/EBITDA', yAxisIndex: 1, ...lineS(COL.gold, { symbol: true }), data: c.dcf.fcff.map((f, i) => (c.ops.ebitda[i] > 0 ? +((f / c.ops.ebitda[i]) * 100).toFixed(1) : null)) },
      ],
    }),
  },
  {
    id: 'fcf_build', group: 'DCF', title: (c) => `FCFF build by year (${c.unitLabel}) — NOPAT + D&A − capex − ΔNWC`,
    scen: ['FCFF'], sync: true,
    drill: (p) => ({
      labels: { 'D&A': ['D&A (% of revenue)'], Capex: ['Capex (% of revenue)'], 'Δ NWC': ['NWC (% of revenue)'] }[p.seriesName] || ['EBITDA margin — Year 1'],
      section: 'Operating Drivers',
    }),
    build: (c) => themed({
      tooltip: { ...tipBy({}, c.numF), axisPointer: { type: 'shadow' } },
      xAxis: xCat(c.yearLabels), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: c.short } }),
      series: [
        { name: 'NOPAT', type: 'bar', stack: 'f', itemStyle: { color: vgrad(COL.tealDeep) }, data: c.dcf.nopat.map(Math.round) },
        { name: 'D&A', type: 'bar', stack: 'f', itemStyle: { color: vgrad(COL.teal) }, data: c.ops.da.map(Math.round) },
        { name: 'Capex', type: 'bar', stack: 'f', itemStyle: { color: vgrad(COL.outflow) }, data: c.ops.capex.map((v) => -Math.round(v)) },
        { name: 'Δ NWC', type: 'bar', stack: 'f', itemStyle: { color: vgrad(COL.outflow2) }, data: c.ops.deltaNwc.map((v) => -Math.round(v)) },
        { name: 'FCFF', ...lineS(COL.green, { symbol: true }), data: c.dcf.fcff.map(Math.round) },
      ],
    }),
  },
  {
    id: 'pv_fcf', group: 'DCF', title: (c) => `PV of FCFF by year + terminal value (${c.unitLabel})`,
    sync: true, drill: D_TV,
    build: (c) => themed({
      tooltip: { ...tipBy({}, c.numF), axisPointer: { type: 'shadow' } },
      xAxis: xCat([...c.yearLabels, 'TV']), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: c.short } }),
      series: [
        { name: 'PV of FCFF', type: 'bar', barMaxWidth: 46, itemStyle: bar(COL.teal), data: [...c.dcf.pv.map(Math.round), '-'] },
        { name: 'PV of TV', type: 'bar', barMaxWidth: 46, itemStyle: bar(COL.gold), data: [...c.dcf.pv.map(() => '-'), Math.round(c.primaryPvTv)] },
      ],
    }),
  },
  {
    id: 'pv_contribution', group: 'DCF', title: () => 'PV contribution to enterprise value (% of EV)',
    sync: true, drill: D_TV,
    build: (c) => {
      const ev = c.dcf.pvSum + c.primaryPvTv;
      const data = [...c.dcf.pv.map((v) => (ev > 0 ? +((v / ev) * 100).toFixed(1) : 0)), ev > 0 ? +((c.primaryPvTv / ev) * 100).toFixed(1) : 0];
      return themed({
        tooltip: { ...tipBy({}, c.pctF), axisPointer: { type: 'shadow' } },
        xAxis: xCat([...c.yearLabels, 'TV']), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: '{value}%' } }),
        series: [{ name: 'Share of EV', type: 'bar', barMaxWidth: 46, label: { show: true, position: 'top', color: COL.axisStrong, fontFamily: 'Inter, sans-serif', fontSize: 10, formatter: (p) => `${p.value}%` }, itemStyle: { color: (p) => vgrad(p.dataIndex === data.length - 1 ? COL.gold : COL.teal), borderRadius: [5, 5, 0, 0] }, data }],
      });
    },
  },
  {
    id: 'ev_split', group: 'DCF', title: (c) => `Enterprise value split — explicit FCFF vs terminal (${c.primaryLabel})`,
    drill: D_TV,
    build: (c) => themed({
      tooltip: tipItem(c.numF), legend: { show: false },
      series: [{
        type: 'pie', radius: ['52%', '74%'], center: ['50%', '54%'], padAngle: 3, itemStyle: { borderRadius: 6, borderColor: '#161B25', borderWidth: 2 },
        label: { color: COL.axisStrong, formatter: '{b}\n{d}%', fontSize: 11 }, labelLine: { lineStyle: { color: COL.axis } },
        data: [
          { name: 'PV of explicit FCFF', value: Math.max(0, Math.round(c.dcf.pvSum)), itemStyle: { color: vgrad(COL.teal) } },
          { name: 'PV of terminal value', value: Math.max(0, Math.round(c.primaryPvTv)), itemStyle: { color: vgrad(COL.gold) } },
        ],
      }],
    }),
  },
  {
    id: 'price_vs_wacc', group: 'DCF', zoom: true, title: (c) => `Implied share price vs WACC (${c.cur})`,
    scen: ['Gordon'], drill: D_WACC,
    build: (c) => {
      const g = c.am.dcf.terminalGrowth, w = c.dcf.wacc, gordon = [], exit = [];
      for (let d = -2; d <= 2.001; d += 0.1) {
        const x = +(w + d).toFixed(2);
        gordon.push([x, Math.round(dcfPriceWaccGrowth(c.am, c.ops, x, g))]);
        exit.push([x, Math.round(dcfPriceWaccExit(c.am, c.ops, x, c.am.dcf.exitMultiple))]);
      }
      const px = c.am.company.currentPrice;
      return themed({
        tooltip: { ...tipBy({}, c.numF), axisPointer: { type: 'cross', label: { formatter: (p) => (p.axisDimension === 'x' ? `${(+p.value).toFixed(2)}%` : c.num(+p.value)) } } },
        xAxis: yVal({ name: 'WACC', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: COL.axis }, axisLabel: { color: COL.axis, formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } }),
        yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: c.short } }),
        series: [
          { name: 'Gordon', ...lineS(COL.teal), data: gordon, markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.ref, type: 'dashed' }, label: { color: COL.ref, fontSize: 11 }, data: [{ xAxis: +w.toFixed(2), label: { formatter: 'base WACC' } }, ...(px > 0 ? [{ yAxis: px, lineStyle: { color: COL.amber }, label: { formatter: `mkt ${c.num(px)}`, color: COL.amber } }] : [])] } },
          { name: 'Exit multiple', ...lineS(COL.gold), data: exit },
        ],
      }, { zoom: true });
    },
  },
  {
    id: 'price_vs_growth', group: 'DCF', zoom: true, title: (c) => `Implied share price vs terminal growth (${c.cur}), at WACC ±1pp`,
    drill: { labels: ['Terminal growth'], section: 'Key Levers' },
    build: (c) => {
      const g0 = c.am.dcf.terminalGrowth, w = c.dcf.wacc, px = c.am.company.currentPrice;
      const lo = [], mid = [], hi = [];
      for (let g = Math.max(0, g0 - 2); g <= g0 + 2.001; g += 0.1) {
        const x = +g.toFixed(2);
        lo.push([x, Math.round(dcfPriceWaccGrowth(c.am, c.ops, w + 1, g))]);
        mid.push([x, Math.round(dcfPriceWaccGrowth(c.am, c.ops, w, g))]);
        hi.push([x, Math.round(dcfPriceWaccGrowth(c.am, c.ops, w - 1, g))]);
      }
      return themed({
        tooltip: { ...tipBy({}, c.numF), axisPointer: { type: 'cross', label: { formatter: (p) => (p.axisDimension === 'x' ? `${(+p.value).toFixed(2)}%` : c.num(+p.value)) } } },
        xAxis: yVal({ name: 'terminal g', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: COL.axis }, axisLabel: { color: COL.axis, formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } }),
        yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: c.short } }),
        series: [
          { name: `WACC ${fmtPct(w + 1, 1)}`, ...lineS(COL.gold), data: lo },
          { name: `WACC ${fmtPct(w, 1)}`, ...lineS(COL.teal), data: mid, markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.ref, type: 'dashed' }, label: { color: COL.ref, fontSize: 11, formatter: 'base g' }, data: [{ xAxis: +g0.toFixed(2) }, ...(px > 0 ? [{ yAxis: px, lineStyle: { color: COL.amber }, label: { formatter: `mkt ${c.num(px)}`, color: COL.amber } }] : [])] } },
          { name: `WACC ${fmtPct(w - 1, 1)}`, ...lineS(COL.green), data: hi },
        ],
      }, { zoom: true });
    },
  },
  {
    id: 'cum_fcf', group: 'DCF', title: (c) => `Cumulative FCFF vs cumulative PV (${c.unitLabel})`,
    scen: ['Cumulative PV'], sync: true, drill: D_MARGIN,
    build: (c) => {
      let cf = 0, cp = 0; const a = [], b = [];
      c.ops.revenue.forEach((_, i) => { cf += c.dcf.fcff[i]; cp += c.dcf.pv[i]; a.push(Math.round(cf)); b.push(Math.round(cp)); });
      const be = a.findIndex((v, i) => i > 0 && a[i - 1] < 0 && v >= 0); // cash-flow breakeven year, if any
      return themed({
        tooltip: tipBy({}, c.numF),
        xAxis: xCat(c.yearLabels, { boundaryGap: false }), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: c.short } }),
        series: [
          { name: 'Cumulative FCFF', ...lineS(COL.teal, { area: true, symbol: true }), ...(be > 0 ? { markPoint: { silent: true, symbol: 'circle', symbolSize: 9, itemStyle: { color: COL.gold, borderColor: '#161B25', borderWidth: 2 }, label: { show: true, formatter: 'breakeven', color: COL.gold, fontSize: 10, position: 'top', fontFamily: 'Inter, sans-serif' }, data: [{ coord: [c.yearLabels[be], a[be]] }] } } : {}), data: a },
          { name: 'Cumulative PV', ...lineS(COL.green, { area: true, symbol: true }), data: b },
        ],
      });
    },
  },
  {
    id: 'dcf_tornado', group: 'DCF', title: (c) => `DCF sensitivity tornado — Gordon price (${c.cur})`,
    drill: (p) => ({
      labels: {
        'WACC ±1pp': ['Equity risk premium'], 'Terminal g ±1pp': ['Terminal growth'],
        'EBITDA margin ±1pp': ['EBITDA margin — Year 1'], 'Revenue growth ±1pp': ['Revenue growth — Year 1'],
        'Capex ±1pp rev': ['Capex (% of revenue)'], 'Tax rate ±1pp': ['Tax rate'],
      }[p.name] || ['Terminal growth'],
      section: 'Key Levers',
    }),
    build: (c) => {
      const w = c.dcf.wacc, g = c.am.dcf.terminalGrowth, base = c.dcf.gordon.price;
      // Perturb the PROJECTED operations directly (not the scalar fade inputs):
      // projectOperations ignores marginStart/capexPct etc. whenever a per-year
      // grid is active, so input-bumping silently collapses to zero sensitivity
      // the moment any statement cell is edited. Operating on ops is exact in
      // both modes and gives identical results with or without the grid.
      const o = c.ops;
      const priceOps = (ops) => computeDcf(c.am, ops).gordon.price;
      const marginOps = (d) => ({ ...o,                       // ±d pp of EBITDA margin
        ebitda: o.ebitda.map((e, i) => e + (d / 100) * o.revenue[i]),
        ebit: o.ebit.map((e, i) => e + (d / 100) * o.revenue[i]) });
      const capexOps = (d) => ({ ...o,                        // ±d pp of revenue on capex
        capex: o.capex.map((cx, i) => cx + (d / 100) * o.revenue[i]) });
      const growthOps = (d) => {                              // ±d pp on every year's growth
        const rev = []; let prev = o.revenue0;
        for (let i = 0; i < o.n; i++) { prev *= 1 + (o.growth[i] + d) / 100; rev.push(prev); }
        const f = rev.map((r, i) => (o.revenue[i] ? r / o.revenue[i] : 1));
        const nwcBalance = o.nwcBalance.map((v, i) => v * f[i]);
        return { ...o, revenue: rev,
          ebitda: o.ebitda.map((v, i) => v * f[i]), da: o.da.map((v, i) => v * f[i]),
          ebit: o.ebit.map((v, i) => v * f[i]), capex: o.capex.map((v, i) => v * f[i]),
          nwcBalance, deltaNwc: nwcBalance.map((v, i) => v - (i === 0 ? o.nwc0 : nwcBalance[i - 1])) };
      };
      const taxPrice = (d) => { const m = structuredClone(c.am); m.company.taxRate += d; return computeDcf(m, o).gordon.price; };
      let rows = [
        { name: 'WACC ±1pp', a: dcfPriceWaccGrowth(c.am, c.ops, w + 1, g), b: dcfPriceWaccGrowth(c.am, c.ops, w - 1, g) },
        { name: 'Terminal g ±1pp', a: dcfPriceWaccGrowth(c.am, c.ops, w, Math.max(0, g - 1)), b: dcfPriceWaccGrowth(c.am, c.ops, w, g + 1) },
        { name: 'EBITDA margin ±1pp', a: priceOps(marginOps(-1)), b: priceOps(marginOps(1)) },
        { name: 'Revenue growth ±1pp', a: priceOps(growthOps(-1)), b: priceOps(growthOps(1)) },
        { name: 'Capex ±1pp rev', a: priceOps(capexOps(1)), b: priceOps(capexOps(-1)) },
        { name: 'Tax rate ±1pp', a: taxPrice(1), b: taxPrice(-1) },
      ].map((r) => ({ name: r.name, lo: Math.min(r.a, r.b), hi: Math.max(r.a, r.b) }))
        .sort((x, y) => (x.hi - x.lo) - (y.hi - y.lo)); // smallest first → biggest on top
      const pad = rows.map((r) => Math.round(r.lo));
      const down = rows.map((r) => Math.round(Math.min(r.hi, base) - r.lo));
      const up = rows.map((r) => Math.round(r.hi - Math.min(r.hi, base)));
      return themed({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, textStyle: { color: COL.text }, extraCssText: 'border-radius:11px;box-shadow:0 18px 50px rgba(0,0,0,0.6);backdrop-filter:blur(10px);', formatter: (ps) => { const r = rows.find((x) => x.name === ps[0].name); return `<div style="font-weight:700;color:#AAB4C5;font-size:11px;margin-bottom:4px">${ps[0].name}</div><div style="font-family:Inter,sans-serif">${c.num(r.lo)} → ${c.num(r.hi)}<br>range ${c.num(r.hi - r.lo)}</div>`; } },
        legend: { show: false }, grid: { left: 8, right: 24, top: 24, bottom: 14, containLabel: true },
        xAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: c.short }, name: c.cur, nameTextStyle: { color: COL.axis }, nameLocation: 'middle', nameGap: 26 }),
        yAxis: xCat(rows.map((r) => r.name), { axisLabel: { color: COL.axisStrong, fontFamily: 'Inter', fontSize: 11.5 } }),
        series: [
          { name: 'pad', type: 'bar', stack: 't', itemStyle: { color: 'transparent' }, data: pad, silent: true },
          { name: 'downside', type: 'bar', stack: 't', itemStyle: { color: vgrad(COL.outflow2) }, data: down },
          { name: 'upside', type: 'bar', stack: 't', itemStyle: { color: vgrad(COL.green) }, data: up, markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.gold, type: 'dashed', width: 1.4 }, label: { formatter: `base ${c.num(base)}`, color: COL.gold, fontSize: 11, position: 'insideEndTop' }, data: [{ xAxis: Math.round(base) }] } },
        ],
      });
    },
  },
  {
    id: 'debt_paydown', group: 'LBO', title: (c) => `LBO debt paydown & cash build (${c.unitLabel})`,
    scen: ['Cash'], sync: true, drill: D_LBO,
    build: (c) => themed({
      tooltip: tipBy({}, c.numF),
      xAxis: xCat(c.yearLabels, { boundaryGap: false }), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: c.short } }),
      series: [
        { name: 'Senior', type: 'line', stack: 'd', smooth: true, showSymbol: false, lineStyle: { color: COL.rose, width: 2 }, itemStyle: { color: COL.rose }, areaStyle: { color: agrad(COL.rose) }, data: c.lbo.closeSenior.map(Math.round) },
        { name: 'Mezzanine', type: 'line', stack: 'd', smooth: true, showSymbol: false, lineStyle: { color: COL.violet, width: 2 }, itemStyle: { color: COL.violet }, areaStyle: { color: agrad(COL.violet) }, data: c.lbo.closeMezz.map(Math.round) },
        { name: 'Cash', ...lineS(COL.green, { area: true }), ...(c.am.lbo.minCash > 0 ? { markLine: refMarkLine([{ yAxis: Math.round(c.am.lbo.minCash), label: { formatter: 'cash floor', position: 'insideEndTop' } }]) } : {}), data: c.lbo.cashBal.map(Math.round) },
      ],
    }),
  },
  {
    id: 'credit_stats', group: 'LBO', title: () => 'Credit statistics — net leverage (×) & interest coverage (×)',
    scen: ['Net debt / EBITDA'], sync: true, drill: D_LBO,
    build: (c) => themed({
      tooltip: { ...tipBy({}, c.xF), axisPointer: { type: 'shadow' } },
      xAxis: xCat(c.yearLabels),
      yAxis: [yVal({ axisLabel: { color: COL.axis, formatter: '{value}x' } }), yVal({ position: 'right', splitLine: { show: false }, axisLabel: { color: COL.green, formatter: '{value}x' } })],
      series: [
        { name: 'Net debt / EBITDA', type: 'bar', barMaxWidth: 40, itemStyle: bar(COL.outflow), data: c.lbo.levNet.map((v) => +v.toFixed(2)) },
        { name: 'Coverage', yAxisIndex: 1, ...lineS(COL.green, { symbol: true }), data: c.lbo.coverage.map((v) => (isFinite(v) ? +v.toFixed(2) : null)) },
      ],
    }),
  },
  {
    id: 'irr_by_exit', group: 'LBO', zoom: true, title: () => 'Sponsor IRR vs exit multiple, by holding period',
    drill: D_LBO,
    build: (c) => {
      const h = c.hsens;
      const entry = c.am.lbo.entryMultiple;
      const ei = h.exitSteps.reduce((b, x, i) => (Math.abs(x - entry) < Math.abs(h.exitSteps[b] - entry) ? i : b), 0);
      return themed({
        tooltip: tipBy({}, c.pctF),
        xAxis: xCat(h.exitSteps.map((x) => fmtX(x, 2))), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: '{value}%' } }),
        series: h.years.map((y, i) => ({ name: `${y}y hold`, ...lineS(PALETTE[i % PALETTE.length], { symbol: true }), data: h.grid[i].map((v) => (isFinite(v) ? +v.toFixed(1) : null)),
          ...(i === 0 ? { markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.amber, type: 'dashed' }, label: { formatter: `hurdle ${fmtPct(c.am.lbo.hurdleRate, 0)}`, color: COL.amber, fontSize: 11 }, data: [{ yAxis: c.am.lbo.hurdleRate }, { xAxis: fmtX(h.exitSteps[ei], 2), lineStyle: { color: COL.ref }, label: { formatter: `entry ${fmtX(entry, 1)} — expansion →`, color: COL.ref } }] } } : {}) })),
      }, { zoom: true });
    },
  },
  {
    id: 'equity_growth', group: 'LBO', title: (c) => `Sponsor equity if exited each year (${c.unitLabel}) & MOIC`,
    scen: ['Exit equity'], sync: true, drill: D_LBO,
    build: (c) => themed({
      tooltip: tipBy({ MOIC: c.xF }, c.numF),
      xAxis: xCat(c.yearLabels),
      yAxis: [yVal({ axisLabel: { color: COL.axis, formatter: c.short } }), yVal({ position: 'right', splitLine: { show: false }, axisLabel: { color: COL.gold, formatter: '{value}x' } })],
      series: [
        { name: 'Exit equity', type: 'bar', barMaxWidth: 40, itemStyle: bar(COL.teal), markLine: refMarkLine([{ xAxis: c.yearLabels[c.am.lbo.exitYear - 1], label: { formatter: 'exit' } }]), data: c.ops.revenue.map((_, i) => Math.round(c.am.lbo.exitMultiple * c.ops.ebitda[i] - (c.lbo.closeSenior[i] + c.lbo.closeMezz[i] - c.lbo.cashBal[i]))) },
        { name: 'MOIC', yAxisIndex: 1, ...lineS(COL.gold, { symbol: true }), data: c.ops.revenue.map((_, i) => { const eq = c.am.lbo.exitMultiple * c.ops.ebitda[i] - (c.lbo.closeSenior[i] + c.lbo.closeMezz[i] - c.lbo.cashBal[i]); return c.lbo.sponsorEquity > 0 ? +(eq / c.lbo.sponsorEquity).toFixed(2) : null; }) },
      ],
    }),
  },
  {
    id: 'sources_uses', group: 'LBO', title: (c) => `Sources & uses at close (${c.unitLabel})`,
    drill: D_LBO,
    build: (c) => themed({
      tooltip: { ...tipBy({}, c.numF), axisPointer: { type: 'shadow' } },
      xAxis: xCat(['Uses', 'Sources']), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: c.short } }),
      series: [
        { name: 'Enterprise value', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.tealDeep) }, data: [Math.round(c.lbo.entryEV), '-'] },
        { name: 'Transaction fees', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.outflow) }, data: [Math.round(c.lbo.feesTxn), '-'] },
        { name: 'Financing fees', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.outflow2) }, data: [Math.round(c.lbo.feesFin), '-'] },
        { name: 'Senior debt', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.rose) }, data: ['-', Math.round(c.lbo.senior0)] },
        { name: 'Mezzanine', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.violet) }, data: ['-', Math.round(c.lbo.mezz0)] },
        { name: 'Sponsor equity', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.green) }, data: ['-', Math.round(c.lbo.sponsorEquity)] },
      ],
    }),
  },
  {
    id: 'value_bridge', group: 'LBO', title: (c) => `LBO value-creation bridge (${c.unitLabel})`,
    drill: D_LBO,
    build: (c) => {
      const b = c.lbo.bridge;
      const steps = [
        { name: 'Entry equity', val: b.entryEquity, total: true },
        { name: '− Fees', val: b.fees },
        { name: '+ EBITDA growth', val: b.ebitdaGrowth },
        { name: '± Multiple', val: b.multipleChange },
        { name: '+ Deleveraging', val: b.deleveraging },
        { name: 'Exit equity', val: b.exitEquity, total: true },
      ];
      let run = 0; const base = [], dn = [], up = [], tot = [];
      steps.forEach((s) => {
        if (s.total) { base.push(0); tot.push(Math.round(s.val)); up.push('-'); dn.push('-'); run = s.val; }
        else { const start = run, end = run + s.val; base.push(Math.round(Math.min(start, end))); tot.push('-'); if (s.val >= 0) { up.push(Math.round(s.val)); dn.push('-'); } else { dn.push(Math.round(-s.val)); up.push('-'); } run = end; }
      });
      return themed({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, textStyle: { color: COL.text }, extraCssText: 'border-radius:11px;box-shadow:0 18px 50px rgba(0,0,0,0.6);backdrop-filter:blur(10px);', formatter: (ps) => { const s = steps.find((x) => x.name === ps[0].name); return `<div style="font-weight:700;color:#AAB4C5;font-size:11px;margin-bottom:4px">${s.name}</div><div style="font-family:Inter,sans-serif">${c.num(s.val)}</div>`; } },
        legend: { show: false }, grid: { left: 8, right: 16, top: 22, bottom: 30, containLabel: true },
        xAxis: xCat(steps.map((s) => s.name), { axisLabel: { color: COL.axis, fontFamily: 'Inter', fontSize: 11, interval: 0, rotate: 14 } }),
        yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: c.short } }),
        series: [
          { name: 'base', type: 'bar', stack: 'w', itemStyle: { color: 'transparent' }, data: base, silent: true },
          { name: 'Increase', type: 'bar', stack: 'w', itemStyle: { color: vgrad(COL.green), borderRadius: [4, 4, 0, 0] }, data: up },
          { name: 'Decrease', type: 'bar', stack: 'w', itemStyle: { color: vgrad(COL.outflow2), borderRadius: [4, 4, 0, 0] }, data: dn },
          { name: 'Total', type: 'bar', stack: 'w', itemStyle: { color: vgrad(COL.teal), borderRadius: [4, 4, 0, 0] }, data: tot },
        ],
      });
    },
  },
  {
    id: 'cash_debt', group: '3-Statement', title: (c) => `Closing cash vs debt (${c.unitLabel})`,
    scen: ['Cash'], sync: true, drill: D_BAL,
    build: (c) => themed({
      tooltip: { ...tipBy({}, c.numF), axisPointer: { type: 'shadow' } },
      xAxis: xCat(c.yearLabels), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: c.short } }),
      series: [
        { name: 'Net income', type: 'bar', barMaxWidth: 36, itemStyle: bar(COL.tealDeep), data: c.ts.netIncome.map(Math.round) },
        { name: 'Cash', ...lineS(COL.green, { symbol: true }), data: c.ts.closeCash.map(Math.round) },
        { name: 'Debt', ...lineS(COL.red, { symbol: true }), data: c.ts.closeDebt.map(Math.round) },
      ],
    }),
  },
  {
    id: 'bs_composition', group: '3-Statement', title: (c) => `Balance sheet build — assets (${c.unitLabel})`,
    sync: true, drill: D_BAL,
    build: (c) => themed({
      tooltip: { ...tipBy({}, c.numF), axisPointer: { type: 'shadow' } },
      xAxis: xCat(c.yearLabels), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: c.short } }),
      series: [
        { name: 'Cash', type: 'bar', stack: 'a', itemStyle: { color: vgrad(COL.green) }, data: c.ts.closeCash.map(Math.round) },
        { name: 'NWC', type: 'bar', stack: 'a', itemStyle: { color: vgrad(COL.teal) }, data: c.ops.nwcBalance.map(Math.round) },
        { name: 'Net PP&E', type: 'bar', stack: 'a', itemStyle: { color: vgrad(COL.gold), borderRadius: [4, 4, 0, 0] }, data: c.ts.ppe.map(Math.round) },
      ],
    }),
  },
  {
    id: 'peer_multiples', group: 'Market', title: () => 'Peer EV/EBITDA vs median & quartile band',
    build: (c) => {
      const vals = c.comps.peers.map((p) => +Number(p.evEbitda).toFixed(2));
      const q1 = pctl(vals, 0.25), q3 = pctl(vals, 0.75), med = pctl(vals, 0.5);
      return themed({
        tooltip: { ...tipBy({}, c.xF), axisPointer: { type: 'shadow' } }, legend: { show: false },
        xAxis: xCat(c.comps.peers.map((p) => p.name), { axisLabel: { color: COL.axis, fontSize: 10.5, interval: 0, rotate: 12 } }),
        yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: '{value}x' } }),
        series: [{ name: 'EV/EBITDA', type: 'bar', barMaxWidth: 40, itemStyle: bar(COL.teal), data: vals,
          markArea: { silent: true, itemStyle: { color: 'rgba(108,140,255,0.09)' }, label: { show: true, position: 'insideTopLeft', color: COL.teal, fontSize: 10, formatter: 'Q1–Q3' }, data: [[{ yAxis: q1 }, { yAxis: q3 }]] },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.gold, type: 'dashed' }, label: { formatter: `median ${fmtX(med, 1)}`, color: COL.gold, fontSize: 11 }, data: [{ yAxis: med }] } }],
      });
    },
  },
  {
    id: 'deal_multiples', group: 'Market', title: () => 'Precedent deal EV/EBITDA by vintage',
    build: (c) => {
      const deals = [...c.am.precedent.deals].sort((x, y) => x.year - y.year);
      const vals = deals.map((d) => +Number(d.evEbitda).toFixed(2));
      const q1 = pctl(vals, 0.25), q3 = pctl(vals, 0.75), med = pctl(vals, 0.5);
      return themed({
        tooltip: { ...tipBy({}, c.xF), axisPointer: { type: 'shadow' } }, legend: { show: false },
        xAxis: xCat(deals.map((d) => `${d.year} · ${d.name.split('/')[0].trim()}`), { axisLabel: { color: COL.axis, fontSize: 10, interval: 0, rotate: 14 } }),
        yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: '{value}x' } }),
        series: [{ name: 'EV/EBITDA', type: 'bar', barMaxWidth: 38, itemStyle: bar(COL.amber), data: vals,
          markArea: { silent: true, itemStyle: { color: 'rgba(251,191,36,0.08)' }, data: [[{ yAxis: q1 }, { yAxis: q3 }]] },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.gold, type: 'dashed' }, label: { formatter: `median ${fmtX(med, 1)}`, color: COL.gold, fontSize: 11 }, data: [{ yAxis: med }] } }],
      });
    },
  },
  {
    id: 'comps_box', group: 'Market', title: () => 'Peer multiple distributions (box & whisker)',
    build: (c) => {
      const peers = c.comps.peers;
      const box = (key) => { const v = peers.map((p) => +Number(p[key])).filter(isFinite); return [Math.min(...v), pctl(v, 0.25), pctl(v, 0.5), pctl(v, 0.75), Math.max(...v)]; };
      return themed({
        tooltip: { trigger: 'item', backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, textStyle: { color: COL.text }, extraCssText: 'border-radius:11px;box-shadow:0 18px 50px rgba(0,0,0,0.6);backdrop-filter:blur(10px);', formatter: (p) => { const d = p.value; return Array.isArray(d) && d.length >= 6 ? `<div style="font-weight:700;color:#AAB4C5;font-size:11px;margin-bottom:4px">${p.name}</div><div style="font-family:Inter,sans-serif">max ${fmtX(d[5], 1)}<br>Q3 ${fmtX(d[4], 1)}<br>med ${fmtX(d[3], 1)}<br>Q1 ${fmtX(d[2], 1)}<br>min ${fmtX(d[1], 1)}</div>` : ''; } },
        legend: { show: false },
        xAxis: xCat(['EV/Sales', 'EV/EBITDA', 'P/E']), yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: '{value}x' } }),
        series: [{ type: 'boxplot', data: [box('evSales'), box('evEbitda'), box('pe')], itemStyle: { color: 'rgba(108,140,255,0.14)', borderColor: COL.teal, borderWidth: 1.6 }, emphasis: { itemStyle: { borderColor: COL.gold } } }],
      });
    },
  },
  {
    id: 'regression_scatter', group: 'Market', title: () => 'Regression — EV/EBITDA vs growth, with ±1σ band',
    build: (c) => {
      const r = c.reg;
      if (!r.ok) return themed({ title: { text: 'Need ≥3 peers with growth', left: 'center', top: 'middle', textStyle: { color: COL.axis, fontSize: 13 } }, xAxis: yVal(), yAxis: yVal() });
      const xs = [...r.pts.map((p) => p.x), r.targetGrowth];
      const lo = Math.min(...xs) - 1.5, hi = Math.max(...xs) + 1.5;
      return themed({
        tooltip: { trigger: 'item', backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, textStyle: { color: COL.text }, extraCssText: 'border-radius:11px;box-shadow:0 18px 50px rgba(0,0,0,0.6);backdrop-filter:blur(10px);', formatter: (p) => `<div style="font-family:Inter,sans-serif">${p.seriesName}<br>growth ${fmtPct(p.value[0], 1)} → ${fmtX(p.value[1], 2)}</div>` },
        legend: { top: 6, data: ['Peers', 'Target', 'Fitted'], textStyle: { color: COL.axis } },
        xAxis: yVal({ scale: true, name: 'growth %', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: COL.axis }, axisLabel: { color: COL.axis, formatter: '{value}%' } }),
        yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: '{value}x' } }),
        series: [
          { name: '+1σ', type: 'line', data: [[lo, +(r.line(lo) + r.se).toFixed(2)], [hi, +(r.line(hi) + r.se).toFixed(2)]], lineStyle: { color: COL.teal, opacity: 0.35, type: 'dotted' }, symbol: 'none', silent: true, tooltip: { show: false } },
          { name: '−1σ', type: 'line', data: [[lo, +(r.line(lo) - r.se).toFixed(2)], [hi, +(r.line(hi) - r.se).toFixed(2)]], lineStyle: { color: COL.teal, opacity: 0.35, type: 'dotted' }, symbol: 'none', silent: true, tooltip: { show: false } },
          { name: 'Fitted', type: 'line', data: [[lo, +r.line(lo).toFixed(2)], [hi, +r.line(hi).toFixed(2)]], lineStyle: { color: COL.gold, width: 2.4, type: 'dashed' }, symbol: 'none' },
          { name: 'Peers', type: 'scatter', symbolSize: 11, itemStyle: { color: COL.teal }, data: r.pts.map((p) => [p.x, p.y]) },
          { name: 'Target', type: 'scatter', symbol: 'diamond', symbolSize: 18, itemStyle: { color: COL.green, borderColor: '#161B25', borderWidth: 2 }, data: [[r.targetGrowth, +r.impliedMultiple.toFixed(2)]] },
        ],
      });
    },
  },
  {
    id: 'premia_dist', group: 'Market', title: () => 'Precedent 1-day premia by deal vs median',
    build: (c) => {
      const deals = [...c.am.precedent.deals].sort((x, y) => x.year - y.year);
      return themed({
        tooltip: { ...tipBy({}, (v) => fmtPct(v, 0)), axisPointer: { type: 'shadow' } }, legend: { show: false },
        xAxis: xCat(deals.map((d) => `${d.year}`)), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: '{value}%' } }),
        series: [{ name: 'Premium', type: 'bar', barMaxWidth: 44, itemStyle: bar(COL.rose), label: { show: true, position: 'top', color: COL.axisStrong, fontFamily: 'Inter, sans-serif', fontSize: 10, formatter: (p) => `${p.value}%` }, data: deals.map((d) => +Number(d.premium).toFixed(1)),
          markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.gold, type: 'dashed' }, label: { formatter: `median ${fmtPct(c.prec.premia.median, 0)}`, color: COL.gold, fontSize: 11 }, data: [{ yAxis: c.prec.premia.median }] } }],
      });
    },
  },
  {
    id: 'eps_bridge', group: 'Market', title: (c) => `IPO pro-forma EPS — pre vs post (${c.cur})`,
    build: (c) => themed({
      tooltip: { ...tipBy({}, (v) => fmtPrice(v, c.am.settings)), axisPointer: { type: 'shadow' } }, legend: { show: false },
      xAxis: xCat(['Pre-IPO', 'Post-IPO']), yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: c.short } }),
      series: [{ name: 'EPS', type: 'bar', barMaxWidth: 90, label: { show: true, position: 'top', color: COL.axisStrong, fontFamily: 'Inter, sans-serif', fontSize: 11, formatter: (p) => fmtPrice(p.value, c.am.settings) }, itemStyle: { color: (p) => vgrad(p.dataIndex === 0 ? COL.teal : COL.gold), borderRadius: [5, 5, 0, 0] }, data: [+c.ipo.epsPre.toFixed(2), +c.ipo.epsPost.toFixed(2)] }],
    }),
  },
  {
    id: 'ipo_ownership', group: 'Market', title: () => 'Ownership — pre-IPO vs post-IPO',
    build: (c) => {
      const ringS = (name, center, data) => ({ name, type: 'pie', radius: ['44%', '64%'], center, padAngle: 3, itemStyle: { borderRadius: 6, borderColor: '#161B25', borderWidth: 2 }, label: { color: COL.axisStrong, formatter: (p) => (p.value > 0 ? `${p.percent}%` : ''), fontSize: 11 }, labelLine: { show: false }, data });
      const slices = (existPct, newPct) => [
        { name: 'Existing holders', value: existPct, itemStyle: { color: vgrad(COL.teal) } },
        { name: 'New investors (free float)', value: newPct, itemStyle: { color: vgrad(COL.rose) } },
      ];
      return themed({
        tooltip: tipItem((v) => fmtPct(v, 1)),
        legend: { bottom: 2, textStyle: { color: COL.axis } },
        title: [
          { text: 'Pre-IPO', left: '25%', top: '8%', textAlign: 'center', textStyle: { color: COL.axisStrong, fontSize: 13, fontWeight: 600 } },
          { text: 'Post-IPO', left: '75%', top: '8%', textAlign: 'center', textStyle: { color: COL.axisStrong, fontSize: 13, fontWeight: 600 } },
        ],
        series: [
          ringS('Pre-IPO', ['25%', '54%'], slices(100, 0)),
          ringS('Post-IPO', ['75%', '54%'], slices(+(c.ipo.existingPost * 100).toFixed(1), +(c.ipo.freeFloat * 100).toFixed(1))),
        ],
      });
    },
  },
];

const DEFAULT_SEL = ['revenue_ebitda', 'fcf_build', 'dcf_tornado', 'debt_paydown', 'value_bridge', 'comps_box'];
const GROUPS = ['Operating', 'DCF', 'LBO', '3-Statement', 'Market'];

/** Everything a chart builder needs, for the active scenario or (scenKey) an overlay one. */
function buildCtx(a, scenKey) {
  const am = applyScenario(scenKey ? { ...a, settings: { ...a.settings, scenario: scenKey } } : a);
  const ops = projectOperations(am);
  const dcf = computeDcf(am, ops);
  const ts = computeThreeStatement(am, ops);
  const lbo = computeLbo(am, ops);
  const s = a.settings;
  const locale = CURRENCIES[s.currency].locale;
  const num = (v) => fmtNum(v, 0, locale);
  return {
    am, ops, dcf, ts, lbo,
    comps: computeComps(am), prec: computePrecedent(am), ipo: computeIpo(am), reg: computeRegression(am),
    hsens: lboHoldSensitivity(am),
    yearLabels: periodLabels(a.settings, 'Y', ops.n),
    num, numF: (v) => num(v),
    short: (v) => fmtNum(Math.abs(v) >= 1000 ? v / 1000 : v, Math.abs(v) >= 1000 ? 1 : 0, locale) + (Math.abs(v) >= 1000 ? 'k' : ''),
    pctF: (v) => fmtPct(v, 1), xF: (v) => fmtX(v, 2),
    cur: CURRENCIES[s.currency].symbol,
    unitLabel: `${CURRENCIES[s.currency].symbol} ${UNITS[s.unit]}`,
    primaryPvTv: am.dcf.primaryTV === 'exit' ? dcf.pvTvExit : dcf.pvTvGordon,
    primaryLabel: am.dcf.primaryTV === 'exit' ? 'exit multiple' : 'Gordon',
  };
}

/** Base option + dashed Bear/Bull (and Base, in a scenario view) ghost lines for flagged series. */
function buildOption(ch, ctx, scenCtxs) {
  const opt = ch.build(ctx);
  if (!ch.scen || !scenCtxs.length) return opt;
  for (const [k, cK] of scenCtxs) {
    const oK = ch.build(cK);
    for (const nm of ch.scen) {
      const sK = (oK.series || []).find((s) => s.name === nm);
      if (!sK || !(opt.series || []).some((s) => s.name === nm)) continue;
      const label = ch.scen.length > 1 ? `${SCENARIOS[k].label} · ${nm}` : SCENARIOS[k].label;
      opt.series.push(scenGhostSeries(k, label, sK.data, { yAxisIndex: sK.yAxisIndex || 0 }));
    }
  }
  return opt;
}

export default function ChartsTab({ a, set }) {
  const scenario = a.settings.scenario || 'base';
  const scenOn = a.settings.scenOverlay ?? true;
  const ctx = useMemo(() => buildCtx(a), [a]);
  const scenCtxs = useMemo(
    () => (scenOn ? Object.keys(SCENARIOS).filter((k) => k !== scenario).map((k) => [k, buildCtx(a, k)]) : []),
    [a, scenario, scenOn],
  );

  const sel = a.settings.chartSel || DEFAULT_SEL;
  const [focus, setFocus] = useState(null);
  const toggle = (id) => set('settings.chartSel', sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const setGroup = (g, on) => {
    const ids = CHARTS.filter((c) => c.group === g).map((c) => c.id);
    set('settings.chartSel', on ? [...new Set([...sel, ...ids])] : sel.filter((x) => !ids.includes(x)));
  };
  const showAll = () => set('settings.chartSel', CHARTS.map((c) => c.id));
  const clearAll = () => set('settings.chartSel', []);

  useEffect(() => {
    if (!focus) return;
    const onKey = (e) => e.key === 'Escape' && setFocus(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focus]);

  const active = CHARTS.filter((ch) => sel.includes(ch.id));
  const focusChart = focus ? CHARTS.find((c) => c.id === focus) : null;

  return (
    <div className="view" style={{ maxWidth: 1480 }}>
        <Hero
          eyebrow="Chart gallery — interactive & live"
          value={active.length}
          fmt={(v) => `${Math.round(v)} charts`}
          sub="Focus ⤢ opens any chart full-screen with zoom & a data-table view; clicking a bar or line jumps to the assumption behind it. Dashed Bear/Bull ghosts show the scenario range, year-axis charts share a crosshair, and everything re-draws live as assumptions change."
          chips={[
            { label: 'in view', text: `${active.length} / ${CHARTS.length}` },
            ...GROUPS.map((g) => ({ label: g, text: `${CHARTS.filter((c) => c.group === g && sel.includes(c.id)).length}/${CHARTS.filter((c) => c.group === g).length}` })),
          ]}
        />

        <div className="chart-picker">
          <div className="chart-picker-head">
            <span className="cph-title">Chart library</span>
            <span className="cph-count">{active.length} of {CHARTS.length} shown</span>
            <div className="cph-actions">
              <button className="pyfill" onClick={() => set('settings.scenOverlay', !scenOn)} title="Overlay dashed Bear/Bull ghost lines on scenario-sensitive charts">
                {scenOn ? '✓ ' : ''}Bear/Bull overlays
              </button>
              <button className="pyfill" onClick={showAll} title="Show every chart">Show all</button>
              <button className="pyfill" onClick={clearAll} title="Hide every chart">Clear</button>
            </div>
          </div>
          {GROUPS.map((g) => (
            <div className="chart-picker-group" key={g}>
              <span className="cpg-label">{g}</span>
              {CHARTS.filter((c) => c.group === g).map((c) => (
                <button key={c.id} className={`chip-btn ${sel.includes(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)}>
                  <span className="cb-mark">{sel.includes(c.id) ? '✓' : '+'}</span>
                  {c.title(ctx).split('(')[0].split('—')[0].trim()}
                </button>
              ))}
              <span className="cpg-sep" />
              <button className="cpg-mini" onClick={() => setGroup(g, true)} title={`Show every ${g} chart`}>all</button>
              <button className="cpg-mini" onClick={() => setGroup(g, false)} title={`Hide every ${g} chart`}>none</button>
            </div>
          ))}
        </div>

        <div className="grid2" style={{ marginTop: 20 }}>
          {active.map((ch) => (
            <div className="chartbox" key={ch.id}>
              <div className="ct ct-row">
                <span>{ch.title(ctx)}</span>
                <button className="pyfill" onClick={() => setFocus(ch.id)} title="Focus this chart full-screen with zoom & data table">Focus ⤢</button>
              </div>
              <EChart
                option={buildOption(ch, ctx, scenCtxs)}
                group={ch.sync ? 'vs-gallery' : undefined}
                onEvents={ch.drill ? { click: (p) => requestAssumption(typeof ch.drill === 'function' ? ch.drill(p) : ch.drill) } : undefined}
                style={{ height: 320 }}
              />
            </div>
          ))}
        </div>
        {active.length === 0 && <div className="warn" style={{ marginTop: 18 }}>No charts selected — click a chip above to add one.</div>}

        <div className="footer-note">
          All charts share the single driver set, so they always agree with the DCF, LBO, comps and IPO tabs.
          Dashed colored lines are the Bear/Bull ghost overlays (toggle above); while you drag a slider, a gray
          dashed trace holds each series' previous position for a moment. Year-axis charts share one crosshair —
          hover a year anywhere and every chart highlights it. <b>Click any bar or line to jump to the assumption
          that drives it.</b> Use the toolbox (top-right of each chart) to open a data table, save a PNG, or reset
          the view. Selections are saved with your other settings.
        </div>

      {focusChart && (
        <div className="chart-modal-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) setFocus(null); }}>
          <div className="chart-modal">
            <div className="chart-modal-head">
              <span>{focusChart.title(ctx)}</span>
              <button className="btn ghost" onClick={() => setFocus(null)}>Close ✕</button>
            </div>
            <div className="chart-modal-body">
              <EChart
                option={(() => { const o = buildOption(focusChart, ctx, scenCtxs); if (o.xAxis) { o.dataZoom = DATAZOOM; o.grid = { ...(o.grid || {}), bottom: 56 }; } return o; })()}
                onEvents={focusChart.drill ? { click: (p) => requestAssumption(typeof focusChart.drill === 'function' ? focusChart.drill(p) : focusChart.drill) } : undefined}
                style={{ height: '100%' }}
              />
            </div>
            <div className="chart-modal-foot">Scroll / drag to zoom · click legend to toggle series · hover to isolate · toolbox top-right for the data table & PNG</div>
          </div>
        </div>
      )}
    </div>
  );
}

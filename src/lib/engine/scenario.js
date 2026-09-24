/**
 * Scenario engine — one click morphs the whole model.
 * Deltas are applied on top of the user's base inputs (which stay untouched):
 *   growth: +/- pp on every year's revenue growth (abs revenue rows compound)
 *   margin: +/- pp on EBITDA margin (abs EBITDA rows shift by margin x revenue)
 *   mult:   +/- turns on exit EV/EBITDA multiples (DCF, LBO, IPO; P/E gets 2x)
 *   tg:     +/- pp on terminal growth
 *   erp:    +/- pp on the equity risk premium (risk appetite)
 */
export const SCENARIOS = {
  base: { label: 'Base', growth: 0, margin: 0, mult: 0, tg: 0, erp: 0 },
  bear: { label: 'Bear', growth: -4, margin: -3, mult: -2, tg: -1, erp: 1 },
  bull: { label: 'Bull', growth: 4, margin: 2.5, mult: 2, tg: 0.75, erp: -0.75 },
};

export function applyScenario(a) {
  const key = a.settings.scenario || 'base';
  const s = SCENARIOS[key];
  if (!s || key === 'base') return a;

  const d = a.drivers;
  let perYear = d.perYear;
  if (perYear) {
    const revFactor = perYear.revenue.map((_, i) => Math.pow(1 + s.growth / 100, i + 1));
    const revAdj = perYear.revenueMode === 'abs'
      ? perYear.revenue.map((v, i) => v * revFactor[i])
      : perYear.revenue.map((v) => v + s.growth);
    const revLevel = perYear.revenueMode === 'abs'
      ? revAdj
      : (() => { let r = d.revenue0; return revAdj.map((g) => (r = r * (1 + g / 100))); })();
    perYear = {
      ...perYear,
      revenue: revAdj,
      ebitda: perYear.ebitdaMode === 'abs'
        ? perYear.ebitda.map((v, i) => v * revFactor[i] + (s.margin / 100) * revLevel[i])
        : perYear.ebitda.map((v) => v + s.margin),
      da: perYear.daMode === 'abs' ? perYear.da.map((v, i) => v * revFactor[i]) : perYear.da,
      capex: perYear.capexMode === 'abs' ? perYear.capex.map((v, i) => v * revFactor[i]) : perYear.capex,
      nwc: perYear.nwcMode === 'abs' ? perYear.nwc.map((v, i) => v * revFactor[i]) : perYear.nwc,
    };
  }

  return {
    ...a,
    drivers: {
      ...d,
      growthStart: d.growthStart + s.growth,
      growthEnd: d.growthEnd + s.growth,
      growthCustom: d.growthCustom ? d.growthCustom.map((v) => v + s.growth) : null,
      marginStart: d.marginStart + s.margin,
      marginEnd: d.marginEnd + s.margin,
      marginCustom: d.marginCustom ? d.marginCustom.map((v) => v + s.margin) : null,
      perYear,
    },
    wacc: { ...a.wacc, erp: a.wacc.erp + s.erp },
    dcf: {
      ...a.dcf,
      terminalGrowth: a.dcf.terminalGrowth + s.tg,
      exitMultiple: a.dcf.exitMultiple + s.mult,
      exitPE: a.dcf.exitPE + 2 * s.mult,
    },
    lbo: { ...a.lbo, exitMultiple: a.lbo.exitMultiple + s.mult },
    ipo: {
      ...a.ipo,
      offerEvEbitda: a.ipo.offerEvEbitda + s.mult,
      offerPE: a.ipo.offerPE + 2 * s.mult,
    },
  };
}

import { lazy } from 'react';
import { METHOD_META } from './labels.js';
import { companyStep, historyStep, forecastStep } from './steps/common.jsx';
import { dcfSettingsStep, dcfCompanyStep, dcfDriversStep, dcfRateStep, dcfTerminalStep } from './steps/dcfSteps.jsx';
import {
  lboEntryStep, lboDebtStep, lboSweepStep, ipoFinancingStep, ipoPricingStep, ipoStructureStep,
  financingStep, ratioSettingsStep,
} from './steps/fieldSteps.js';
import {
  compsSettingsStep, compsTargetStep, peersStep, regressionStep,
  precSettingsStep, precCompanyStep, dealListStep, dealPagesStep,
} from './steps/templateSteps.jsx';
import { computeComps } from '../lib/engine/comps.js';
import { computePrecedent } from '../lib/engine/precedent.js';
import { combinedStep } from './combined.jsx';
import { toEngineInput } from '../store/methodModel.js';
import { projectOperations } from '../lib/engine/drivers.js';
import { computeDcfT, templateName } from '../lib/engine/dcfTemplate.js';
import { computeThreeStatement } from '../lib/engine/threeStatement.js';
import { fmtMoney, fmtPct, fmtX, fmtPrice } from '../lib/format.js';

/**
 * Every method: its steps (in order), its output page and a running preview of
 * the partial results that are already determined by the completed steps.
 */

const out = {
  dcf: lazy(() => import('../outputs/DcfOutput.jsx')),
  comps: lazy(() => import('../outputs/CompsOutput.jsx')),
  precedent: lazy(() => import('../outputs/PrecedentOutput.jsx')),
  lbo: lazy(() => import('../outputs/LboOutput.jsx')),
  ipo: lazy(() => import('../outputs/IpoOutput.jsx')),
  ts: lazy(() => import('../outputs/ThreeStatementOutput.jsx')),
  ratios: lazy(() => import('../outputs/RatioOutput.jsx')),
};

const fin = Number.isFinite;
const PROJ = { tax: true, nol: true };

/** Preview helpers — each returns rows only once the steps it needs are valid. */
const valid = (def, states, ...ids) => ids.every((id) => {
  const i = def.steps.findIndex((s) => s.id === id);
  return i >= 0 && states[i] === 'valid';
});

function opsRows(a, company) {
  const ops = projectOperations(a);
  const n = ops.n;
  return [
    { label: `Revenue, Year ${n}`, value: fmtMoney(ops.revenue[n - 1], company) },
    { label: `EBITDA, Year ${n}`, value: fmtMoney(ops.ebitda[n - 1], company) },
    { label: `EBITDA margin, Year ${n}`, value: fmtPct(ops.margin[n - 1], 1) },
  ];
}

export const METHODS = {
  dcf: {
    steps: [dcfSettingsStep(), dcfCompanyStep(), dcfDriversStep(), dcfRateStep(), dcfTerminalStep()],
    Output: out.dcf,
    preview(def, a, states, company) {
      if (!valid(def, states, 'dcfSettings')) return [];
      const r = computeDcfT(a);
      const rows = [{ label: 'Template', value: templateName(r.settings) }];
      if (valid(def, states, 'dcfCompany')) {
        const T = r.n + r.m - 1;
        rows.push({ label: `Revenue, ${r.labels.fcst[r.m - 1]}`, value: fmtMoney(r.F.rev[T], company) }, { label: `EBITDA margin, ${r.labels.fcst[r.m - 1]}`, value: fmtPct(r.F.margin[T] * 100, 1) });
      }
      if (valid(def, states, 'dcfRate')) {
        rows.push({ label: 'Cost of equity', value: fmtPct(r.coe.ke * 100, 2) });
        if (r.wacc) rows.push({ label: 'WACC', value: fmtPct(r.wacc.wacc * 100, 2) });
      }
      if (valid(def, states, 'dcfTerminal') && fin(r.valuation.perShare)) rows.push({ label: 'Value per share', value: fmtPrice(r.valuation.perShare, company, 2) });
      return rows;
    },
  },
  comps: {
    steps: [compsSettingsStep(), compsTargetStep(), peersStep(), regressionStep()],
    Output: out.comps,
    preview(def, a, states) {
      if (!valid(def, states, 'compsSettings')) return [];
      const c = computeComps(a);
      const rows = [];
      const m = c.target.bench.ebitdaMargin;
      if (typeof m === 'number') rows.push({ label: `Target EBITDA margin (${c.labels.ltm})`, value: fmtPct(m * 100, 1) });
      const filled = c.peers.filter((p) => !p.empty);
      if (filled.length) rows.push({ label: 'Peers included', value: `${filled.filter((p) => p.include === 1).length} of ${filled.length}` });
      const med = c.stats1.evEbitdaLtm?.median;
      if (typeof med === 'number') rows.push({ label: `Median EV / EBITDA ${c.labels.ltm}`, value: fmtX(med, 1) });
      return rows;
    },
  },
  precedent: {
    steps: [precSettingsStep(), precCompanyStep(), dealListStep(), dealPagesStep()],
    Output: out.precedent,
    preview(def, a, states) {
      if (!valid(def, states, 'precSettings')) return [];
      const p = computePrecedent(a);
      const rows = [];
      const filled = p.deals.filter((d) => !d.empty);
      if (filled.length) rows.push({ label: 'Deals included', value: `${filled.filter((d) => d.include === 1).length} of ${filled.length}` });
      const med = p.stats1.evEbitda?.median;
      if (typeof med === 'number') rows.push({ label: 'Median EV / LTM EBITDA', value: fmtX(med, 1) });
      const prem = p.stats1.premium?.median;
      if (typeof prem === 'number') rows.push({ label: 'Median control premium', value: fmtPct(prem * 100, 1) });
      return rows;
    },
  },
  lbo: {
    steps: [companyStep(PROJ), forecastStep(), lboEntryStep(), lboDebtStep(), lboSweepStep()],
    Output: out.lbo,
    preview(def, a, states, company) {
      const rows = [];
      if (valid(def, states, 'company', 'forecast')) rows.push(...opsRows(a, company));
      if (valid(def, states, 'forecast', 'lboEntry')) rows.push({ label: 'Entry enterprise value', value: fmtMoney(a.lbo.entryMultiple * a.drivers.ebitda0, company) });
      if (valid(def, states, 'forecast', 'lboEntry', 'lboDebt')) {
        const debt = (a.lbo.seniorX + a.lbo.mezzX) * a.drivers.ebitda0;
        rows.push({ label: 'New debt', value: `${fmtMoney(debt, company)} (${fmtX(a.lbo.seniorX + a.lbo.mezzX, 1)})` });
      }
      return rows;
    },
  },
  ipo: {
    steps: [companyStep(PROJ), forecastStep(), ipoFinancingStep(), ipoPricingStep(), ipoStructureStep()],
    Output: out.ipo,
    preview(def, a, states, company) {
      const rows = [];
      if (valid(def, states, 'company', 'forecast')) rows.push(...opsRows(a, company));
      if (valid(def, states, 'company', 'forecast', 'ipoFinancing')) {
        const ts = computeThreeStatement(a);
        rows.push({ label: 'Year-1 net income', value: fmtMoney(ts.netIncome[0], company) });
      }
      return rows;
    },
  },
  ts: {
    steps: [companyStep(PROJ), historyStep(), forecastStep(), financingStep()],
    Output: out.ts,
    preview(def, a, states, company) {
      return valid(def, states, 'company', 'forecast') ? opsRows(a, company) : [];
    },
  },
  ratios: {
    steps: [companyStep(PROJ), historyStep(), forecastStep(), financingStep(), ratioSettingsStep()],
    Output: out.ratios,
    preview(def, a, states, company) {
      return valid(def, states, 'company', 'forecast') ? opsRows(a, company) : [];
    },
  },
  combined: {
    steps: [combinedStep()],
    Output: null,           // rendered by the shell (needs the other methods)
    preview: () => [],
  },
};

for (const [id, def] of Object.entries(METHODS)) Object.assign(def, { id, ...METHOD_META[id] });

/** Preview rows for the wizard side card; never throws. */
export function previewRows(def, company, data, states) {
  try {
    return def.preview(def, toEngineInput(company, data), states, company) || [];
  } catch {
    return [];
  }
}

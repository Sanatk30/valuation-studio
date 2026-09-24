import { lazy } from 'react';
import { METHOD_META } from './labels.js';
import { companyStep, historyStep, forecastStep } from './steps/common.jsx';
import { waccStep, terminalStep, fcfeStep } from './steps/dcfSteps.jsx';
import {
  lboEntryStep, lboDebtStep, lboSweepStep, ipoFinancingStep, ipoPricingStep, ipoStructureStep,
  financingStep, ratioSettingsStep, compsTargetStep, precTargetStep,
} from './steps/fieldSteps.js';
import { peersStep, regressionStep, dealsStep, peerStatus, dealStatus } from './steps/marketSteps.jsx';
import { combinedStep } from './combined.jsx';
import { toEngineInput } from '../store/methodModel.js';
import { projectOperations } from '../lib/engine/drivers.js';
import { computeWacc } from '../lib/engine/wacc.js';
import { computeThreeStatement } from '../lib/engine/threeStatement.js';
import { fmtMoney, fmtPct, fmtX } from '../lib/format.js';

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
    steps: [companyStep(PROJ), historyStep(), forecastStep(), waccStep(), terminalStep(), fcfeStep()],
    Output: out.dcf,
    preview(def, a, states, company) {
      const rows = [];
      if (valid(def, states, 'company', 'forecast')) rows.push(...opsRows(a, company));
      if (valid(def, states, 'company', 'wacc')) {
        const k = computeWacc(a);
        rows.push({ label: 'Cost of equity', value: fmtPct(k.costEquity, 2) }, { label: 'WACC', value: fmtPct(k.wacc, 2) });
      }
      return rows;
    },
  },
  comps: {
    steps: [companyStep({ priceHint: 'Optional — used for the target’s own multiples and upside' }), compsTargetStep(), peersStep(), regressionStep()],
    Output: out.comps,
    preview(def, a, states, company) {
      const rows = [];
      const t = a.comps.target;
      if (valid(def, states, 'compsTarget')) {
        rows.push({ label: 'LTM EBITDA margin', value: fmtPct((t.ebitda / t.revenue) * 100, 1) });
      }
      const usable = (a.comps.peers || []).map(peerStatus).filter((s) => s.ok);
      if (usable.length) {
        const m = usable.map((s) => s.page.multiples?.evEbitda?.values?.[0]).filter(fin).sort((x, y) => x - y);
        rows.push({ label: 'Usable peers', value: String(usable.length) });
        if (m.length) rows.push({ label: 'Median EV / LTM EBITDA', value: fmtX(m.length % 2 ? m[(m.length - 1) / 2] : (m[m.length / 2 - 1] + m[m.length / 2]) / 2, 1) });
      }
      return rows;
    },
  },
  precedent: {
    steps: [companyStep({ priceHint: 'Optional — needed for the premiums-paid analysis' }), precTargetStep(), dealsStep()],
    Output: out.precedent,
    preview(def, a, states) {
      const rows = [];
      const usable = (a.precedent.deals || []).map(dealStatus).filter((s) => s.ok);
      if (usable.length) {
        const m = usable.map((s) => s.page.evEbitda).filter(fin).sort((x, y) => x - y);
        rows.push({ label: 'Usable deals', value: String(usable.length) });
        if (m.length) rows.push({ label: 'Median EV / LTM EBITDA', value: fmtX(m.length % 2 ? m[(m.length - 1) / 2] : (m[m.length / 2 - 1] + m[m.length / 2]) / 2, 1) });
      }
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

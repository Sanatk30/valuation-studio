import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { METHODS, previewRows } from '../methods/registry.js';
import { METHOD_META } from '../methods/labels.js';
import { methodProgress, stepErrors, skippedFlags } from '../methods/progress.js';
import { methodFigures } from '../methods/figures.js';
import { CombinedOutput, combinedResult } from '../methods/combined.jsx';
import { toEngineInput } from '../store/methodModel.js';
import { updateMethod, resetMethod, setPath } from '../store/store.js';
import { FieldGrid } from './Field.jsx';
import FillAllDialog from './FillAllDialog.jsx';

/** Shared context the steps and Combined need about the whole company. */
export function useCompanyCtx(record) {
  return useMemo(() => {
    const company = companyOf(record);
    const cache = {};
    const progressOf = (id) => {
      if (!cache[id]) cache[id] = methodProgress(METHODS[id], record.methods[id], { company, record, methodId: id, progressOf, figuresOf });
      return cache[id];
    };
    const figCache = {};
    const figuresOf = (id) => {
      if (!figCache[id]) figCache[id] = methodFigures(id, company, record.methods[id]);
      return figCache[id];
    };
    return { company, progressOf, figuresOf };
  }, [record]);
}

export const companyOf = (r) => ({ id: r.id, name: r.name, currency: r.currency, unit: r.unit, startYear: r.startYear, fyEndMonth: r.fyEndMonth });

export default function MethodPage({ record, methodId, onHome }) {
  const def = METHODS[methodId];
  const mstate = record.methods[methodId];
  const cctx = useCompanyCtx(record);
  const { company } = cctx;
  const ctx = { ...cctx, record, methodId };
  const prog = methodProgress(def, mstate, ctx);
  const n = def.steps.length;

  // current view: a step index, or n = the output. Never beyond what is reachable.
  const view = Math.min(mstate.step ?? 0, prog.reachable);
  const [fromOutput, setFromOutput] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [fillAll, setFillAll] = useState(false);
  useEffect(() => { setReveal(false); window.scrollTo({ top: 0 }); }, [view, methodId]);

  const go = (i) => updateMethod(record.id, methodId, (m) => ({ ...m, step: i }));
  const setData = (fn) => updateMethod(record.id, methodId, (m) => ({ ...m, data: fn(m.data) }));
  const setSkip = (id, v) => updateMethod(record.id, methodId, (m) => ({ ...m, skipped: { ...m.skipped, [id]: v } }));

  if (view >= n) {
    return (
      <OutputView
        def={def} record={record} mstate={mstate} ctx={ctx} company={company}
        onEdit={(i) => { setFromOutput(true); go(i); }}
        onHome={onHome}
        onReset={() => { if (confirm(`Start ${def.label} over? Every input in this method is cleared (other methods are untouched).`)) resetMethod(record.id, methodId); }}
      />
    );
  }

  const step = def.steps[view];
  const errs = stepErrors(step, mstate.data, ctx);
  const ok = !Object.keys(errs.fields).length && !errs.step.length;
  const skipped = step.optional && mstate.skipped?.[step.id];

  const onSet = (path, value) => setData((d) => step.onSet?.(d, path, value) || setPath(d, path, value));

  const next = () => {
    if (!ok) { setReveal(true); return; }
    if (step.optional && skipped) setSkip(step.id, false);
    if (fromOutput) {
      // back to the output once everything is valid, else the first gap
      const after = methodProgress(def, { ...mstate, skipped: { ...mstate.skipped, [step.id]: false } }, ctx);
      go(after.reachable);
      if (after.complete) setFromOutput(false);
      return;
    }
    go(view + 1);
  };
  const skip = () => { setSkip(step.id, true); go(fromOutput ? methodProgress(def, { ...mstate, skipped: { ...mstate.skipped, [step.id]: true } }, ctx).reachable : view + 1); };

  const preview = previewRows(def, company, mstate.data, prog.states);
  const Extra = step.Extra;
  const Readout = step.Readout;

  return (
    <div className="method">
      <div className="method-head">
        <button className="crumb" onClick={onHome}>← All methods</button>
        <h1>{def.label}</h1>
        <div className="method-actions">
          <button className="btn ghost sm" onClick={() => setFillAll(true)} title="Every step of this method on one page">Fill all steps at once</button>
          {prog.started && <button className="btn ghost sm" onClick={() => { if (confirm(`Start ${def.label} over? Every input in this method is cleared.`)) resetMethod(record.id, methodId); }}>Start over</button>}
        </div>
      </div>

      <div className="wiz">
        <StepRail def={def} prog={prog} view={view} onGo={go} />

        <section className="step-card">
          <div className="step-top">
            <div className="step-count">Step {view + 1} of {n}{step.optional ? ' · optional' : ''}</div>
            <h2>{step.title}</h2>
            <p className="step-blurb">{step.blurb}</p>
            {fromOutput && <div className="note-bar">Editing from the output — press <b>Save & return</b> when done.</div>}
            {skipped && <div className="note-bar">You skipped this step. Fill it in and press Continue to include it.</div>}
          </div>

          {Extra && !step.extraBelow && <Extra data={mstate.data} setData={setData} company={company} ctx={ctx} reveal={reveal} specs={errs.specs} />}
          {errs.specs.length > 0 && (
            <FieldGrid specs={errs.specs} data={mstate.data} onSet={onSet} company={company} reveal={reveal} />
          )}
          {Extra && step.extraBelow && <Extra data={mstate.data} setData={setData} company={company} ctx={ctx} reveal={reveal} specs={errs.specs} />}
          {Readout && <Readout data={mstate.data} company={company} ctx={ctx} />}

          {(reveal || !Object.keys(errs.fields).length) && errs.step.length > 0 && (
            <ul className="step-errs">{errs.step.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
          {reveal && Object.keys(errs.fields).length > 0 && (
            <div className="step-errs one">Fill the highlighted fields to continue.</div>
          )}

          <div className="step-foot">
            {view > 0 && <button className="btn ghost" onClick={() => go(view - 1)}>← Back</button>}
            <div className="spacer" />
            {step.optional && !fromOutput && <button className="btn ghost" onClick={skip}>Skip this step</button>}
            <button className={`btn primary${ok ? '' : ' dim'}`} onClick={next}>
              {fromOutput ? 'Save & return' : view === n - 1 ? 'See the output →' : 'Continue →'}
            </button>
          </div>
        </section>

        <aside className="preview-card">
          <div className="pv-h">So far</div>
          {preview.length ? (
            <dl>{preview.map((r) => <React.Fragment key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></React.Fragment>)}</dl>
          ) : (
            <div className="pv-empty">Partial results appear here as steps are completed.</div>
          )}
        </aside>
      </div>

      {fillAll && (
        <FillAllDialog
          def={def} record={record} mstate={mstate} ctx={ctx} company={company}
          onClose={() => setFillAll(false)}
          onApply={(data, skippedMap) => {
            updateMethod(record.id, methodId, (m) => ({ ...m, data, skipped: skippedMap }));
            const after = methodProgress(def, { ...mstate, data, skipped: skippedMap }, ctx);
            go(after.reachable);
            setFillAll(false);
          }}
        />
      )}
    </div>
  );
}

function StepRail({ def, prog, view, onGo }) {
  const n = def.steps.length;
  return (
    <nav className="step-rail" aria-label="Steps">
      {def.steps.map((s, i) => {
        const st = prog.states[i];
        const can = i <= prog.reachable;
        return (
          <button
            key={s.id}
            className={`sr-item ${i === view ? 'cur' : ''} ${st}`}
            disabled={!can}
            onClick={() => can && onGo(i)}
            title={can ? '' : 'Complete the earlier steps first'}
          >
            <span className="sr-dot">{st === 'valid' ? '✓' : st === 'skipped' ? '–' : i + 1}</span>
            <span className="sr-t">{s.title}{s.optional ? <em> optional</em> : null}</span>
          </button>
        );
      })}
      <button className={`sr-item out ${prog.complete ? 'valid' : ''}`} disabled={!prog.complete} onClick={() => prog.complete && onGo(n)}>
        <span className="sr-dot">★</span>
        <span className="sr-t">Output</span>
      </button>
    </nav>
  );
}

function OutputView({ def, record, mstate, ctx, company, onEdit, onHome, onReset }) {
  const [exporting, setExporting] = useState(false);
  const a = useMemo(() => toEngineInput(company, mstate.data), [company, mstate.data]);
  const skipped = skippedFlags(mstate);
  const setDisplay = (path, value) => updateMethod(record.id, def.id, (m) => ({ ...m, data: setPath(m.data, path, value) }));

  const onExcel = async () => {
    setExporting(true);
    try {
      const { exportToExcel } = await import('../lib/excel/exportExcel.js');
      const opts = { skipped };
      if (def.id === 'combined') {
        const res = combinedResult(mstate.data, ctx);
        opts.combined = {
          rows: res.rows.map((r) => ({ method: METHOD_META[r.methodId].label, figureLabel: r.figure.label, value: r.figure.value, low: r.figure.low, high: r.figure.high, weight: r.weight })),
          marketPrice: res.marketPrice ?? null,
        };
      }
      await exportToExcel(a, def.id, opts);
    } catch (e) {
      console.error(e);
      alert(`Excel export failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  const Out = def.Output;
  return (
    <div className="method">
      <div className="method-head">
        <button className="crumb" onClick={onHome}>← All methods</button>
        <h1>{def.label} <span className="h-tag">Output</span></h1>
        <div className="method-actions">
          <button className="btn primary sm" onClick={onExcel} disabled={exporting}>{exporting ? 'Building…' : 'Download Excel'}</button>
          <button className="btn ghost sm" onClick={onReset}>Start over</button>
        </div>
      </div>
      <div className="edit-strip">
        <span>Inputs:</span>
        {def.steps.map((s, i) => (
          <button key={s.id} className={`edit-chip${mstate.skipped?.[s.id] ? ' skipped' : ''}`} onClick={() => onEdit(i)} title={`Edit ${s.title}`}>
            {s.title}{mstate.skipped?.[s.id] ? ' (skipped)' : ''} <span>✎</span>
          </button>
        ))}
      </div>
      <Suspense fallback={<div className="loading">Loading…</div>}>
        {def.id === 'combined'
          ? <CombinedOutput data={mstate.data} company={company} ctx={ctx} />
          : <Out a={a} set={setDisplay} company={company} skipped={skipped} />}
      </Suspense>
    </div>
  );
}

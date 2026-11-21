import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { METHODS, previewRows } from '../methods/registry.js';
import { METHOD_META } from '../methods/labels.js';
import { methodProgress, stepErrors, skippedFlags, wizardView } from '../methods/progress.js';
import { methodFigures } from '../methods/figures.js';
import { CombinedOutput, combinedResult } from '../methods/combined.jsx';
import { toEngineInput } from '../store/methodModel.js';
import { updateMethod, resetMethod, setPath } from '../store/store.js';
import { Field, FieldGrid, NumLocaleContext } from './Field.jsx';
import { effectiveYear1 } from '../lib/period.js';
import { CURRENCIES } from '../lib/format.js';
import FillAllDialog from './FillAllDialog.jsx';
import { CountUp } from '../lib/motion.jsx';

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

// Year 1 never later than the calendar allows (a historical year must have ended): see effectiveYear1
export const companyOf = (r) => ({ id: r.id, name: r.name, currency: r.currency, unit: r.unit, startYear: effectiveYear1(r.startYear, r.fyEndMonth), fyEndMonth: r.fyEndMonth });

export default function MethodPage({ record, methodId, onHome }) {
  const def = METHODS[methodId];
  const mstate = record.methods[methodId];
  const cctx = useCompanyCtx(record);
  const { company } = cctx;
  const ctx = { ...cctx, record, methodId };
  const prog = methodProgress(def, mstate, ctx);
  const n = def.steps.length;

  // current view: a step index, or n = the output. Never beyond what is reachable.
  const { view, resync } = wizardView(mstate, prog);
  const [fromOutput, setFromOutput] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [fillAll, setFillAll] = useState(false);
  useEffect(() => { setReveal(false); window.scrollTo({ top: 0 }); }, [view, methodId]);

  const go = (i) => updateMethod(record.id, methodId, (m) => ({ ...m, step: i }));
  const setData = (fn) => updateMethod(record.id, methodId, (m) => ({ ...m, data: fn(m.data) }));
  const setSkip = (id, v) => updateMethod(record.id, methodId, (m) => ({ ...m, skipped: { ...m.skipped, [id]: v } }));
  // a saved step beyond the step shown is brought back to it (see wizardView)
  useEffect(() => { if (resync) go(view); }, [resync, view]);   // eslint-disable-line react-hooks/exhaustive-deps

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
  const numLocale = CURRENCIES[company.currency]?.locale || 'en-US';
  const Extra = step.Extra;
  const Readout = step.Readout;

  return (
    <NumLocaleContext.Provider value={numLocale}>
    <div className="method mp">
      <BarSlot>
        {liveRow(preview) && <span className="tb-live" title={`${liveRow(preview).label}: ${liveRow(preview).value}`}><i className="live-dot" aria-hidden="true" />{liveRow(preview).label} <LiveValue value={liveRow(preview).value} /></span>}
        <button className="btn ghost sm" onClick={() => setFillAll(true)} title="Every step of this method on one page">Fill all at once</button>
        {prog.started && <button className="btn ghost sm" onClick={() => { if (confirm(`Start ${def.label} over? Every input in this method is cleared.`)) resetMethod(record.id, methodId); }}>Start over</button>}
      </BarSlot>

      <StepBoxes def={def} prog={prog} view={view} onGo={go} preview={preview} mstate={mstate} ctx={ctx} />

      <div className="anim-page" key={view}>
      <div className="mp-head">
        <div>
          <div className="mp-eyebrow">{def.label} · step {view + 1} of {n}{step.optional ? ' · optional' : ''}</div>
          <h1>{step.title}</h1>
          <p>{step.blurb}</p>
        </div>
      </div>
      {fromOutput && <div className="note-bar">Editing from the result — press <b>Save & return</b> when done.</div>}
      {skipped && <div className="note-bar">You skipped this step. Fill it in and press Continue to include it.</div>}

      <section className={`step-card mp-body${step.Layout ? ' mp-free' : ''}`}>
          {step.Top && !step.Layout && <step.Top data={mstate.data} setData={setData} company={company} ctx={ctx} />}
          {step.Layout ? (
            <step.Layout
              data={mstate.data} setData={setData} company={company} ctx={ctx} reveal={reveal} specs={errs.specs} Extra={Extra}
              F={(path, props = {}) => { const sp0 = errs.specs.find((x) => x.path === path); const sp = sp0 && props.label ? { ...sp0, label: props.label } : sp0; return sp ? <Field key={path} spec={sp} data={mstate.data} onSet={onSet} company={company} reveal={reveal} {...props} /> : null; }}
              has={(path) => errs.specs.some((x) => x.path === path)}
              rest={(paths) => { const left = errs.specs.filter((x) => !paths.includes(x.path)); return left.length ? <FieldGrid specs={left} data={mstate.data} onSet={onSet} company={company} reveal={reveal} /> : null; }}
            />
          ) : (
            <>
              {Extra && !step.extraBelow && <Extra data={mstate.data} setData={setData} company={company} ctx={ctx} reveal={reveal} specs={errs.specs} />}
              {errs.specs.length > 0 && (
                <FieldGrid specs={errs.specs} data={mstate.data} onSet={onSet} company={company} reveal={reveal} />
              )}
              {Extra && step.extraBelow && <Extra data={mstate.data} setData={setData} company={company} ctx={ctx} reveal={reveal} specs={errs.specs} />}
            </>
          )}
          {Readout && !step.Layout && <Readout data={mstate.data} company={company} ctx={ctx} />}

          {(reveal || !Object.keys(errs.fields).length) && errs.step.length > 0 && (
            <ul className="step-errs">{errs.step.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
          {reveal && Object.keys(errs.fields).length > 0 && (
            <div className="step-errs one">Fill the highlighted fields to continue.</div>
          )}
      </section>
      </div>

      <div className="mp-foot">
        {view > 0 ? <button className="btn ghost" onClick={() => go(view - 1)}>← {def.steps[view - 1].title}</button> : <button className="btn ghost" onClick={onHome}>← Overview</button>}
        <div className="spacer" />
        <span className="mp-saved">Saved automatically</span>
        {step.optional && !fromOutput && <button className="btn ghost" onClick={skip}>Skip this step</button>}
        <button className={`btn primary${ok ? '' : ' dim'}`} onClick={next}>
          {fromOutput ? 'Save & return' : view === n - 1 ? 'See the result →' : `Continue → ${def.steps[view + 1].title}`}
        </button>
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
    </NumLocaleContext.Provider>
  );
}

/** A preview value that flashes when it changes, so an edit's effect is visible at a glance. */
function LiveValue({ value }) {
  const prev = useRef(value);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (prev.current !== value) { prev.current = value; setTick((t) => t + 1); }
  }, [value]);
  return <b><CountUp>{value}</CountUp></b>;
}

/** The preview row the top bar and the Result box show: the headline value when there is one, else the latest figure. */
export function liveRow(preview) {
  if (!preview?.length) return null;
  return preview.find((r) => /per share|offer price|^IRR|combined|implied value/i.test(r.label)) || preview[preview.length - 1];
}

/** Renders its children into the top bar's slot (the live value and the page actions). */
export function BarSlot({ children }) {
  const [el, setEl] = useState(null);
  useEffect(() => { setEl(document.getElementById('tb-slot')); }, []);
  return el ? createPortal(children, el) : null;
}

/**
 * The steps as connected boxes across the top (the chosen layout): each box
 * names its step and what has been entered; the last box is the result.
 */
function StepBoxes({ def, prog, view, onGo, preview, mstate, ctx }) {
  const n = def.steps.length;
  const sub = (s, i, st) => {
    try { const t = s.summary?.(mstate.data, ctx); if (t) return t; } catch { /* fall through */ }
    return st === 'valid' ? 'done' : st === 'skipped' ? 'skipped' : i === view ? 'filling in' : s.optional ? 'optional' : 'to fill';
  };
  return (
    <nav className="sb" aria-label="Steps">
      {def.steps.map((s, i) => {
        const can = i <= prog.reachable;
        const st = can ? prog.states[i] : 'invalid';
        return (
          <React.Fragment key={s.id}>
            {i > 0 && <span className={`sb-w${i <= Math.min(view, prog.reachable) ? ' on' : ''}`} aria-hidden="true" />}
            <button className={`sb-n ${st}${i === view ? ' cur' : ''}`} disabled={!can} onClick={() => can && onGo(i)} title={can ? s.title : 'Complete the earlier steps first'}>
              <i>{st === 'valid' && i !== view ? <svg className="sb-ck" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.3 L4.9 9 L10 3.2" pathLength="1" /></svg> : st === 'skipped' ? '–' : i + 1}</i>
              <span><b>{s.title}</b><small>{sub(s, i, st)}</small></span>
            </button>
          </React.Fragment>
        );
      })}
      <span className={`sb-w${view >= n ? ' on' : ''}`} aria-hidden="true" />
      <button className={`sb-n res${view >= n ? ' cur' : ''}`} disabled={!prog.complete} onClick={() => prog.complete && onGo(n)} title={prog.complete ? 'See the result' : 'Complete every step first'}>
        <i>{n + 1}</i>
        <span><b>Result</b><small>{liveRow(preview) && prog.complete ? liveRow(preview).value : prog.complete ? 'ready' : 'after the last step'}</small></span>
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
        // the template's rows: DCF in the FCFF row or the FCFE / DDM row, by its cash-flow basis
        const dcfCf = record.methods?.dcf?.data?.dcf?.settings?.cf;
        const keyOf = (id) => (id === 'dcf' ? (dcfCf === 'fcff' ? 'dcfFcff' : 'dcfFcfe') : id === 'precedent' ? 'prec' : id);
        opts.combined = {
          rows: res.rows.filter((r) => r.figure).map((r) => ({ key: keyOf(r.methodId), figureLabel: r.figure.label, value: r.figure.value, low: r.figure.low, high: r.figure.high, weight: r.weight })),
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
  const prog = methodProgress(def, mstate, ctx);
  const preview = previewRows(def, company, mstate.data, prog.states);
  return (
    <div className="method mp">
      <BarSlot>
        {liveRow(preview) && <span className="tb-live"><i className="live-dot" aria-hidden="true" />{liveRow(preview).label} <b>{liveRow(preview).value}</b></span>}
        <button className="btn ghost sm" onClick={onReset}>Start over</button>
        <button className="btn primary sm" onClick={onExcel} disabled={exporting}>{exporting ? 'Building…' : 'Download Excel'}</button>
      </BarSlot>
      <StepBoxes def={def} prog={prog} view={def.steps.length} onGo={(i) => (i < def.steps.length ? onEdit(i) : null)} preview={preview} mstate={mstate} ctx={ctx} />
      <div className="mp-head anim-page">
        <div>
          <div className="mp-eyebrow">{def.label} · result</div>
          <h1>Result</h1>
          <p>Click any step above to change its inputs — the result updates as soon as you return.</p>
        </div>
      </div>
      <Suspense fallback={<div className="loading"><div className="pbar"><div /></div>Loading…</div>}>
        {def.id === 'combined'
          ? <CombinedOutput data={mstate.data} company={company} ctx={ctx} />
          : <Out a={a} set={setDisplay} company={company} skipped={skipped} onEdit={onEdit} />}
      </Suspense>
    </div>
  );
}

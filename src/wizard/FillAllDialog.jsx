import React, { useState } from 'react';
import { stepErrors } from '../methods/progress.js';
import { setPath } from '../store/store.js';
import { mergePastedData } from '../store/methodModel.js';
import { FieldGrid } from './Field.jsx';

/**
 * Every step of one method on a single scrolling page, working on a DRAFT: the
 * method's saved inputs change only when you press Apply. Includes a JSON view
 * of the method's inputs to copy out or paste back in.
 */
export default function FillAllDialog({ def, mstate, ctx, company, onClose, onApply }) {
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(mstate.data)));
  const [skipped, setSkipped] = useState(() => ({ ...(mstate.skipped || {}) }));
  const [json, setJson] = useState(null);
  const [jsonErr, setJsonErr] = useState('');

  const setData = (fn) => setDraft((d) => fn(d));
  const dctx = { ...ctx, record: { ...ctx.record, methods: { ...ctx.record.methods, [def.id]: { ...mstate, data: draft } } } };

  const statuses = def.steps.map((s) => {
    if (s.optional && skipped[s.id]) return 'skipped';
    const e = stepErrors(s, draft, dctx);
    return !Object.keys(e.fields).length && !e.step.length ? 'valid' : 'invalid';
  });
  const allOk = statuses.every((s) => s !== 'invalid');

  const loadJson = () => {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      setJsonErr(`Could not read that JSON: ${e.message}`);
      return;
    }
    // only the sections this method owns, each in the shape of its blank section — a paste
    // can't smuggle in other sections, and a wrong shape (e.g. "dcf": null) is refused here
    // instead of breaking the form
    const { data, errors } = mergePastedData(def.id, draft, parsed);
    if (errors.length) { setJsonErr(`Not loaded: ${errors.slice(0, 4).join('; ')}${errors.length > 4 ? ' …' : ''}`); return; }
    setDraft(data);
    setJson(null);
    setJsonErr('');
  };

  return (
    <div className="bulk-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bulk-modal fillall">
        <div className="bulk-head">
          <h2>{def.label} — every step</h2>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={() => setJson(json === null ? JSON.stringify(draft, null, 2) : null)}>{json === null ? 'JSON' : 'Back to form'}</button>
          <button className="btn ghost sm" onClick={onClose}>Cancel</button>
          <button className="btn primary sm" onClick={() => onApply(draft, skipped)}>{allOk ? 'Apply & see output' : 'Apply'}</button>
        </div>

        {json !== null ? (
          <div className="fa-json">
            <p className="fld-h">This method’s inputs as JSON — copy them out to save or share, or paste a saved set and press Load.</p>
            <textarea value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
            {jsonErr && <div className="step-errs one">{jsonErr}</div>}
            <div className="row-btns">
              <button className="btn sm" onClick={() => navigator.clipboard?.writeText(json)}>Copy</button>
              <button className="btn primary sm" onClick={loadJson}>Load into the form</button>
            </div>
          </div>
        ) : (
          <div className="fa-body">
            {def.steps.map((step, i) => {
              const errs = stepErrors(step, draft, dctx);
              const Extra = step.Extra;
              const isSkipped = step.optional && skipped[step.id];
              const onSet = (path, value) => setDraft((d) => step.onSet?.(d, path, value) || setPath(d, path, value));
              return (
                <section key={step.id} className={`fa-step ${statuses[i]}`}>
                  <div className="fa-step-h">
                    <span className="sr-dot">{statuses[i] === 'valid' ? '✓' : statuses[i] === 'skipped' ? '–' : i + 1}</span>
                    <h3>{step.title}</h3>
                    {step.optional && (
                      <label className="fa-skip">
                        <input type="checkbox" checked={!!isSkipped} onChange={(e) => setSkipped((s) => ({ ...s, [step.id]: e.target.checked }))} /> skip
                      </label>
                    )}
                  </div>
                  {!isSkipped && (
                    <>
                      {Extra && !step.extraBelow && <Extra data={draft} setData={setData} company={company} ctx={dctx} specs={errs.specs} />}
                      {errs.specs.length > 0 && <FieldGrid specs={errs.specs} data={draft} onSet={onSet} company={company} reveal={false} cols={3} />}
                      {Extra && step.extraBelow && <Extra data={draft} setData={setData} company={company} ctx={dctx} specs={errs.specs} />}
                      {!Object.keys(errs.fields).length && errs.step.length > 0 && (
                        <ul className="step-errs">{errs.step.map((e) => <li key={e}>{e}</li>)}</ul>
                      )}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

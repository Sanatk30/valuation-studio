import { fieldErrors, anyFilled } from './fields.js';
import { blankMethodData } from '../store/methodModel.js';

/**
 * Step validity and method progress — computed from the data every time, never
 * stored, so editing an earlier step can never leave a stale "complete" flag.
 */

/** Errors for one step: { fields: {path: msg}, step: string[] }. */
export function stepErrors(step, data, ctx) {
  // a step that cannot even list its fields (inputs in an unexpected shape) is invalid, not a crash
  let specs;
  try { specs = step.fields ? step.fields(data, ctx) : []; } catch (e) { return { fields: {}, step: [`This step's inputs could not be read (${e.message}) — Start over clears them.`], specs: [] }; }
  const fields = fieldErrors(specs, data);
  let extra = [];
  if (!Object.keys(fields).length && step.validate) {
    try { extra = step.validate(data, ctx) || []; } catch (e) { extra = [e.message]; }
  }
  return { fields, step: extra, specs };
}

export const stepValid = (step, data, ctx) => {
  const e = stepErrors(step, data, ctx);
  return !Object.keys(e.fields).length && !e.step.length;
};

/**
 * Progress of one method.
 *  states[i] = 'valid' | 'skipped' | 'invalid'
 *  reachable = index of the furthest step the user may open (the first step
 *              that is neither valid nor skipped; = steps.length when complete)
 */
export function methodProgress(def, mstate, ctx) {
  // a record saved without this method reads as a blank, not-started method
  let data = mstate?.data;
  if (data == null) { try { data = blankMethodData(def.id); } catch { data = null; } }
  const skipped = mstate?.skipped || {};
  const states = def.steps.map((s) => {
    if (s.optional && skipped[s.id]) return 'skipped';
    return stepValid(s, data, ctx) ? 'valid' : 'invalid';
  });
  const firstOpen = states.findIndex((st) => st === 'invalid');
  const reachable = firstOpen === -1 ? def.steps.length : firstOpen;
  const complete = firstOpen === -1;
  // pre-filled defaults (the DCF / LBO sensitivity steps) don't make a method "started"
  let blank = null;
  try { blank = def.id ? blankMethodData(def.id) : null; } catch { blank = null; }
  const started = def.steps.some((s) => {
    try { return anyFilled(s.fields ? s.fields(data, ctx) : [], data, blank); } catch { return true; }
  }) || (() => { try { return !!def.startedWhen?.(data); } catch { return true; } })();
  return { states, reachable, complete, started, skippedIds: Object.keys(skipped).filter((k) => skipped[k]) };
}

/** `skipped` flags in the shape the output pages expect ({ fcfe: true, … }). */
export function skippedFlags(mstate) {
  return Object.fromEntries(Object.entries(mstate.skipped || {}).filter(([, v]) => v));
}

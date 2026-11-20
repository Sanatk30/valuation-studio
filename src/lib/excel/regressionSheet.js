/**
 * Regression workbench as LIVE formulas (engine/regressionModel.js + mlr.js):
 * peer data (green links into the Comps Summary rows; blue for custom
 * variables) → transformed design matrix → normal equations X'X / X'y →
 * Gauss-Jordan elimination on [X'X | X'y | I] (pure arithmetic — no MINVERSE,
 * so it recalculates in any engine) → coefficients, classical SEs (t via
 * TDIST), fit diagnostics, the target prediction with its ±1 SE band, and the
 * implied-price bridge onto the target's LTM metric.
 *
 * Peer and target values link to the Comps Summary rows; a target override
 * typed in the app is a blue input here.
 */
import {
  put, colL, na, nv, styleSheet,
  C_INPUT, C_LINK, C_HDR_FILL, C_HDR_TEXT, C_SECTION_FILL, C_MUTED, C_TAB_ANALYSIS, C_INPUT_FILL,
} from './xlsxUtil.js';
import { runRegression, allVars, observations } from '../engine/regressionModel.js';
import { xTransform } from '../engine/mlr.js';

function sectionHeader(ws, row, text, span) {
  for (let i = 1; i <= span; i++) put(ws, `${colL(i)}${row}`, i === 1 ? text : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true });
  ws.getRow(row).height = 18;
}

/**
 * Write the Regression sheet. `links` ties it to the workbook:
 *   peerName(id)        formula for a peer's name
 *   peerCell(id, key)   formula for a built-in variable of that peer (null → typed)
 *   targetCell(key)     formula for the target's value of a built-in variable
 *   metric(spec)        formula for the target metric a multiple divides by
 *   netDebt, nci, shares  the target's EV-bridge cells (nonOp: non-operating investments, added back)
 * Returns the implied-price refs, or null when the model is not estimable / y
 * is not a valuation multiple.
 */
export function writeRegressionSheet(ws, a, F, links) {
  const regRun = runRegression(a);
  const fitR = regRun.fit;
  ws.getColumn(1).width = 30;
  for (let i = 2; i <= 26; i++) ws.getColumn(i).width = 13;
  styleSheet(ws, { freezeRow: 1, freezeCol: 1, tab: C_TAB_ANALYSIS, printTitles: '1:1' });
  let rr = 1;
  put(ws, `A${rr}`, 'REGRESSION ANALYSIS — PEER MULTIPLES', { bold: true, size: 14 }); rr++;
  const yLabel = regRun.yDef?.label || regRun.yVar || 'y';
  if (!fitR?.ok) {
    put(ws, `A${rr + 1}`, `The model is not estimable: ${fitR?.reason || 'choose the variables in the Regression step'}.`, { italic: true, color: C_MUTED });
    return null;
  }

  const terms = fitR.cols;
  const dim = terms.length + 1;
  const usedX = [...new Set(terms.map((t) => t.key))];
  const varsAll = allVars(a);
  const varLabel = (k) => (varsAll.find((v) => v.key === k) || { label: k }).label;
  put(ws, `A${rr}`, `${regRun.spec.yLog ? `ln(${yLabel})` : yLabel}  ~  β₀ + ${terms.map((t, i) => `β${i + 1}·${t.label}`).join(' + ')}`, { italic: true, color: C_MUTED });
  rr += 2;

  /* ---- peer data: only the peers the fit uses (complete on every used variable) ---- */
  const obs = observations(a);
  const used = [];
  obs.forEach((ob, i) => {
    const yRaw = typeof ob.values[regRun.yVar] === 'number' ? ob.values[regRun.yVar] : NaN;
    const y = regRun.spec.yLog ? (yRaw > 0 ? Math.log(yRaw) : NaN) : yRaw;
    const xs = terms.map((c) => xTransform(ob.values[c.key], c));
    if (Number.isFinite(y) && xs.every(Number.isFinite)) used.push(i);
  });
  const nObs = used.length;

  sectionHeader(ws, rr++, 'PEER DATA — included peers (green = linked to Comps Summary, blue = typed)', 2 + usedX.length);
  const pdHead = rr;
  put(ws, `A${pdHead}`, 'Peer', { bold: true, fill: C_SECTION_FILL });
  usedX.forEach((k, i) => put(ws, `${colL(2 + i)}${pdHead}`, varLabel(k), { bold: true, fill: C_SECTION_FILL, align: 'center', wrap: true }));
  put(ws, `${colL(2 + usedX.length)}${pdHead}`, `${yLabel} (y)`, { bold: true, fill: C_SECTION_FILL, align: 'center', wrap: true });
  ws.getRow(pdHead).height = 30;
  rr++;
  const pd0 = rr;
  for (const i of used) {
    const ob = obs[i];
    put(ws, `A${rr}`, links.peerName(ob.id) ? { formula: links.peerName(ob.id) } : ob.name, { color: C_LINK });
    [...usedX, regRun.yVar].forEach((k, j) => {
      const link = links.peerCell(ob.id, k);
      if (link) put(ws, `${colL(2 + j)}${rr}`, { formula: link }, { fmt: F.num, color: C_LINK, align: 'center' });
      else put(ws, `${colL(2 + j)}${rr}`, nv(ob.values[k]), { fmt: F.num, color: C_INPUT, fill: C_INPUT_FILL, align: 'center' });
    });
    rr++;
  }
  const rawCell = (k, i) => `${colL(2 + usedX.indexOf(k))}${pd0 + i}`;
  const rawYCell = (i) => `${colL(2 + usedX.length)}${pd0 + i}`;
  if (fitR.dropped.length) { put(ws, `A${rr}`, `Excluded (incomplete): ${fitR.dropped.join(', ')}`, { italic: true, color: C_MUTED }); rr++; }
  if (regRun.unpriced?.length) { put(ws, `A${rr}`, `Left out (no share price or share count, so market cap = 0): ${regRun.unpriced.join(', ')}`, { italic: true, color: C_MUTED }); rr++; }
  rr++;

  /* ---- transformed design matrix ---- */
  sectionHeader(ws, rr++, 'DESIGN MATRIX (transformed)', 3 + dim);
  const dmHead = rr;
  put(ws, `A${dmHead}`, 'Peer', { bold: true, fill: C_SECTION_FILL });
  put(ws, `B${dmHead}`, 'const', { bold: true, fill: C_SECTION_FILL, align: 'center' });
  terms.forEach((t, i) => put(ws, `${colL(3 + i)}${dmHead}`, t.label, { bold: true, fill: C_SECTION_FILL, align: 'center' }));
  const yStarCol = colL(3 + terms.length);
  put(ws, `${yStarCol}${dmHead}`, regRun.spec.yLog ? 'ln(y)' : 'y', { bold: true, fill: C_SECTION_FILL, align: 'center' });
  rr++;
  const dm0 = rr;
  const termFormula = (t, rc) => {
    const base = t.transform === 'ln' ? `LN(${rc})` : rc;
    return t.power > 1 ? `(${base})^${t.power}` : base;
  };
  for (let i = 0; i < nObs; i++) {
    put(ws, `A${dm0 + i}`, { formula: `A${pd0 + i}` });
    put(ws, `B${dm0 + i}`, 1, { align: 'center' });
    terms.forEach((t, j) => put(ws, `${colL(3 + j)}${dm0 + i}`, { formula: termFormula(t, rawCell(t.key, i)) }, { fmt: F.num3, align: 'center' }));
    put(ws, `${yStarCol}${dm0 + i}`, { formula: regRun.spec.yLog ? `LN(${rawYCell(i)})` : `${rawYCell(i)}` }, { fmt: F.num3, align: 'center' });
    rr++;
  }
  const dCol = (j) => colL(2 + j);
  const dRange = (j) => `${dCol(j)}${dm0}:${dCol(j)}${dm0 + nObs - 1}`;
  const yRange = `${yStarCol}${dm0}:${yStarCol}${dm0 + nObs - 1}`;
  rr++;

  /* ---- normal equations ---- */
  sectionHeader(ws, rr++, "NORMAL EQUATIONS — X'X and X'y", 3 + dim);
  const neHead = rr;
  for (let j = 0; j < dim; j++) put(ws, `${colL(2 + j)}${neHead}`, j === 0 ? 'const' : terms[j - 1].label, { bold: true, fill: C_SECTION_FILL, align: 'center' });
  put(ws, `${colL(2 + dim)}${neHead}`, "X'y", { bold: true, fill: C_SECTION_FILL, align: 'center' });
  rr++;
  const ne0 = rr;
  for (let i = 0; i < dim; i++) {
    put(ws, `A${ne0 + i}`, i === 0 ? 'const' : terms[i - 1].label, { bold: true });
    for (let j = 0; j < dim; j++) put(ws, `${colL(2 + j)}${ne0 + i}`, { formula: `SUMPRODUCT(${dRange(i)},${dRange(j)})` }, { fmt: F.num, align: 'center' });
    put(ws, `${colL(2 + dim)}${ne0 + i}`, { formula: `SUMPRODUCT(${dRange(i)},${yRange})` }, { fmt: F.num, align: 'center' });
    rr++;
  }
  rr++;

  /* ---- Gauss-Jordan elimination on [X'X | X'y | I] ---- */
  sectionHeader(ws, rr++, "SOLVE — GAUSS-JORDAN ON [X'X | X'y | I]  (final block: β and (X'X)⁻¹)", 2 + 2 * dim + 1);
  const gjHead = rr;
  for (let j = 0; j < dim; j++) put(ws, `${colL(2 + j)}${gjHead}`, `a${j + 1}`, { bold: true, fill: C_SECTION_FILL, align: 'center' });
  put(ws, `${colL(2 + dim)}${gjHead}`, 'b', { bold: true, fill: C_SECTION_FILL, align: 'center' });
  for (let j = 0; j < dim; j++) put(ws, `${colL(3 + dim + j)}${gjHead}`, `e${j + 1}`, { bold: true, fill: C_SECTION_FILL, align: 'center' });
  rr++;
  const width = 2 * dim + 1;
  const blocks = [];
  blocks[0] = rr;
  for (let i = 0; i < dim; i++) {
    put(ws, `A${rr}`, i === 0 ? 'augmented' : '', { italic: true, color: C_MUTED });
    for (let c = 0; c < width; c++) {
      if (c < dim + 1) put(ws, `${colL(2 + c)}${rr}`, { formula: `${colL(2 + c)}${ne0 + i}` }, { fmt: F.num3, align: 'center' });
      else put(ws, `${colL(2 + c)}${rr}`, c - (dim + 1) === i ? 1 : 0, { align: 'center' });
    }
    rr++;
  }
  for (let p = 0; p < dim; p++) {
    const prev = blocks[p];
    blocks[p + 1] = rr;
    for (let i = 0; i < dim; i++) {
      put(ws, `A${rr}`, i === 0 ? `eliminate col ${p + 1}` : '', { italic: true, color: C_MUTED });
      for (let c = 0; c < width; c++) {
        const cc = colL(2 + c);
        const prevCell = `${cc}${prev + i}`;
        const pivCell = `${colL(2 + p)}${prev + p}`;
        const f = i === p ? `${prevCell}/${pivCell}` : `${prevCell}-${colL(2 + p)}${prev + i}*${cc}${blocks[p + 1] + p}`;
        put(ws, `${cc}${rr}`, { formula: f }, { fmt: F.num3, align: 'center' });
      }
      rr++;
    }
  }
  const fin = blocks[dim];
  const betaCell = (i) => `${colL(2 + dim)}${fin + i}`;
  const invCell = (i, j) => `${colL(3 + dim + j)}${fin + i}`;
  rr++;

  /* ---- fit per peer ---- */
  sectionHeader(ws, rr++, 'FIT — fitted values & residuals', 5);
  put(ws, `A${rr}`, 'Peer', { bold: true, fill: C_SECTION_FILL });
  ['Actual y*', 'Fitted', 'Residual'].forEach((h, i) => put(ws, `${colL(2 + i)}${rr}`, h, { bold: true, fill: C_SECTION_FILL, align: 'center' }));
  rr++;
  const ft0 = rr;
  const fittedExpr = (i) => `${betaCell(0)}+${terms.map((_, j) => `${betaCell(j + 1)}*${dCol(j + 1)}${dm0 + i}`).join('+')}`;
  for (let i = 0; i < nObs; i++) {
    put(ws, `A${ft0 + i}`, { formula: `A${pd0 + i}` });
    put(ws, `B${ft0 + i}`, { formula: `${yStarCol}${dm0 + i}` }, { fmt: F.num3, align: 'center' });
    put(ws, `C${ft0 + i}`, { formula: fittedExpr(i) }, { fmt: F.num3, align: 'center' });
    put(ws, `D${ft0 + i}`, { formula: `B${ft0 + i}-C${ft0 + i}` }, { fmt: F.num3, align: 'center' });
    rr++;
  }
  const residRange = `D${ft0}:D${ft0 + nObs - 1}`;
  rr++;

  /* ---- model statistics ---- */
  sectionHeader(ws, rr++, 'MODEL STATISTICS', 4);
  const S = {};
  const sVal = (key, label, formula, fmt, note = '') => {
    put(ws, `A${rr}`, label);
    put(ws, `B${rr}`, { formula }, { fmt, align: 'center' });
    if (note) put(ws, `D${rr}`, note, { italic: true, color: C_MUTED });
    S[key] = rr;
    return rr++;
  };
  sVal('n', 'Observations (n)', `${nObs}`, F.int);
  sVal('k', 'Terms (k)', `${terms.length}`, F.int);
  sVal('df', 'Degrees of freedom', `B${S.n}-B${S.k}-1`, F.int);
  sVal('sse', 'SSE (residual sum of squares)', `SUMPRODUCT(${residRange},${residRange})`, F.num3);
  sVal('sst', 'SST (total sum of squares)', `SUMPRODUCT(${yRange}-AVERAGE(${yRange}),${yRange}-AVERAGE(${yRange}))`, F.num3);
  sVal('r2', 'R²', `1-B${S.sse}/B${S.sst}`, F.pct2);
  sVal('adjr2', 'Adjusted R²', `1-(B${S.sse}/B${S.df})/(B${S.sst}/(B${S.n}-1))`, F.pct2);
  sVal('mse', 'MSE (SSE / df)', `B${S.sse}/B${S.df}`, F.num3);
  sVal('se', 'SE of regression', `SQRT(B${S.mse})`, F.num3, regRun.spec.yLog ? 'in ln(y) units' : '');
  sVal('f', 'F-statistic', `((B${S.sst}-B${S.sse})/B${S.k})/B${S.mse}`, F.num);
  rr++;

  /* ---- coefficient table ---- */
  sectionHeader(ws, rr++, 'COEFFICIENTS', 5);
  put(ws, `A${rr}`, 'Term', { bold: true, fill: C_SECTION_FILL });
  ['β', 'Std error', 't-stat', 'p-value'].forEach((h, i) => put(ws, `${colL(2 + i)}${rr}`, h, { bold: true, fill: C_SECTION_FILL, align: 'center' }));
  rr++;
  for (let i = 0; i < dim; i++) {
    put(ws, `A${rr}`, i === 0 ? 'Intercept' : terms[i - 1].label, { bold: i === 0 });
    put(ws, `B${rr}`, { formula: betaCell(i) }, { fmt: F.num3, align: 'center', bold: true });
    put(ws, `C${rr}`, { formula: `SQRT(B${S.mse}*${invCell(i, i)})` }, { fmt: F.num3, align: 'center' });
    put(ws, `D${rr}`, { formula: `B${rr}/C${rr}` }, { fmt: F.num, align: 'center' });
    put(ws, `E${rr}`, { formula: `TDIST(ABS(D${rr}),B${S.df},2)` }, { fmt: '0.0000', align: 'center' });
    rr++;
  }
  rr++;

  /* ---- prediction for the target ---- */
  sectionHeader(ws, rr++, 'PREDICTION — THE TARGET', 4 + terms.length);
  put(ws, `A${rr}`, 'Target x (green = its Comps Summary row, blue = override)', { bold: true, fill: C_SECTION_FILL });
  usedX.forEach((k, i) => put(ws, `${colL(2 + i)}${rr}`, varLabel(k), { bold: true, fill: C_SECTION_FILL, align: 'center', wrap: true }));
  rr++;
  const tg = rr;
  put(ws, `A${tg}`, 'value');
  usedX.forEach((k, i) => {
    const ov = a.regression?.targetOverrides?.[k];
    const f = typeof ov === 'number' && Number.isFinite(ov) ? null : links.targetCell(k);
    if (f) put(ws, `${colL(2 + i)}${tg}`, { formula: f }, { fmt: F.num, color: C_LINK, align: 'center' });
    else put(ws, `${colL(2 + i)}${tg}`, nv(regRun.target[k]), { fmt: F.num, color: C_INPUT, fill: C_INPUT_FILL, align: 'center' });
  });
  rr += 2;
  const tRaw = (k) => `${colL(2 + usedX.indexOf(k))}${tg}`;
  put(ws, `A${rr}`, 'z (transformed)', { bold: true });
  put(ws, `B${rr}`, 1, { align: 'center' });
  terms.forEach((t, j) => put(ws, `${colL(3 + j)}${rr}`, { formula: na(termFormula(t, tRaw(t.key))) }, { fmt: F.num3, align: 'center' }));
  const z0 = rr;
  const zCell = (i) => (i === 0 ? `B${z0}` : `${colL(2 + i)}${z0}`);
  rr += 2;
  const P = {};
  const pVal = (key, label, formula, fmt, note = '', opts = {}) => {
    put(ws, `A${rr}`, label, opts);
    put(ws, `B${rr}`, { formula }, { fmt, align: 'center', ...opts });
    if (note) put(ws, `D${rr}`, note, { italic: true, color: C_MUTED });
    P[key] = rr;
    return rr++;
  };
  pVal('yhatT', regRun.spec.yLog ? 'ŷ (ln scale)' : 'ŷ (predicted y)', na(`${betaCell(0)}+${terms.map((_, j) => `${betaCell(j + 1)}*${zCell(j + 1)}`).join('+')}`), F.num3, 'NA when the target is missing a variable the model uses');
  const qTerms = [];
  for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) qTerms.push(`${zCell(i)}*${invCell(i, j)}*${zCell(j)}`);
  pVal('q', "z'(X'X)⁻¹z", na(qTerms.join('+')), F.num3);
  pVal('seP', 'SE of mean prediction', na(`SQRT(B${S.mse}*B${P.q})`), F.num3);
  const back = (expr) => na(regRun.spec.yLog ? `EXP(${expr})` : expr);
  pVal('pred', `Predicted ${yLabel}`, back(`B${P.yhatT}`), F.x2, '', { bold: true });
  pVal('predLo', '−1 SE', back(`B${P.yhatT}-B${P.seP}`), F.x2);
  pVal('predHi', '+1 SE', back(`B${P.yhatT}+B${P.seP}`), F.x2);
  rr++;

  /* ---- implied price bridge (y must be a valuation multiple) ---- */
  let refs = null;
  if (regRun.yDef?.multiple) {
    sectionHeader(ws, rr++, 'IMPLIED SHARE PRICE', 4);
    pVal('metric', 'Target metric', links.metric(regRun.yDef.spec), F.money, regRun.yDef.label, { color: C_LINK });
    const toPrice = (mult) => na(`IF(AND(${links.shares}>0,B${P.metric}>0),${regRun.yDef.multiple === 'ev'
      ? `(${mult}*B${P.metric}-${links.netDebt}-${links.nci}${links.nonOp ? `+${links.nonOp}` : ''})/${links.shares}`
      : `${mult}*B${P.metric}/${links.shares}`},"NA")`);
    pVal('px', 'Implied share price', toPrice(`B${P.pred}`), F.price, regRun.yDef.multiple === 'ev' ? 'EV less net debt and NCI, plus non-operating investments, over diluted shares' : 'Equity value over diluted shares', { bold: true });
    pVal('pxLo', '−1 SE', toPrice(`B${P.predLo}`), F.price);
    pVal('pxHi', '+1 SE', toPrice(`B${P.predHi}`), F.price);
    refs = { px: `'${ws.name}'!$B$${P.px}`, lo: `'${ws.name}'!$B$${P.pxLo}`, hi: `'${ws.name}'!$B$${P.pxHi}` };
  }
  rr++;
  put(ws, `A${rr}`, 'Everything above recalculates live: edit a company sheet, a blue cell or an input and the elimination, coefficients and prediction re-solve.', { italic: true, color: C_MUTED });
  return refs;
}

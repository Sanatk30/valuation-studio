/**
 * Native Excel charts for a saved workbook. ExcelJS writes no charts, so the
 * finished .xlsx (a zip) gets the chart parts added: the chart XML, a drawing
 * anchoring it on the sheet, their relationships and content types — the
 * same parts Excel itself writes. Each chart is a stacked horizontal bar
 * (a football field: an invisible "low" series, then the low → high range).
 *
 * chart = { sheet, row, col (0-based anchor), cx, cy (EMU), title, axisTitle,
 *           cat (category range), series: [{ name (cell ref), val (range), fill (hex or null = invisible) }] }
 */
import JSZip from 'jszip';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const rich = (text) => `<c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx>`;

export function chartXml(ch) {
  const ser = ch.series.map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>`
    + `<c:tx><c:strRef><c:f>${esc(s.name)}</c:f></c:strRef></c:tx>`
    + `<c:spPr>${s.fill ? `<a:solidFill><a:srgbClr val="${s.fill}"/></a:solidFill>` : '<a:noFill/>'}<a:ln>${s.fill ? '' : '<a:noFill/>'}<a:prstDash val="solid"/></a:ln></c:spPr>`
    + `<c:cat><c:strRef><c:f>${esc(ch.cat)}</c:f></c:strRef></c:cat>`
    + `<c:val><c:numRef><c:f>${esc(s.val)}</c:f></c:numRef></c:val></c:ser>`).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="${A}" xmlns:r="${REL}">`
    + `<c:chart><c:title>${rich(ch.title)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>`
    + `<c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>${ser}`
    + '<c:gapWidth val="60"/><c:overlap val="100"/><c:axId val="10"/><c:axId val="100"/></c:barChart>'
    + '<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>'
    + '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="100"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>'
    + '<c:valAx><c:axId val="100"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/>'
    + `<c:title>${rich(ch.axisTitle)}<c:overlay val="0"/></c:title><c:numFmt formatCode="#,##0" sourceLinked="0"/>`
    + '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="10"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>'
    + '</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>';
}

function drawingXml(ch, chartRid) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${A}">`
    + `<xdr:oneCellAnchor><xdr:from><xdr:col>${ch.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
    + `<xdr:ext cx="${ch.cx}" cy="${ch.cy}"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
    + '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
    + `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${REL}" r:id="${chartRid}"/>`
    + '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>';
}

const rels = (items) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;

/** The worksheet part path ("xl/worksheets/sheet2.xml") of a sheet name. */
async function sheetPath(zip, name) {
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const m = [...wbXml.matchAll(/<sheet\b[^>]*>/g)].map((x) => x[0]).find((t) => t.includes(`name="${esc(name)}"`));
  const rid = m && /r:id="([^"]+)"/.exec(m)?.[1];
  const relXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const rel = [...relXml.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]).find((t) => t.includes(`Id="${rid}"`));
  const target = rel && /Target="([^"]+)"/.exec(rel)?.[1];
  if (!target) throw new Error(`no sheet "${name}" in the workbook`);
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

/** Add `charts` to a saved .xlsx buffer; returns the new buffer (same type JSZip is asked for). */
export async function addCharts(buffer, charts, type = 'uint8array') {
  if (!charts?.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  let ct = await zip.file('[Content_Types].xml').async('string');
  let n = 0;
  for (const ch of charts) {
    n++;
    const sheet = await sheetPath(zip, ch.sheet);
    const sheetRels = sheet.replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels');
    const opt = { createFolders: false };   // no bare folder entries in the package
    zip.file(`xl/charts/chart${n}.xml`, chartXml(ch), opt);
    zip.file(`xl/drawings/drawing${n}.xml`, drawingXml(ch, 'rId1'), opt);
    zip.file(`xl/drawings/_rels/drawing${n}.xml.rels`, rels([['rId1', 'chart', `../charts/chart${n}.xml`]]), opt);
    // the sheet's relationship to its drawing (keeping any it already has)
    const drawRid = `rIdQvDrawing${n}`;
    const existing = zip.file(sheetRels) ? await zip.file(sheetRels).async('string') : null;
    const rel = `<Relationship Id="${drawRid}" Type="${REL}/drawing" Target="../drawings/drawing${n}.xml"/>`;
    zip.file(sheetRels, existing ? existing.replace('</Relationships>', `${rel}</Relationships>`) : rels([[drawRid, 'drawing', `../drawings/drawing${n}.xml`]]), opt);
    let xml = await zip.file(sheet).async('string');
    if (!/xmlns:r=/.test(xml.slice(0, 600))) xml = xml.replace('<worksheet ', `<worksheet xmlns:r="${REL}" `);
    // <drawing> goes after the page setup elements, before legacyDrawing / tableParts / extLst
    const tag = `<drawing r:id="${drawRid}"/>`;
    const before = ['<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>']
      .map((t) => xml.indexOf(t)).filter((i) => i >= 0);
    const at = Math.min(...before);
    xml = xml.slice(0, at) + tag + xml.slice(at);
    zip.file(sheet, xml);
    ct = ct.replace('</Types>',
      `<Override PartName="/xl/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`
      + `<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  }
  zip.file('[Content_Types].xml', ct);
  return zip.generateAsync({ type, compression: 'DEFLATE' });
}

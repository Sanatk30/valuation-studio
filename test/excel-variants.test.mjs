/** Build + recalc the workbook under edge-case assumption sets. */
import { DEFAULT_ASSUMPTIONS } from '../src/lib/defaults.js';
import { buildWorkbook } from '../src/lib/excel/exportExcel.js';
import { computeDcf } from '../src/lib/engine/dcf.js';
import { computeLbo } from '../src/lib/engine/lbo.js';
import { buildPerYearGrid } from '../src/lib/engine/drivers.js';
import { HyperFormula } from 'hyperformula';

const variants = {
  'per-year grid, absolute rev/EBITDA': (a) => ({
    ...a,
    drivers: {
      ...a.drivers,
      perYear: {
        ...buildPerYearGrid(a.drivers),
        revenueMode: 'abs', revenue: [5600, 6100, 6700, 7200, 7800],
        ebitdaMode: 'abs', ebitda: [1250, 1380, 1540, 1700, 1900],
        capexMode: 'abs', capex: [330, 360, 400, 430, 460],
      },
    },
  }),
  'years=3': (a) => ({ ...a, drivers: { ...a.drivers, years: 3 }, lbo: { ...a.lbo, exitYear: 3 } }),
  'years=10': (a) => ({ ...a, drivers: { ...a.drivers, years: 10 }, lbo: { ...a.lbo, exitYear: 7 } }),
  'custom arrays': (a) => ({
    ...a,
    drivers: { ...a.drivers, growthCustom: [15, 14, 6, 9, 2], marginCustom: [20, 21, 25, 23, 26] },
  }),
  'no mid-year, USD Mn': (a) => ({
    ...a,
    settings: { currency: 'USD', unit: 'Mn' },
    dcf: { ...a.dcf, midYear: false, primaryTV: 'exit' },
  }),
  'exit year < horizon': (a) => ({ ...a, lbo: { ...a.lbo, exitYear: 3 } }),
};

let failures = 0;
for (const [name, mod] of Object.entries(variants)) {
  const a = mod(structuredClone(DEFAULT_ASSUMPTIONS));
  try {
    const wb = buildWorkbook(a);
    const hfSheets = {};
    wb.eachSheet((ws) => {
      const grid = [];
      ws.eachRow({ includeEmpty: true }, (row, rn) => {
        while (grid.length < rn - 1) grid.push([]);
        const arr = [];
        row.eachCell({ includeEmpty: true }, (cell, cn) => {
          while (arr.length < cn - 1) arr.push(null);
          let v = cell.value;
          if (v && typeof v === 'object' && v.formula) v = '=' + v.formula;
          arr.push(v === undefined ? null : v);
        });
        grid.push(arr);
      });
      hfSheets[ws.name] = grid;
    });
    const hf = HyperFormula.buildFromSheets(hfSheets, { licenseKey: 'gpl-v3', useArrayArithmetic: true, smartRounding: false });

    let errs = 0;
    for (const sname of Object.keys(hfSheets)) {
      const sid = hf.getSheetId(sname);
      const { height, width } = hf.getSheetDimensions(sid);
      for (let r = 0; r < height; r++)
        for (let c = 0; c < width; c++) {
          const v = hf.getCellValue({ sheet: sid, col: c, row: r });
          if (v && typeof v === 'object' && v.type) errs++;
        }
    }

    // find DCF implied price + LBO MOIC and compare
    // labelCol: the DCF page labels its output blocks in column G, the LBO in A
    const find = (sheet, label, col, labelCol = 0) => {
      const sid = hf.getSheetId(sheet);
      const { height } = hf.getSheetDimensions(sid);
      for (let r = 0; r < height; r++) {
        const v = hf.getCellValue({ sheet: sid, col: labelCol, row: r });
        if (typeof v === 'string' && v.trim() === label) return hf.getCellValue({ sheet: sid, col, row: r });
      }
      return undefined;
    };
    const dcfEng = computeDcf(a);
    const lboEng = computeLbo(a);
    const xlG = find('DCF', 'Implied Share Price', 8, 6);
    const xlMoic = find('LBO', 'MOIC', 1);
    const relG = Math.abs(xlG - dcfEng.gordon.price) / Math.abs(dcfEng.gordon.price);
    const relM = Math.abs(xlMoic - lboEng.moic) / Math.abs(lboEng.moic);
    const pass = errs === 0 && relG < 1e-9 && relM < 1e-9;
    if (!pass) failures++;
    console.log(
      `${pass ? 'ok  ' : 'FAIL'}: ${name} — errs=${errs}, dcf xl=${xlG?.toFixed?.(2)} eng=${dcfEng.gordon.price.toFixed(2)}, moic xl=${xlMoic?.toFixed?.(3)} eng=${lboEng.moic.toFixed(3)}`
    );
  } catch (e) {
    failures++;
    console.error(`FAIL: ${name} — threw ${e.message}`);
  }
}
console.log(failures ? `\n${failures} FAILURES` : '\nALL VARIANTS OK');
process.exit(failures ? 1 : 0);

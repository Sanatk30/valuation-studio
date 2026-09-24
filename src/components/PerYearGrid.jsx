import React from 'react';

/**
 * Spreadsheet-style per-year driver grid. Each row can be entered as a
 * percentage or as absolute values (toggle per row). Paste a row copied from
 * Excel/Sheets into any cell and it fills across from that year; the ⇥ button
 * copies Year 1 across all years.
 */
function GridRow({ label, modes, mode, onMode, values, onValues, years }) {
  const setCell = (i, v) => {
    const next = values.slice();
    next[i] = v;
    onValues(next);
  };

  const onPaste = (i, e) => {
    const text = e.clipboardData.getData('text');
    const parts = text.split(/[\t\n;,]+/).map((s) => parseFloat(String(s).replace(/[^\d.eE+-]/g, ''))).filter(isFinite);
    if (parts.length > 1) {
      e.preventDefault();
      const next = values.slice();
      parts.forEach((v, j) => {
        if (i + j < next.length) next[i + j] = v;
      });
      onValues(next);
    }
  };

  return (
    <tr>
      <td className="pylabel">
        <div>{label}</div>
        <select value={mode} onChange={(e) => onMode(e.target.value)}>
          {modes.map(([k, lbl]) => (
            <option key={k} value={k}>{lbl}</option>
          ))}
        </select>
      </td>
      {years.map((_, i) => (
        <td key={i}>
          <input
            type="number"
            step="any"
            value={values[i] ?? ''}
            onChange={(e) => setCell(i, parseFloat(e.target.value))}
            onPaste={(e) => onPaste(i, e)}
          />
        </td>
      ))}
      <td>
        <button className="pyfill" title="Copy Year 1 across all years" onClick={() => onValues(values.map(() => values[0] ?? 0))}>
          ⇥
        </button>
      </td>
    </tr>
  );
}

export default function PerYearGrid({ grid, years, onChange }) {
  const yearIdx = Array.from({ length: years }, (_, i) => i + 1);
  const setKey = (k, v) => onChange({ ...grid, [k]: v });

  return (
    <div className="pygridwrap">
      <table className="pygrid">
        <thead>
          <tr>
            <th />
            {yearIdx.map((y) => (
              <th key={y}>Y{y}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          <GridRow label="Revenue" years={yearIdx}
            modes={[['growth', 'growth %'], ['abs', 'absolute']]}
            mode={grid.revenueMode} onMode={(v) => setKey('revenueMode', v)}
            values={grid.revenue} onValues={(v) => setKey('revenue', v)} />
          <GridRow label="EBITDA" years={yearIdx}
            modes={[['margin', 'margin %'], ['abs', 'absolute']]}
            mode={grid.ebitdaMode} onMode={(v) => setKey('ebitdaMode', v)}
            values={grid.ebitda} onValues={(v) => setKey('ebitda', v)} />
          <GridRow label="D&A" years={yearIdx}
            modes={[['pct', '% of rev'], ['abs', 'absolute']]}
            mode={grid.daMode} onMode={(v) => setKey('daMode', v)}
            values={grid.da} onValues={(v) => setKey('da', v)} />
          <GridRow label="Capex" years={yearIdx}
            modes={[['pct', '% of rev'], ['abs', 'absolute']]}
            mode={grid.capexMode} onMode={(v) => setKey('capexMode', v)}
            values={grid.capex} onValues={(v) => setKey('capex', v)} />
          <GridRow label="NWC balance" years={yearIdx}
            modes={[['pct', '% of rev'], ['abs', 'absolute']]}
            mode={grid.nwcMode} onMode={(v) => setKey('nwcMode', v)}
            values={grid.nwc} onValues={(v) => setKey('nwc', v)} />
        </tbody>
      </table>
      <div className="hint" style={{ marginTop: 6 }}>
        Tip: copy a row of numbers in Excel/Sheets and paste into any cell — it fills across from
        that year. ⇥ copies Year 1 to every year. Absolute figures are in your money unit.
      </div>
    </div>
  );
}

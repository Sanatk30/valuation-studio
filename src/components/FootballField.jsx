import React, { useMemo } from 'react';
import LiveChart from './LiveChart.jsx';
import { footballOption } from '../lib/chartkit.js';
import { useThemeMode } from '../lib/theme.js';

/**
 * Football-field valuation chart: each row's low–high bar, a dot at its value,
 * the market price as a dashed line. Hover a row for the detail; the bars
 * animate to their new positions as the inputs change.
 * items: { label, low, mid, high, highlight?, alt? }
 */
export default function FootballField({ items, currentPrice, fmt, axisTitle = '', big = true }) {
  const theme = useThemeMode();
  const sig = items.map((it) => `${it.label}|${it.low}|${it.mid}|${it.high}|${it.highlight ? 1 : 0}|${it.alt ? 1 : 0}`).join(',');
  const option = useMemo(
    () => footballOption(items, { price: currentPrice, fmt, axisTitle }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, currentPrice, axisTitle, theme]
  );
  if (!option) return <div className="sec-note">No valid ranges to plot.</div>;
  const n = items.filter((it) => isFinite(it.low) && isFinite(it.high)).length;
  return <LiveChart option={option} height={Math.max(240, 92 + n * (big ? 62 : 48))} />;
}

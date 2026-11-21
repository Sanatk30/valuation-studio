import React, { useMemo } from 'react';
import LiveChart from './LiveChart.jsx';
import { waterfallOption } from '../lib/chartkit.js';
import { useTweenedArray } from '../lib/anim.jsx';
import { useThemeMode } from '../lib/theme.js';

/**
 * Waterfall chart. items: { label, value, total? } — totals restart the bar
 * from zero (entry/exit/EV style); deltas float from the running level.
 * Values spring-tween as the model moves; ECharts animates the bars.
 */
export default function Waterfall({ items: rawItems, fmt, height = 340 }) {
  const targets = useMemo(() => rawItems.map((it) => it.value), [rawItems.map((it) => it.value).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const tw = useTweenedArray(targets);
  const theme = useThemeMode();
  const option = useMemo(
    () => waterfallOption(rawItems.map((it, i) => ({ ...it, value: tw[i] })), fmt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tw.join('|'), rawItems.map((it) => `${it.label}|${it.total ? 1 : 0}`).join(','), fmt, theme]
  );
  return <LiveChart option={option} height={Math.max(height, 340)} />;
}

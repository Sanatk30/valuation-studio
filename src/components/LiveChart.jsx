import React, { lazy, Suspense } from 'react';

// The echarts runtime loads lazily (shared chunk with the Charts/Ratios
// views); option objects come from the pure chartkit.js helpers.
const EChartLazy = lazy(() => import('../lib/echart.jsx'));

/** Drop-in animated chart for the method tabs: fixed-height, lazy canvas.
 *  Extra props (group, onEvents, ghost) pass straight through to EChart. */
export default function LiveChart({ option, height = 250, ...rest }) {
  return (
    <div style={{ width: '100%', height }}>
      <Suspense fallback={<div style={{ height }} />}>
        <EChartLazy option={option} style={{ height }} {...rest} />
      </Suspense>
    </div>
  );
}

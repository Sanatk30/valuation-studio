import React from 'react';

/** Quant Value mark: a triangle of bars with a rising signal arrow to the apex. */
export default function Logo({ size = 34 }) {
  return (
    <svg className="qv-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="qvTri" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5B5FC7" stopOpacity="0.55" />
          <stop offset="1" stopColor="#343873" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="qvArrow" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#1FA463" />
          <stop offset="1" stopColor="#7CF7B0" />
        </linearGradient>
      </defs>
      <path d="M24 4 L45 43 H3 Z" fill="url(#qvTri)" stroke="#7C80E0" strokeOpacity="0.55" strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="11" y="31" width="4.5" height="12" rx="0.8" fill="#8487E6" opacity="0.55" />
      <rect x="18" y="26" width="4.5" height="17" rx="0.8" fill="#8487E6" opacity="0.5" />
      <rect x="26.5" y="29" width="4.5" height="14" rx="0.8" fill="#8487E6" opacity="0.5" />
      <rect x="33" y="33" width="4.5" height="10" rx="0.8" fill="#8487E6" opacity="0.55" />
      <path d="M8 38 L16 30 L20 34 L28 20 L31 24 L24 9" fill="none" stroke="url(#qvArrow)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.6 12.2 L24 5.5 L27.4 12.9 Z" fill="#7CF7B0" />
      <circle cx="24" cy="6" r="2.4" fill="#C9FFE0" opacity="0.9" />
    </svg>
  );
}

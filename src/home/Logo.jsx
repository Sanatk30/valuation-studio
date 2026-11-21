import React from 'react';

/** Quant Value mark: a rounded tile with rising bars and a signal line to the top. Colours follow the theme. */
export default function Logo({ size = 30 }) {
  return (
    <svg className="qv-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="1" y="1" width="46" height="46" rx="7" style={{ fill: 'var(--accent)' }} />
      <rect x="10" y="30" width="5" height="9" rx="1.2" fill="#FFFFFF" opacity="0.45" />
      <rect x="18" y="25" width="5" height="14" rx="1.2" fill="#FFFFFF" opacity="0.55" />
      <rect x="26" y="20" width="5" height="19" rx="1.2" fill="#FFFFFF" opacity="0.65" />
      <rect x="34" y="14" width="5" height="25" rx="1.2" fill="#FFFFFF" opacity="0.75" />
      <path d="M9 26 L17 19 L23 22 L36 10" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="36.5" cy="9.8" r="2.6" fill="#FFFFFF" />
    </svg>
  );
}

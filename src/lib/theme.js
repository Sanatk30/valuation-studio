/**
 * Light / dark theme. Light is the default; the choice made with the header
 * toggle is remembered in this browser. index.html sets <html data-theme>
 * before the first paint with the same rule, so the page never flashes the
 * other theme.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { setChartMode } from './chartkit.js';

// v2: choices saved before the redesign are dropped, so every browser starts on light
const KEY = 'qv-theme-v2';

export function storedTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
}
export function systemTheme() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
}
const initial = () => {
  const d = document.documentElement.dataset.theme;
  return d === 'light' || d === 'dark' ? d : storedTheme() || 'light';
};

/** The current theme name; charts re-build their options when it changes. */
export const ThemeContext = createContext('light');
export const useThemeMode = () => useContext(ThemeContext);

/** App-level state: [theme, toggle]. Keeps <html data-theme> and the chart palette in step. */
export function useThemeState() {
  const [theme, setTheme] = useState(initial);
  setChartMode(theme);   // before the children render: their chart options read the palette

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0C1112' : '#F3F5F5');
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch { /* private window: the choice lasts this visit */ }
      const html = document.documentElement;
      html.classList.add('theme-fade');
      setTimeout(() => html.classList.remove('theme-fade'), 320);
      return next;
    });
  }, []);
  return [theme, toggle];
}

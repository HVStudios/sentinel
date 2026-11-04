import { useCallback, useEffect, useState } from 'react';

/** Day chart (light) or night chart (dark), like a navigation chart's day and night palettes. */
export type Theme = 'day' | 'night';

const KEY = 'sentinel.theme';

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'day' || v === 'night' ? v : null;
  } catch {
    return null;
  }
}

function system(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
}

/** The theme to paint before React renders, so the page never flashes the other palette. */
export function initialTheme(): Theme {
  return stored() ?? system();
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
}

/**
 * The chosen chart mode. Follows the system setting until the viewer picks one,
 * which is then kept in this browser only.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [explicit, setExplicit] = useState(() => stored() !== null);

  useEffect(() => applyTheme(theme), [theme]);

  // Follow system changes until the viewer has chosen.
  useEffect(() => {
    if (explicit || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setThemeState(mq.matches ? 'night' : 'day');
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [explicit]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    setExplicit(true);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // Private mode or blocked storage: the choice lasts for this page only.
    }
  }, []);

  return { theme, setTheme };
}

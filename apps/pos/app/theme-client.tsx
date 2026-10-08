'use client';

import { useCallback, useEffect, useState } from 'react';
import { MoonStar, SunMedium } from 'lucide-react';
import { T360_THEME_DEFAULT, T360_THEME_STORAGE_KEY, type T360Theme } from './theme-contract';

function readStoredTheme(): T360Theme {
  try {
    return window.localStorage.getItem(T360_THEME_STORAGE_KEY) === 'dark' ? 'dark' : T360_THEME_DEFAULT;
  } catch {
    return T360_THEME_DEFAULT;
  }
}

function applyTheme(theme: T360Theme) {
  // The CSS keys its dark palette on [data-t360-theme='dark'] and [data-theme='dark'].
  // dataset.t360Theme expands to the data-t360-theme attribute, so writing both the kebab and
  // the bare data-theme form keeps every stylesheet in the four apps in agreement. Previously
  // only data-t360-theme was set, so the POS and employee-portal login screens — which render
  // outside their themed shell — had no attribute for the dark rules to match and the toggle
  // appeared to do nothing.
  const root = document.documentElement;
  document.documentElement.dataset.t360Theme = theme;
  root.setAttribute('data-t360-theme', theme);
  root.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

export function useT360Theme() {
  const [theme, setThemeState] = useState<T360Theme>(T360_THEME_DEFAULT);

  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    applyTheme(stored);
  }, []);

  const setTheme = useCallback((next: T360Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(T360_THEME_STORAGE_KEY, next);
    } catch {
      // Persistence failure must not break the UI; current document theme still applies.
    }
  }, []);

  return {
    theme,
    setTheme,
    toggleTheme: () => setTheme(theme === 'light' ? 'dark' : 'light'),
  };
}

export function T360ThemeToggle({ className = 't360ThemeToggle' }: { className?: string }) {
  const { theme, toggleTheme } = useT360Theme();
  return (
    <button
      type="button"
      className={className}
      aria-label={theme === 'light' ? 'Aktifkan mode gelap' : 'Aktifkan mode terang'}
      title={theme === 'light' ? 'Mode gelap' : 'Mode terang'}
      onClick={toggleTheme}
    >
      {theme === 'light' ? <MoonStar size={16} /> : <SunMedium size={16} />}
    </button>
  );
}

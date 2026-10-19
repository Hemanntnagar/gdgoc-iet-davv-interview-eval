import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'gdgoc-theme';
const THEME_COLOR: Record<Theme, string> = { light: '#4285F4', dark: '#121417' };
const listeners = new Set<() => void>();
let current: Theme = 'light';
let explicit = false;
let initialized = false;

function systemTheme(): Theme {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme) {
  current = theme;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function initTheme() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const saved = stored();
  explicit = saved !== null;
  apply(saved ?? systemTheme());
  if (typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (!explicit) {
        apply(systemTheme());
        emit();
      }
    };
    if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
    else media.addListener(onChange);
  }
}

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme) {
  explicit = true;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage may be unavailable (private mode) */
  }
  apply(theme);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'light' as Theme);
  return {
    theme,
    setTheme,
    toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
  };
}

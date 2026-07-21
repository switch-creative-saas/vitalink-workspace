export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'vitalink-theme';
const LEGACY_THEME_KEY = 'vitalink-theme';
let mediaListenerCleanup: (() => void) | null = null;

function getSystemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return getSystemPrefersDark() ? 'dark' : 'light';
  return mode;
}

export function getSavedTheme(): ThemeMode {
  const saved =
    localStorage.getItem(THEME_KEY) ??
    localStorage.getItem(LEGACY_THEME_KEY) ??
    localStorage.getItem('switch-theme');
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  return 'light';
}

function applyResolvedTheme(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  root.classList.remove('light-theme', 'dark-theme');
  root.classList.add(resolved === 'dark' ? 'dark-theme' : 'light-theme');
  root.style.colorScheme = resolved;
}

function bindSystemThemeListener(mode: ThemeMode) {
  if (mediaListenerCleanup) {
    mediaListenerCleanup();
    mediaListenerCleanup = null;
  }
  if (mode !== 'system') return;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => applyResolvedTheme(resolveTheme('system'));
  media.addEventListener('change', onChange);
  mediaListenerCleanup = () => media.removeEventListener('change', onChange);
}

export function applyTheme(mode: ThemeMode) {
  localStorage.setItem(THEME_KEY, mode);
  localStorage.setItem(LEGACY_THEME_KEY, mode);
  applyResolvedTheme(resolveTheme(mode));
  bindSystemThemeListener(mode);
}

export function initTheme() {
  applyTheme(getSavedTheme());
}


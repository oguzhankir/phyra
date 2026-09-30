import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

function savedPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem('phyra.theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // A restricted web preview can disable local storage.
  }
  return 'light';
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(savedPreference);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const theme = resolveTheme(preference, systemDark);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystemDark(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('phyra.theme', preference);
    } catch {
      // Theme selection still applies for the current session.
    }
  }, [preference, theme]);
  return { theme, preference, setPreference };
}

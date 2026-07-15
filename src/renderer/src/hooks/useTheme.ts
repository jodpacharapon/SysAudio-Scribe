import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'scribe_theme'

/**
 * Theme is a pure UI concern, so it lives in localStorage and is applied via a
 * `data-theme` attribute on the document root — no IPC, no main-process settings.
 * This keeps switching instant and survives reloads.
 */
function readInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  // Fall back to the OS preference on first run.
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme(): { theme: Theme; toggleTheme: () => void; setTheme: (theme: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => setThemeState(next), [])
  const toggleTheme = useCallback(() => setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark')), [])

  return { theme, toggleTheme, setTheme }
}

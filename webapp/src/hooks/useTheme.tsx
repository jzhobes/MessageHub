import React, { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

// Define context shape
interface ThemeContextType {
  theme: string;
  toggleTheme: () => void;
  mounted: boolean;
}

// Create context
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const emptySubscribe = () => () => {};
const themeListeners = new Set<() => void>();

function getServerTheme() {
  return 'light';
}

function getClientTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    return saved;
  }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);
  const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  mediaQuery?.addEventListener?.('change', listener);
  window.addEventListener('storage', listener);

  return () => {
    themeListeners.delete(listener);
    mediaQuery?.removeEventListener?.('change', listener);
    window.removeEventListener('storage', listener);
  };
}

function notifyThemeListeners() {
  themeListeners.forEach((listener) => listener());
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start the server snapshot in light mode to match SSR and avoid a hydration mismatch.
  const theme = useSyncExternalStore(subscribeTheme, getClientTheme, getServerTheme);
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const toggleTheme = useCallback(() => {
    const next = getClientTheme() === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', next);
    notifyThemeListeners();
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme, mounted }}>{children}</ThemeContext.Provider>;
}

// Hook to consume context
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// Define context shape
interface ThemeContextType {
  theme: string;
  toggleTheme: () => void;
  mounted: boolean;
}

// Create context
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always initialize to 'light' to match server-side rendering and avoid hydration mismatch
  const [theme, setTheme] = useState('light');
  const [mounted, setMounted] = useState(false);

  // Sync with localStorage on mount (Client only)
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('theme');
    if (saved && saved !== theme) {
      setTheme(saved);
    } else if (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches && theme !== 'dark') {
      setTheme('dark');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('theme', next);
  }, [theme]);

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

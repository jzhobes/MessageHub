import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/router';

interface AppContextType {
  isInitialized: boolean | null; // null means "checking"
  availability: Record<string, boolean>;
  refreshStatus: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState<boolean | null>(null);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const lastCheckedPathRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  const router = useRouter();

  const fetchStatus = useCallback(
    async (force = false) => {
      if (isFetchingRef.current) {
        return;
      }
      if (!force && lastCheckedPathRef.current === router.pathname) {
        return;
      }

      isFetchingRef.current = true;
      lastCheckedPathRef.current = router.pathname;

      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        setIsInitialized(data.initialized);
        setAvailability(data.platforms || {});

        // Global Guard: Redirect to home if uninitialized and not on home page
        if (data.initialized === false && router.pathname !== '/') {
          router.replace('/');
        }
      } catch (e) {
        console.error('Failed to fetch global status', e);
        setIsInitialized(false);
      } finally {
        isFetchingRef.current = false;
      }
    },
    [router],
  );

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);
  // Re-check on path changes to ensure guard stays active

  return (
    <AppContext.Provider
      value={{
        isInitialized,
        availability,
        refreshStatus: fetchStatus,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

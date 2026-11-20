import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/router';

import { apiFetch } from '@/lib/client/apiClient';

interface AppContextType {
  isInitialized: boolean | null; // null means we're still checking.
  availability: Record<string, boolean>;
  refreshStatus: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

interface StatusResult {
  initialized: boolean;
  platforms?: Record<string, boolean>;
  shouldRedirectHome: boolean;
}

async function fetchStatusResult(pathname: string): Promise<StatusResult> {
  try {
    const res = await apiFetch('/api/status');
    const data = await res.json();
    return {
      initialized: data.initialized,
      platforms: data.platforms || {},
      shouldRedirectHome: data.initialized === false && pathname !== '/',
    };
  } catch (e) {
    console.error('Failed to fetch global status', e);
    return {
      initialized: false,
      shouldRedirectHome: false,
    };
  }
}

/**
 * Check `/api/status` on pathname changes for workspace setup and available platforms. Deduplicate
 * checks by path and allow one fetch at a time.
 * Send users back to `/` if they open another page before setting up a workspace.
 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState<boolean | null>(null);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const lastCheckedPathRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  const router = useRouter();

  const applyStatusResult = useCallback(
    (result: StatusResult) => {
      setIsInitialized(result.initialized);
      if (result.platforms) {
        setAvailability(result.platforms);
      }

      // Send users without a workspace back home.
      if (result.shouldRedirectHome) {
        router.replace('/');
      }
    },
    [router],
  );

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
        const result = await fetchStatusResult(router.pathname);
        applyStatusResult(result);
      } finally {
        isFetchingRef.current = false;
      }
    },
    [router.pathname, applyStatusResult],
  );

  // Check again when the path changes so navigation can't skip setup.
  useEffect(() => {
    if (isFetchingRef.current || lastCheckedPathRef.current === router.pathname) {
      return;
    }

    isFetchingRef.current = true;
    lastCheckedPathRef.current = router.pathname;

    fetchStatusResult(router.pathname)
      .then(applyStatusResult)
      .finally(() => {
        isFetchingRef.current = false;
      });
  }, [router.pathname, applyStatusResult]);

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

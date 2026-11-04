"use client";

import { createContext, useContext, useMemo } from "react";

interface DashboardUser {
  userName: string | null;
  firstName: string | null;
}

const DashboardUserContext = createContext<DashboardUser>({
  userName: null,
  firstName: null,
});

/** Makes the signed-in user's display name available to dashboard pages. */
export function DashboardUserProvider({
  userName,
  children,
}: {
  userName?: string | null;
  children: React.ReactNode;
}) {
  const value = useMemo<DashboardUser>(() => {
    const name = userName?.trim() || null;
    const firstName = name ? name.split(/\s+/)[0] || null : null;
    return { userName: name, firstName };
  }, [userName]);

  return (
    <DashboardUserContext.Provider value={value}>
      {children}
    </DashboardUserContext.Provider>
  );
}

export function useDashboardUser(): DashboardUser {
  return useContext(DashboardUserContext);
}

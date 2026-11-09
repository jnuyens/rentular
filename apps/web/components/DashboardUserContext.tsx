"use client";

import { createContext, useContext, useMemo } from "react";

/** Contact shown under "Need help?" when SUPPORT_EMAIL is not set. */
export const DEFAULT_SUPPORT_EMAIL = "privacy@rentular.com";

interface DashboardUser {
  userName: string | null;
  firstName: string | null;
  /** Stable id of the signed-in user, for per-user browser preferences. */
  userId: string | null;
  supportEmail: string;
}

const DashboardUserContext = createContext<DashboardUser>({
  userName: null,
  firstName: null,
  userId: null,
  supportEmail: DEFAULT_SUPPORT_EMAIL,
});

/** Makes the signed-in user's display name available to dashboard pages. */
export function DashboardUserProvider({
  userName,
  userId,
  supportEmail,
  children,
}: {
  userName?: string | null;
  userId?: string | null;
  supportEmail?: string | null;
  children: React.ReactNode;
}) {
  const value = useMemo<DashboardUser>(() => {
    const name = userName?.trim() || null;
    const firstName = name ? name.split(/\s+/)[0] || null : null;
    return {
      userName: name,
      firstName,
      userId: userId || null,
      supportEmail: supportEmail?.trim() || DEFAULT_SUPPORT_EMAIL,
    };
  }, [userName, userId, supportEmail]);

  return (
    <DashboardUserContext.Provider value={value}>
      {children}
    </DashboardUserContext.Provider>
  );
}

export function useDashboardUser(): DashboardUser {
  return useContext(DashboardUserContext);
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Users, UserPlus } from "lucide-react";
import RoleBadge from "@/components/RoleBadge";

interface Manager {
  id: string;
  propertyId: string;
  userId: string | null;
  role: string;
  invitedBy: string;
  invitedAt: string;
  acceptedAt: string | null;
  invitationEmail: string;
  user: { name: string | null; email: string | null } | null;
}

const EDITABLE_ROLES = ["co_owner", "manager", "accountant", "viewer"];

export default function PropertyManagersPage() {
  const t = useTranslations("managers");
  const params = useParams<{ id: string }>();
  const propertyId = params.id;

  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [propertyName, setPropertyName] = useState("");

  // Invite modal state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("manager");
  const [inviteError, setInviteError] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchManagers = useCallback(async () => {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/property-managers?propertyId=${propertyId}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const json = await res.json();
        setManagers(json.data || []);
      } else {
        setError(t("loadError"));
      }
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, propertyId, t]);

  const fetchPropertyName = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/properties/${propertyId}`, {
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        setPropertyName(json.data?.name || "");
      }
    } catch {
      // Property name is optional for display
    }
  }, [apiUrl, propertyId]);

  useEffect(() => {
    fetchManagers();
    fetchPropertyName();
  }, [fetchManagers, fetchPropertyName]);

  // Escape key handler for modal
  useEffect(() => {
    if (!showInvite) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeInviteModal();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showInvite]);

  // Focus trap: focus modal on open
  useEffect(() => {
    if (showInvite && modalRef.current) {
      const firstInput = modalRef.current.querySelector("input");
      if (firstInput) (firstInput as HTMLInputElement).focus();
    }
  }, [showInvite]);

  const openInviteModal = () => {
    setInviteEmail("");
    setInviteRole("manager");
    setInviteError("");
    setShowInvite(true);
  };

  const closeInviteModal = () => {
    setShowInvite(false);
    setInviteEmail("");
    setInviteRole("manager");
    setInviteError("");
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteSubmitting(true);
    setInviteError("");

    try {
      const res = await fetch(`${apiUrl}/api/v1/property-managers/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          propertyId,
          email: inviteEmail,
          role: inviteRole,
        }),
      });

      if (res.status === 409) {
        setInviteError(t("duplicateError"));
        return;
      }

      if (!res.ok) {
        setInviteError(t("inviteError"));
        return;
      }

      closeInviteModal();
      fetchManagers();
    } catch {
      setInviteError(t("inviteError"));
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleRoleChange = async (managerId: string, newRole: string, previousRole: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/property-managers/${managerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role: newRole }),
      });

      if (res.ok) {
        setManagers((prev) =>
          prev.map((m) => (m.id === managerId ? { ...m, role: newRole } : m))
        );
      } else {
        // Revert on error
        setManagers((prev) =>
          prev.map((m) => (m.id === managerId ? { ...m, role: previousRole } : m))
        );
      }
    } catch {
      // Revert on error
      setManagers((prev) =>
        prev.map((m) => (m.id === managerId ? { ...m, role: previousRole } : m))
      );
    }
  };

  const handleRevoke = async (manager: Manager) => {
    const name = manager.user?.name || manager.invitationEmail;
    const confirmed = window.confirm(
      t("revokeConfirm", { name, property: propertyName || propertyId })
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`${apiUrl}/api/v1/property-managers/${manager.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (res.ok) {
        setManagers((prev) => prev.filter((m) => m.id !== manager.id));
      }
    } catch {
      // Silently fail
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t("subtitle")}
          </p>
        </div>
        <button
          onClick={openInviteModal}
          className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
        >
          <UserPlus className="h-4 w-4" />
          {t("inviteManager")}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : managers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-16">
          <Users className="h-12 w-12 text-[hsl(var(--muted-foreground))]" />
          <h3 className="mt-4 text-lg font-semibold">{t("emptyTitle")}</h3>
          <p className="mt-1 max-w-sm text-center text-sm text-[hsl(var(--muted-foreground))]">
            {t("emptyDescription")}
          </p>
          <button
            onClick={openInviteModal}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
          >
            <UserPlus className="h-4 w-4" />
            {t("inviteManager")}
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                <th className="px-4 py-3 text-left text-sm font-semibold">{t("headerName")}</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">{t("headerEmail")}</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">{t("headerRole")}</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">{t("headerStatus")}</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">{t("headerActions")}</th>
              </tr>
            </thead>
            <tbody>
              {managers.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-[hsl(var(--border))] last:border-b-0"
                >
                  <td className="px-4 py-3 text-sm">
                    {m.user?.name || m.invitationEmail}
                  </td>
                  <td className="px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
                    {m.user?.email || m.invitationEmail}
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={m.role} />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {m.acceptedAt ? (
                      <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-semibold text-yellow-700">
                        {t("pending")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {m.role === "owner" ? (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">-</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.id, e.target.value, m.role)}
                          className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs"
                        >
                          {EDITABLE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r === "co_owner"
                                ? "Co-owner"
                                : r.charAt(0).toUpperCase() + r.slice(1)}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleRevoke(m)}
                          className="text-sm text-[hsl(var(--destructive))] hover:underline"
                        >
                          {t("revoke")}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeInviteModal();
          }}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 className="mb-4 text-lg font-semibold">{t("inviteTitle")}</h2>

            {inviteError && (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                {inviteError}
              </div>
            )}

            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label htmlFor="invite-email" className="mb-1 block text-sm font-semibold">
                  {t("emailLabel")}
                </label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t("emailPlaceholder")}
                  disabled={inviteSubmitting}
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="invite-role" className="mb-1 block text-sm font-semibold">
                  {t("roleLabel")}
                </label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  disabled={inviteSubmitting}
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                >
                  {EDITABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r === "co_owner"
                        ? "Co-owner"
                        : r.charAt(0).toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeInviteModal}
                  disabled={inviteSubmitting}
                  className="rounded-lg border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold hover:bg-[hsl(var(--muted))]"
                >
                  {t("discardInvitation")}
                </button>
                <button
                  type="submit"
                  disabled={inviteSubmitting}
                  className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {inviteSubmitting ? "..." : t("sendInvitation")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

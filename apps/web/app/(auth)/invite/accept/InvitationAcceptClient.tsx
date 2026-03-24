"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import RoleBadge from "@/components/RoleBadge";

interface InvitationDetails {
  propertyName: string;
  role: string;
  inviterName: string;
  invitationEmail: string;
}

const ROLE_LABEL_KEYS: Record<string, string> = {
  owner: "roleOwner",
  co_owner: "roleCoOwner",
  manager: "roleManager",
  accountant: "roleAccountant",
  viewer: "roleViewer",
};

export default function InvitationAcceptClient({ token }: { token: string }) {
  const t = useTranslations("managers");
  const [details, setDetails] = useState<InvitationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [declined, setDeclined] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  useEffect(() => {
    fetch(
      `${apiUrl}/api/v1/property-managers/invitation?token=${token}`,
      { credentials: "include" }
    )
      .then(async (res) => {
        if (res.status === 410) {
          setError("expired");
          return;
        }
        if (res.status === 409) {
          setError("already_accepted");
          return;
        }
        if (!res.ok) {
          setError("invalid");
          return;
        }
        const json = await res.json();
        setDetails(json.data);
      })
      .catch(() => setError("network"))
      .finally(() => setLoading(false));
  }, [token, apiUrl]);

  const handleAccept = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/property-managers/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });

      if (res.ok) {
        window.location.href = "/properties";
      } else {
        setError("accept_failed");
      }
    } catch {
      setError("network");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/property-managers/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });

      if (res.ok) {
        setDeclined(true);
      } else {
        setError("decline_failed");
      }
    } catch {
      setError("network");
    } finally {
      setSubmitting(false);
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      );
    }

    if (declined) {
      return (
        <div className="text-center">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t("declineSuccess")}
          </p>
          <a
            href="/properties"
            className="mt-4 inline-block text-sm text-[hsl(var(--primary))] hover:underline"
          >
            Go to dashboard
          </a>
        </div>
      );
    }

    if (error === "expired") {
      return (
        <div className="text-center">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t("expiredToken")}
          </p>
          <a
            href="/properties"
            className="mt-4 inline-block text-sm text-[hsl(var(--primary))] hover:underline"
          >
            Go to dashboard
          </a>
        </div>
      );
    }

    if (error === "invalid" || error === "already_accepted") {
      return (
        <div className="text-center">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t("invalidToken")}
          </p>
          <a
            href="/properties"
            className="mt-4 inline-block text-sm text-[hsl(var(--primary))] hover:underline"
          >
            Go to dashboard
          </a>
        </div>
      );
    }

    if (error === "network" || error === "accept_failed" || error === "decline_failed") {
      return (
        <div className="text-center">
          <p className="mb-4 text-sm text-red-700">
            Something went wrong. Please try again.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-[hsl(var(--primary))] hover:underline"
          >
            Retry
          </button>
        </div>
      );
    }

    if (details) {
      const roleLabel = t(ROLE_LABEL_KEYS[details.role] || "roleViewer");
      return (
        <div className="space-y-6">
          <div className="text-center">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {t("acceptBody", {
                inviterName: details.inviterName,
                propertyName: details.propertyName,
                role: roleLabel,
              })}
            </p>
            <div className="mt-3 flex justify-center">
              <RoleBadge role={details.role} />
            </div>
          </div>

          <button
            onClick={handleAccept}
            disabled={submitting}
            autoFocus
            className="w-full rounded-lg bg-[hsl(var(--primary))] px-6 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "..." : t("acceptInvitation")}
          </button>

          <button
            onClick={handleDecline}
            disabled={submitting}
            className="w-full rounded-lg border border-[hsl(var(--border))] px-6 py-3 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            {t("declineInvitation")}
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[hsl(var(--muted))]">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.04]">
        <Image
          src="/rentular.png"
          alt=""
          width={600}
          height={600}
          className="select-none"
        />
      </div>

      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitcher />
      </div>

      <div className="relative w-full max-w-md rounded-xl bg-[hsl(var(--background))] p-8 shadow-lg">
        <div className="mb-6 text-center">
          <Image
            src="/rentular.png"
            alt="Rentular"
            width={56}
            height={56}
            className="mx-auto mb-3"
          />
          <h1 className="text-2xl font-semibold">{t("acceptTitle")}</h1>
        </div>

        {renderContent()}
      </div>
    </div>
  );
}

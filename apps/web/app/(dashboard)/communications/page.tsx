"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Mail,
  MessageSquare,
  ChevronDown,
  AlertCircle,
} from "lucide-react";

interface Communication {
  id: string;
  type: string;
  channel: "email" | "sms";
  recipientName: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

interface Property {
  id: string;
  name: string;
}

interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
}

export default function CommunicationsPage() {
  const t = useTranslations("communications");

  const [communications, setCommunications] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [propertyFilter, setPropertyFilter] = useState("");
  const [tenantFilter, setTenantFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const typeLabels: Record<string, string> = {
    payment_reminder_friendly: t("typeFriendlyReminder"),
    payment_reminder_formal: t("typeFormalReminder"),
    payment_reminder_final: t("typeFinalWarning"),
    indexation_notification: t("typeIndexation"),
    landlord_report: t("typeLandlordReport"),
    custom: t("typeCustom"),
    welcome: t("typeWelcome"),
    lease_renewal: t("typeLeaseRenewal"),
    lease_termination: t("typeLeaseTermination"),
    other: t("typeOther"),
  };

  const statusColors: Record<string, string> = {
    queued: "bg-yellow-100 text-yellow-700",
    sent: "bg-green-100 text-green-700",
    delivered: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    bounced: "bg-red-100 text-red-700",
  };

  const statusLabels: Record<string, string> = {
    queued: t("statusQueued"),
    sent: t("statusSent"),
    delivered: t("statusDelivered"),
    failed: t("statusFailed"),
    bounced: t("statusBounced"),
  };

  const fetchCommunications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ perPage: "50" });
      if (propertyFilter) params.set("propertyId", propertyFilter);
      if (tenantFilter) params.set("tenantId", tenantFilter);
      if (typeFilter) params.set("type", typeFilter);

      const res = await fetch(
        `${apiUrl}/api/v1/communications?${params.toString()}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const json = await res.json();
        setCommunications(json.data || []);
      } else {
        setError(t("loadError"));
      }
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, propertyFilter, tenantFilter, typeFilter, t]);

  const fetchFilters = useCallback(async () => {
    try {
      const [propRes, tenantRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/properties`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/tenants`, { credentials: "include" }),
      ]);
      if (propRes.ok) {
        const json = await propRes.json();
        setProperties(json.data || []);
      }
      if (tenantRes.ok) {
        const json = await tenantRes.json();
        setTenants(json.data || []);
      }
    } catch {
      // silently fail on filter data
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchFilters();
  }, [fetchFilters]);

  useEffect(() => {
    fetchCommunications();
  }, [fetchCommunications]);

  const toggleExpanded = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleExpanded(id);
    }
  };

  return (
    <div>
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          {t("subtitle")}
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 items-center mb-6">
        <select
          value={propertyFilter}
          onChange={(e) => setPropertyFilter(e.target.value)}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
        >
          <option value="">{t("allProperties")}</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
        >
          <option value="">{t("allTenants")}</option>
          {tenants.map((tn) => (
            <option key={tn.id} value={tn.id}>
              {tn.firstName} {tn.lastName}
            </option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
        >
          <option value="">{t("allTypes")}</option>
          {Object.entries(typeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800 mb-6 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="border-b border-[hsl(var(--border))] px-4 py-3"
            >
              <div className="animate-pulse bg-[hsl(var(--muted))] h-12 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && communications.length === 0 && (
        <div className="py-16 text-center">
          <Mail className="mx-auto h-12 w-12 text-[hsl(var(--muted-foreground))]" />
          <h2 className="mt-4 text-lg font-semibold">{t("emptyTitle")}</h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            {t("emptyDescription")}
          </p>
        </div>
      )}

      {/* Communications table */}
      {!loading && !error && communications.length > 0 && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-hidden">
          {/* Table header */}
          <div className="bg-[hsl(var(--muted))] grid grid-cols-[15%_8%_20%_30%_15%_12%] px-4 py-3">
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
              {t("typeLabel")}
            </span>
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
              {t("channelLabel")}
            </span>
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
              {t("recipientLabel")}
            </span>
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
              {t("subjectLabel")}
            </span>
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
              {t("dateLabel")}
            </span>
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
              {t("statusLabel")}
            </span>
          </div>

          {/* Table rows */}
          {communications.map((comm) => (
            <div key={comm.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleExpanded(comm.id)}
                onKeyDown={(e) => handleKeyDown(e, comm.id)}
                className="grid grid-cols-[15%_8%_20%_30%_15%_12%] px-4 py-3 border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/50 cursor-pointer transition-colors items-center"
              >
                {/* Type */}
                <span className="text-sm">
                  {typeLabels[comm.type] || comm.type}
                </span>

                {/* Channel */}
                <span>
                  {comm.channel === "email" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-semibold">
                      <Mail className="h-3 w-3" />
                      {t("channelEmail")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-xs font-semibold">
                      <MessageSquare className="h-3 w-3" />
                      {t("channelSms")}
                    </span>
                  )}
                </span>

                {/* Recipient */}
                <div>
                  <span className="text-sm">
                    {comm.recipientName || "-"}
                  </span>
                  {comm.recipientEmail && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {comm.recipientEmail}
                    </p>
                  )}
                  {comm.recipientPhone && !comm.recipientEmail && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {comm.recipientPhone}
                    </p>
                  )}
                </div>

                {/* Subject */}
                <span className="text-sm truncate pr-2">
                  {comm.subject || "-"}
                </span>

                {/* Date */}
                <span className="text-sm text-[hsl(var(--muted-foreground))]">
                  {new Date(comm.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>

                {/* Status + chevron */}
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                      statusColors[comm.status] || "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {statusLabels[comm.status] || comm.status}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-[hsl(var(--muted-foreground))] transition-transform duration-200 ${
                      expandedId === comm.id ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </div>

              {/* Expanded row */}
              {expandedId === comm.id && (
                <div className="bg-[hsl(var(--muted))]/30 px-6 py-4 border-b border-[hsl(var(--border))]">
                  {comm.subject && (
                    <div className="mb-3">
                      <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase">
                        {t("subjectLabel")}
                      </span>
                      <p className="text-sm mt-1">{comm.subject}</p>
                    </div>
                  )}
                  <div className="mb-2">
                    <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase">
                      {t("bodyLabel")}
                    </span>
                    <div className="rounded-lg bg-[hsl(var(--background))] p-4 text-sm whitespace-pre-wrap font-mono max-h-64 overflow-y-auto mt-1">
                      {comm.body || "-"}
                    </div>
                  </div>
                  {comm.status === "failed" && comm.errorMessage && (
                    <div className="mt-2 text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      <span>
                        {t("errorLabel")}: {comm.errorMessage}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

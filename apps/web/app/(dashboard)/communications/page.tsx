"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Mail,
  MessageSquare,
  ChevronDown,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

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
  const tc = useTranslations("dashboard");

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

  const statusConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
    queued: { variant: "secondary", className: "bg-yellow-100 text-yellow-700 border-transparent" },
    sent: { variant: "default", className: "bg-green-100 text-green-700 border-transparent" },
    delivered: { variant: "default", className: "bg-green-100 text-green-700 border-transparent" },
    failed: { variant: "destructive", className: "" },
    bounced: { variant: "destructive", className: "" },
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
        toast.error(t("loadError"));
      }
    } catch {
      setError(t("loadError"));
      toast.error(t("loadError"));
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
        <p className="mt-1 text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Select value={propertyFilter} onValueChange={setPropertyFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t("allProperties")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allProperties")}</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={tenantFilter} onValueChange={setTenantFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t("allTenants")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allTenants")}</SelectItem>
            {tenants.map((tn) => (
              <SelectItem key={tn.id} value={tn.id}>
                {tn.firstName} {tn.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t("allTypes")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allTypes")}</SelectItem>
            {Object.entries(typeLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <Card>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <TableHead key={i}><Skeleton className="h-4 w-20" /></TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="md:hidden space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !error && communications.length === 0 && (
        <div className="py-16 text-center">
          <Mail className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">{tc("emptyCommunicationsTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {tc("emptyCommunicationsDesc")}
          </p>
        </div>
      )}

      {/* Communications table */}
      {!loading && !error && communications.length > 0 && (
        <Card>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs uppercase">{t("typeLabel")}</TableHead>
                  <TableHead className="text-xs uppercase">{t("channelLabel")}</TableHead>
                  <TableHead className="text-xs uppercase">{t("recipientLabel")}</TableHead>
                  <TableHead className="text-xs uppercase">{t("subjectLabel")}</TableHead>
                  <TableHead className="text-xs uppercase">{t("dateLabel")}</TableHead>
                  <TableHead className="text-xs uppercase">{t("statusLabel")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {communications.map((comm) => (
                  <>
                    <TableRow
                      key={comm.id}
                      className="cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleExpanded(comm.id)}
                      onKeyDown={(e) => handleKeyDown(e, comm.id)}
                    >
                      <TableCell className="text-sm">
                        {typeLabels[comm.type] || comm.type}
                      </TableCell>
                      <TableCell>
                        {comm.channel === "email" ? (
                          <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-700 border-transparent">
                            <Mail className="h-3 w-3" />
                            {t("channelEmail")}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1 bg-purple-100 text-purple-700 border-transparent">
                            <MessageSquare className="h-3 w-3" />
                            {t("channelSms")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="text-sm">{comm.recipientName || "-"}</span>
                          {comm.recipientEmail && (
                            <p className="text-xs text-muted-foreground">{comm.recipientEmail}</p>
                          )}
                          {comm.recipientPhone && !comm.recipientEmail && (
                            <p className="text-xs text-muted-foreground">{comm.recipientPhone}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {comm.subject || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(comm.createdAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-between">
                          <Badge
                            variant={statusConfig[comm.status]?.variant || "outline"}
                            className={statusConfig[comm.status]?.className || ""}
                          >
                            {statusLabels[comm.status] || comm.status}
                          </Badge>
                          <ChevronDown
                            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                              expandedId === comm.id ? "rotate-180" : ""
                            }`}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedId === comm.id && (
                      <TableRow key={`${comm.id}-expanded`}>
                        <TableCell colSpan={6} className="bg-muted/30 px-6 py-4">
                          {comm.subject && (
                            <div className="mb-3">
                              <span className="text-xs font-semibold uppercase text-muted-foreground">
                                {t("subjectLabel")}
                              </span>
                              <p className="mt-1 text-sm">{comm.subject}</p>
                            </div>
                          )}
                          <div className="mb-2">
                            <span className="text-xs font-semibold uppercase text-muted-foreground">
                              {t("bodyLabel")}
                            </span>
                            <div className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-background p-4 font-mono text-sm">
                              {comm.body || "-"}
                            </div>
                          </div>
                          {comm.status === "failed" && comm.errorMessage && (
                            <div className="mt-2 flex items-center gap-1 text-sm text-red-600">
                              <AlertCircle className="h-4 w-4 flex-shrink-0" />
                              <span>
                                {t("errorLabel")}: {comm.errorMessage}
                              </span>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3 p-4">
            {communications.map((comm) => (
              <Card key={comm.id}>
                <CardContent className="p-4">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleExpanded(comm.id)}
                    onKeyDown={(e) => handleKeyDown(e, comm.id)}
                    className="cursor-pointer"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm">{typeLabels[comm.type] || comm.type}</p>
                        <p className="text-xs text-muted-foreground">{comm.recipientName || "-"}</p>
                        {comm.recipientEmail && (
                          <p className="text-xs text-muted-foreground">{comm.recipientEmail}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {comm.channel === "email" ? (
                          <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-700 border-transparent">
                            <Mail className="h-3 w-3" />
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1 bg-purple-100 text-purple-700 border-transparent">
                            <MessageSquare className="h-3 w-3" />
                          </Badge>
                        )}
                        <Badge
                          variant={statusConfig[comm.status]?.variant || "outline"}
                          className={statusConfig[comm.status]?.className || ""}
                        >
                          {statusLabels[comm.status] || comm.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="truncate text-sm text-muted-foreground">{comm.subject || "-"}</span>
                      <ChevronDown
                        className={`ml-2 h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200 ${
                          expandedId === comm.id ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(comm.createdAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>

                  {/* Expanded content */}
                  {expandedId === comm.id && (
                    <div className="mt-3 border-t pt-3">
                      {comm.subject && (
                        <div className="mb-3">
                          <span className="text-xs font-semibold uppercase text-muted-foreground">
                            {t("subjectLabel")}
                          </span>
                          <p className="mt-1 text-sm">{comm.subject}</p>
                        </div>
                      )}
                      <div className="mb-2">
                        <span className="text-xs font-semibold uppercase text-muted-foreground">
                          {t("bodyLabel")}
                        </span>
                        <div className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/30 p-3 font-mono text-sm">
                          {comm.body || "-"}
                        </div>
                      </div>
                      {comm.status === "failed" && comm.errorMessage && (
                        <div className="mt-2 flex items-center gap-1 text-sm text-red-600">
                          <AlertCircle className="h-4 w-4 flex-shrink-0" />
                          <span>
                            {t("errorLabel")}: {comm.errorMessage}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Info, AlertCircle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}/api/v1/import${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  return res.json();
}

interface ImportProgress {
  step: string;
  message: string;
  current: number;
  total: number;
}

interface ImportedCounts {
  properties: number;
  tenants: number;
  leases: number;
  payments: number;
  skipped: number;
}

interface DiscoveredProperty {
  name: string;
  address: string;
  type: string;
  tenants: unknown[];
  leases: unknown[];
  payments: unknown[];
}

interface ImportSession {
  id: string;
  status: string;
  progress: ImportProgress | null;
  discoveredData: DiscoveredProperty[] | null;
  selectedProperties: number[] | null;
  importedCounts: ImportedCounts | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function ImportPage() {
  const t = useTranslations("import");
  const queryClient = useQueryClient();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logMessages, setLogMessages] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Fetch latest session on mount
  const { data: latestData, isLoading: isLoadingLatest } = useQuery({
    queryKey: ["import-latest"],
    queryFn: () => apiFetch("/latest"),
  });

  // Set sessionId from latest session
  useEffect(() => {
    if (latestData?.data?.id) {
      setSessionId(latestData.data.id);
    }
  }, [latestData]);

  // Poll session status when we have a sessionId
  const { data: statusData } = useQuery({
    queryKey: ["import-status", sessionId],
    queryFn: () => apiFetch(`/status/${sessionId}`),
    enabled: !!sessionId,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status;
      if (status === "discovering" || status === "importing") return 2000;
      return false;
    },
  });

  const session: ImportSession | null = statusData?.data || null;

  // Accumulate log messages from progress updates
  useEffect(() => {
    if (session?.progress?.message) {
      setLogMessages((prev) => {
        const msg = session.progress!.message;
        if (prev[prev.length - 1] !== msg) {
          return [...prev, msg];
        }
        return prev;
      });
    }
  }, [session?.progress?.message]);

  // Auto-scroll log area
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logMessages]);

  // Initialize selected indices when discovered data arrives
  useEffect(() => {
    if (session?.status === "discovered" && session?.discoveredData) {
      setSelectedIndices(new Set(session.discoveredData.map((_, i) => i)));
    }
  }, [session?.status, session?.discoveredData]);

  // Submit credentials mutation
  const submitCredentialsMutation = useMutation({
    mutationFn: async () => {
      const result = await apiFetch("/", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      return result;
    },
    onSuccess: async (result) => {
      if (result?.data?.sessionId) {
        const newSessionId = result.data.sessionId;
        setSessionId(newSessionId);
        setLogMessages([]);
        // Start discovery immediately
        await apiFetch(`/start-discovery/${newSessionId}`, { method: "POST" });
        queryClient.invalidateQueries({ queryKey: ["import-status", newSessionId] });
      }
      setIsSubmitting(false);
    },
    onError: () => {
      setIsSubmitting(false);
    },
  });

  // Start import mutation
  const startImportMutation = useMutation({
    mutationFn: async () => {
      const selectedArray = Array.from(selectedIndices);
      return apiFetch(`/start-import/${sessionId}`, {
        method: "POST",
        body: JSON.stringify({ selectedProperties: selectedArray }),
      });
    },
    onSuccess: () => {
      setLogMessages([]);
      queryClient.invalidateQueries({ queryKey: ["import-status", sessionId] });
    },
  });

  // Delete credentials mutation
  const deleteCredentialsMutation = useMutation({
    mutationFn: async () => {
      return apiFetch(`/credentials/${sessionId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setSessionId(null);
      setEmail("");
      setPassword("");
      setLogMessages([]);
      setSelectedIndices(new Set());
      queryClient.invalidateQueries({ queryKey: ["import-latest"] });
    },
  });

  // Retry mutation (start discovery again on failed session)
  const retryMutation = useMutation({
    mutationFn: async () => {
      return apiFetch(`/start-discovery/${sessionId}`, { method: "POST" });
    },
    onSuccess: () => {
      setLogMessages([]);
      queryClient.invalidateQueries({ queryKey: ["import-status", sessionId] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setIsSubmitting(true);
    submitCredentialsMutation.mutate();
  };

  const handleStartImport = () => {
    if (selectedIndices.size === 0) return;
    startImportMutation.mutate();
  };

  const handleDeleteCredentials = () => {
    if (window.confirm(t("deleteConfirmation"))) {
      deleteCredentialsMutation.mutate();
    }
  };

  const handleStartNew = () => {
    setSessionId(null);
    setEmail("");
    setPassword("");
    setLogMessages([]);
    setSelectedIndices(new Set());
    queryClient.invalidateQueries({ queryKey: ["import-latest"] });
  };

  const handleToggleProperty = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleToggleAll = () => {
    if (!session?.discoveredData) return;
    if (selectedIndices.size === session.discoveredData.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(session.discoveredData.map((_, i) => i)));
    }
  };

  const progressPercent =
    session?.progress?.total && session.progress.total > 0
      ? Math.round((session.progress.current / session.progress.total) * 100)
      : 0;

  // Determine which state to render
  const status = session?.status;

  if (isLoadingLatest) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-semibold">
            {t("title")}{" "}
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
              {t("betaBadge")}
            </span>
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            {t("subtitle")}
          </p>
        </div>
        <div className="max-w-lg">
          <div className="rounded-lg bg-[hsl(var(--muted))] h-48 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Page title area (always shown) */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">
          {t("title")}{" "}
          <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
            {t("betaBadge")}
          </span>
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
          {t("subtitle")}
        </p>
      </div>

      {/* State 1: No session - Credential form */}
      {!session && (
        <div className="max-w-lg">
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="smovin-email"
                    className="block text-sm font-medium mb-1"
                  >
                    {t("emailLabel")}
                  </label>
                  <input
                    id="smovin-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("emailPlaceholder")}
                    className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="smovin-password"
                    className="block text-sm font-medium mb-1"
                  >
                    {t("passwordLabel")}
                  </label>
                  <input
                    id="smovin-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("passwordPlaceholder")}
                    className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  />
                </div>

                <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800 flex items-start gap-2">
                  <Info className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <span>{t("credentialNotice")}</span>
                </div>

                <button
                  type="submit"
                  disabled={!email || !password || isSubmitting}
                  aria-disabled={!email || !password || isSubmitting}
                  className={`w-full rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-4 py-2.5 text-sm font-semibold ${
                    !email || !password || isSubmitting
                      ? "opacity-50 cursor-not-allowed"
                      : ""
                  }`}
                >
                  {isSubmitting ? "..." : t("startDiscovery")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* State 2: Discovering */}
      {status === "discovering" && (
        <div className="max-w-lg" aria-live="polite">
          <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-yellow-100 text-yellow-700">
            {t("statusDiscovering")}
          </span>
          {session?.progress?.message && (
            <p className="text-sm mt-2">{session.progress.message}</p>
          )}
          <div className="w-full bg-[hsl(var(--muted))] rounded-full h-2.5 mt-4">
            <div
              className="bg-[hsl(var(--primary))] h-2.5 rounded-full transition-all duration-300"
              style={{ width: progressPercent + "%" }}
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          {session?.progress?.step && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
              {session.progress.step}
            </p>
          )}
          <div
            ref={logRef}
            className="rounded-lg bg-[hsl(var(--muted))] p-4 mt-6 max-h-48 overflow-y-auto font-mono text-xs"
          >
            {logMessages.map((msg, i) => (
              <div key={i}>{msg}</div>
            ))}
          </div>
        </div>
      )}

      {/* State 3: Discovered - Property selection */}
      {status === "discovered" && session?.discoveredData && (
        <div>
          <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700">
            {t("statusDiscovered")}
          </span>
          <p className="text-sm mt-2">
            {t("foundSummary", {
              properties: session.discoveredData.length,
              tenants: session.discoveredData.reduce(
                (sum, p) => sum + p.tenants.length,
                0
              ),
              leases: session.discoveredData.reduce(
                (sum, p) => sum + p.leases.length,
                0
              ),
            })}
          </p>

          <div className="mt-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[hsl(var(--border))]"
                checked={selectedIndices.size === session.discoveredData.length}
                onChange={handleToggleAll}
              />
              {t("selectAll")}
            </label>
          </div>

          <div className="max-w-2xl rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-hidden mt-4">
            {session.discoveredData.map((prop, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-3 border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/50"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-[hsl(var(--border))]"
                  checked={selectedIndices.has(i)}
                  onChange={() => handleToggleProperty(i)}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{prop.name}</span>
                  <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                    {prop.address}
                  </span>
                  <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                    {prop.tenants.length} tenants, {prop.leases.length} leases,{" "}
                    {prop.payments.length} payments
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 mt-4">
            <button
              onClick={handleStartImport}
              disabled={selectedIndices.size === 0}
              aria-disabled={selectedIndices.size === 0}
              className={`rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-4 py-2.5 text-sm font-semibold ${
                selectedIndices.size === 0 ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {t("importSelected")}
            </button>
            <button
              onClick={handleDeleteCredentials}
              className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-2.5 text-sm font-medium"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {/* State 4: Importing */}
      {status === "importing" && (
        <div className="max-w-lg" aria-live="polite">
          <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-yellow-100 text-yellow-700">
            {t("statusImporting")}
          </span>
          {session?.progress?.message && (
            <p className="text-sm mt-2">{session.progress.message}</p>
          )}
          <div className="w-full bg-[hsl(var(--muted))] rounded-full h-2.5 mt-4">
            <div
              className="bg-[hsl(var(--primary))] h-2.5 rounded-full transition-all duration-300"
              style={{ width: progressPercent + "%" }}
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          {session?.progress?.step && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
              {session.progress.step}
            </p>
          )}
          <div
            ref={logRef}
            className="rounded-lg bg-[hsl(var(--muted))] p-4 mt-6 max-h-48 overflow-y-auto font-mono text-xs"
          >
            {logMessages.map((msg, i) => (
              <div key={i}>{msg}</div>
            ))}
          </div>
        </div>
      )}

      {/* State 5: Completed */}
      {status === "completed" && session?.importedCounts && (
        <div>
          <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-700">
            {t("statusCompleted")}
          </span>

          <div className="grid grid-cols-2 gap-4 mt-4 max-w-lg">
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 text-center">
              <div className="text-2xl font-semibold">
                {session.importedCounts.properties}
              </div>
              <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                {t("resultsProperties")}
              </div>
            </div>
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 text-center">
              <div className="text-2xl font-semibold">
                {session.importedCounts.tenants}
              </div>
              <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                {t("resultsTenants")}
              </div>
            </div>
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 text-center">
              <div className="text-2xl font-semibold">
                {session.importedCounts.leases}
              </div>
              <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                {t("resultsLeases")}
              </div>
            </div>
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 text-center">
              <div className="text-2xl font-semibold">
                {session.importedCounts.payments}
              </div>
              <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                {t("resultsPayments")}
              </div>
            </div>
          </div>

          {session.importedCounts.skipped > 0 && (
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-4">
              {t("skippedSummary", { count: session.importedCounts.skipped })}
            </p>
          )}

          <button
            onClick={handleStartNew}
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-2.5 text-sm font-medium mt-6"
          >
            {t("startNew")}
          </button>
        </div>
      )}

      {/* State 6: Failed */}
      {status === "failed" && (
        <div className="max-w-lg">
          <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700">
            {t("statusFailed")}
          </span>

          <div
            className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800 flex items-start gap-2 mt-4"
            role="alert"
          >
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span>
              {session?.errorMessage?.includes("login")
                ? t("errorLoginFailed")
                : session?.errorMessage?.includes("cloudflare") ||
                    session?.errorMessage?.includes("Cloudflare")
                  ? t("errorCloudflare")
                  : t("errorGeneric")}
            </span>
          </div>

          <div className="flex gap-3 mt-4">
            <button
              onClick={() => retryMutation.mutate()}
              className="rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-4 py-2.5 text-sm font-semibold"
            >
              {t("retry")}
            </button>
            <button
              onClick={handleDeleteCredentials}
              className="rounded-lg border border-[hsl(var(--destructive))] text-[hsl(var(--destructive))] px-4 py-2.5 text-sm font-medium"
            >
              {t("deleteCredentials")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

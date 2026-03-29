"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Info, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

async function apiFetch(path: string, options?: RequestInit) {
  // Ensure no double slashes and no trailing slash on base
  const url = path === "/" ? `${API_URL}/api/v1/import` : `${API_URL}/api/v1/import${path}`;
  const res = await fetch(url, {
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
  const [showProgress, setShowProgress] = useState(false);
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
      setShowProgress(false);
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

  const rawSession: ImportSession | null = statusData?.data || null;
  // API may return JSON columns as strings — parse them
  const session = rawSession ? {
    ...rawSession,
    discoveredData: typeof rawSession.discoveredData === "string"
      ? JSON.parse(rawSession.discoveredData)
      : rawSession.discoveredData,
    importedCounts: typeof rawSession.importedCounts === "string"
      ? JSON.parse(rawSession.importedCounts)
      : rawSession.importedCounts,
    progress: typeof rawSession.progress === "string"
      ? JSON.parse(rawSession.progress)
      : rawSession.progress,
  } : null;

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

  // Initialize selected indices when discovered data arrives — select ALL by default
  useEffect(() => {
    if (session?.status === "discovered" && Array.isArray(session?.discoveredData) && session.discoveredData.length > 0) {
      setSelectedIndices((prev) => {
        // Only set if not already initialized (avoid overwriting user deselections)
        if (prev.size === 0) {
          return new Set(session.discoveredData!.map((_: unknown, i: number) => i));
        }
        return prev;
      });
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
      if (result?.error) {
        setLogMessages((prev) => [...prev, `Error: ${result.error}`]);
        setIsSubmitting(false);
        toast.error(result.error);
        return;
      }
      if (result?.data?.sessionId) {
        const newSessionId = result.data.sessionId;
        setSessionId(newSessionId);
        setLogMessages((prev) => [...prev, "Session created. Starting data discovery..."]);
        try {
          await apiFetch(`/start-discovery/${newSessionId}`, { method: "POST" });
          queryClient.invalidateQueries({ queryKey: ["import-status", newSessionId] });
        } catch {
          setLogMessages((prev) => [...prev, "Failed to start discovery."]);
          toast.error(t("errorGeneric"));
        }
      } else {
        setLogMessages((prev) => [...prev, "Unexpected response from server."]);
      }
      setIsSubmitting(false);
    },
    onError: (err) => {
      setIsSubmitting(false);
      setLogMessages((prev) => [...prev, `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`]);
      toast.error(t("errorGeneric"));
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
    onError: () => {
      toast.error(t("errorGeneric"));
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
      toast.success(t("credentialsDeleted"));
    },
    onError: () => {
      toast.error(t("errorGeneric"));
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
    setShowProgress(true);
    setLogMessages(["Connecting to Smovin..."]);
    submitCredentialsMutation.mutate();
  };

  const handleStartImport = () => {
    if (selectedIndices.size === 0) return;
    startImportMutation.mutate();
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
      setSelectedIndices(new Set(session.discoveredData.map((_: unknown, i: number) => i)));
    }
  };

  const progressPercent =
    session?.progress?.total && session.progress.total > 0
      ? Math.round((session.progress.current / session.progress.total) * 100)
      : 0;

  // Notify on import completion or failure
  useEffect(() => {
    if (session?.status === "completed") {
      toast.success(t("importCompleted"));
    } else if (session?.status === "failed") {
      toast.error(t("importFailed"));
    }
  }, [session?.status, t]);

  // Determine which state to render
  const status = session?.status;

  if (isLoadingLatest) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-semibold">
            {t("title")}{" "}
            <Badge variant="secondary">{t("betaBadge")}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("subtitle")}
          </p>
        </div>
        <div className="max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-12 w-full" />
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
          <Badge variant="secondary">{t("betaBadge")}</Badge>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("subtitle")}
        </p>
      </div>

      {/* Immediate progress feedback after form submit */}
      {showProgress && !session && (
        <div className="max-w-2xl mx-auto mb-6">
          <Card>
            <CardHeader>
              <Badge variant="outline" className="w-fit bg-yellow-50 text-yellow-700 border-yellow-200">
                {isSubmitting ? t("statusDiscovering") : "Waiting..."}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className="bg-primary h-2.5 rounded-full transition-all duration-300 animate-pulse"
                  style={{ width: isSubmitting ? "30%" : "5%" }}
                />
              </div>
              <div
                ref={logRef}
                className="rounded-lg bg-muted p-4 max-h-48 overflow-y-auto font-mono text-xs"
              >
                {logMessages.map((msg, i) => (
                  <div key={i}>{msg}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* State 1: No session - Credential form */}
      {!session && !showProgress && (
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>{t("credentialFormTitle")}</CardTitle>
              <CardDescription>{t("credentialFormDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit}>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="smovin-email">{t("emailLabel")}</Label>
                    <Input
                      id="smovin-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t("emailPlaceholder")}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="smovin-password">{t("passwordLabel")}</Label>
                    <Input
                      id="smovin-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("passwordPlaceholder")}
                      className="mt-1"
                    />
                  </div>

                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>{t("credentialNotice")}</AlertDescription>
                  </Alert>

                  <Button
                    type="submit"
                    disabled={!email || !password || isSubmitting}
                    className="w-full"
                  >
                    {isSubmitting ? "..." : t("startDiscovery")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* State 2: Discovering */}
      {status === "discovering" && (
        <div className="max-w-2xl mx-auto" aria-live="polite">
          <Card>
            <CardHeader>
              <Badge variant="outline" className="w-fit bg-yellow-50 text-yellow-700 border-yellow-200">
                {t("statusDiscovering")}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {session?.progress?.message && (
                <p className="text-sm">{session.progress.message}</p>
              )}
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className="bg-primary h-2.5 rounded-full transition-all duration-300"
                  style={{ width: progressPercent + "%" }}
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              {session?.progress?.step && (
                <p className="text-xs text-muted-foreground">
                  {session.progress.step}
                </p>
              )}
              <div
                ref={logRef}
                className="rounded-lg bg-muted p-4 max-h-48 overflow-y-auto font-mono text-xs"
              >
                {logMessages.map((msg, i) => (
                  <div key={i}>{msg}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* State 3: Discovered - No properties found */}
      {status === "discovered" && (!session?.discoveredData || !Array.isArray(session.discoveredData) || session.discoveredData.length === 0) && (
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <Badge variant="outline" className="w-fit bg-blue-50 text-blue-700 border-blue-200">
                {t("statusDiscovered")}
              </Badge>
              <CardDescription className="mt-2">
                {session?.progress?.message || "No properties found on Smovin account."}
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button variant="outline" onClick={handleStartNew}>
                {t("startNew")}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* State 3b: Discovered - Property selection */}
      {status === "discovered" && Array.isArray(session?.discoveredData) && session.discoveredData.length > 0 && (
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <Badge variant="outline" className="w-fit bg-blue-50 text-blue-700 border-blue-200">
                {t("statusDiscovered")}
              </Badge>
              <CardDescription className="mt-2">
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
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <button
                type="button"
                onClick={handleToggleAll}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded border-2 ${selectedIndices.size === session.discoveredData.length ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"}`}>
                  {selectedIndices.size === session.discoveredData.length && <span className="text-xs">✓</span>}
                </span>
                {t("selectAll")} ({selectedIndices.size}/{session.discoveredData.length})
              </button>

              <div className="rounded-lg border border-border overflow-hidden">
                {session.discoveredData.map((prop, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => handleToggleProperty(i)}
                    className="flex w-full items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/50 text-left cursor-pointer"
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${selectedIndices.has(i) ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"}`}>
                      {selectedIndices.has(i) && <span className="text-xs">✓</span>}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{prop.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {prop.address}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {prop.tenants.length} tenants, {prop.leases.length} leases,{" "}
                        {prop.payments.length} payments
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
            <CardFooter className="gap-3">
              <Button
                onClick={handleStartImport}
                disabled={selectedIndices.size === 0}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("importSelected")}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">{t("cancel")}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("deleteCredentialsTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("deleteConfirmation")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancelAction")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteCredentialsMutation.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {t("deleteCredentials")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* State 4: Importing */}
      {status === "importing" && (
        <div className="max-w-2xl mx-auto" aria-live="polite">
          <Card>
            <CardHeader>
              <Badge variant="outline" className="w-fit bg-yellow-50 text-yellow-700 border-yellow-200">
                {t("statusImporting")}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {session?.progress?.message && (
                <p className="text-sm">{session.progress.message}</p>
              )}
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className="bg-primary h-2.5 rounded-full transition-all duration-300"
                  style={{ width: progressPercent + "%" }}
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              {session?.progress?.step && (
                <p className="text-xs text-muted-foreground">
                  {session.progress.step}
                </p>
              )}
              <div
                ref={logRef}
                className="rounded-lg bg-muted p-4 max-h-48 overflow-y-auto font-mono text-xs"
              >
                {logMessages.map((msg, i) => (
                  <div key={i}>{msg}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* State 5: Completed */}
      {status === "completed" && session?.importedCounts && (
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <Badge variant="outline" className="w-fit bg-green-50 text-green-700 border-green-200">
                {t("statusCompleted")}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-semibold">
                      {session.importedCounts.properties}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {t("resultsProperties")}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-semibold">
                      {session.importedCounts.tenants}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {t("resultsTenants")}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-semibold">
                      {session.importedCounts.leases}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {t("resultsLeases")}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-semibold">
                      {session.importedCounts.payments}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {t("resultsPayments")}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {session.importedCounts.skipped > 0 && (
                <p className="text-sm text-muted-foreground mt-4">
                  {t("skippedSummary", { count: session.importedCounts.skipped })}
                </p>
              )}
            </CardContent>
            <CardFooter>
              <Button variant="outline" onClick={handleStartNew}>
                {t("startNew")}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* State 6: Failed */}
      {status === "failed" && (
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <Badge variant="destructive" className="w-fit">
                {t("statusFailed")}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t("statusFailed")}</AlertTitle>
                <AlertDescription>
                  {session?.errorMessage?.includes("login")
                    ? t("errorLoginFailed")
                    : session?.errorMessage?.includes("cloudflare") ||
                        session?.errorMessage?.includes("Cloudflare")
                      ? t("errorCloudflare")
                      : t("errorGeneric")}
                </AlertDescription>
              </Alert>
            </CardContent>
            <CardFooter className="gap-3">
              <Button onClick={() => retryMutation.mutate()}>
                {t("retry")}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">
                    {t("deleteCredentials")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("deleteCredentialsTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("deleteConfirmation")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancelAction")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteCredentialsMutation.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {t("deleteCredentials")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}

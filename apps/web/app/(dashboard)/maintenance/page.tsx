"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Wrench,
  Plus,
  Flame,
  ShieldCheck,
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Mail,
  RefreshCw,
  Wind,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

interface Property {
  id: string;
  name: string;
  city: string;
  heatingType?: string;
}

interface Lease {
  id: string;
  propertyId: string;
  type: string;
  status: string;
  tenantIds?: string[];
  monthlyRent: string;
}

interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface MaintenanceTask {
  id: string;
  propertyId: string;
  leaseId?: string;
  type: string;
  name: string;
  intervalMonths: number;
  lastCompleted?: string;
  nextDue: string;
  autoEmail: boolean;
  notes?: string;
  status: "ok" | "due_soon" | "overdue";
}

function TaskIcon({ type }: { type: string }) {
  switch (type) {
    case "fire_alarm":
      return <ShieldCheck className="h-5 w-5" />;
    case "heating_maintenance":
      return <Flame className="h-5 w-5" />;
    case "chimney_sweep":
      return <Wind className="h-5 w-5" />;
    default:
      return <Wrench className="h-5 w-5" />;
  }
}

export default function MaintenancePage() {
  const t = useTranslations("maintenance");
  const tc = useTranslations("dashboard");
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedType, setSelectedType] = useState("fire_alarm");
  const [updatingDate, setUpdatingDate] = useState<string | null>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

  // Form state for add task
  const [formPropertyId, setFormPropertyId] = useState("");
  const [formLeaseId, setFormLeaseId] = useState("");

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchData = useCallback(async () => {
    try {
      const [tasksRes, propsRes, leasesRes, tenantsRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/maintenance`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/properties`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/leases`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/tenants`, { credentials: "include" }),
      ]);
      if (tasksRes.ok) setTasks((await tasksRes.json()).data || []);
      if (propsRes.ok) setProperties((await propsRes.json()).data || []);
      if (leasesRes.ok) setLeases((await leasesRes.json()).data || []);
      if (tenantsRes.ok) setTenants((await tenantsRes.json()).data || []);
    } catch {
      toast.error(tc("toast.loadFailed") || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, tc]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const propMap = new Map(properties.map((p) => [p.id, p]));
  const tenantMap = new Map(tenants.map((tn) => [tn.id, tn]));

  const getPropertyName = (id: string) => propMap.get(id)?.name || id;
  const getLeaseLabel = (lease: Lease) => {
    const prop = propMap.get(lease.propertyId);
    const names = (lease.tenantIds || [])
      .map((id) => {
        const tn = tenantMap.get(id);
        return tn ? `${tn.firstName} ${tn.lastName}` : "";
      })
      .filter(Boolean)
      .join(", ");
    return `${prop?.name || lease.propertyId}${names ? ` -- ${names}` : ""}`;
  };

  const autoGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/maintenance/auto-generate`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        toast.success(tc("toast.created") || "Tasks generated");
        await fetchData();
      } else {
        toast.error(tc("toast.saveFailed") || "Failed to generate tasks");
      }
    } catch {
      toast.error(tc("toast.networkError") || "Network error");
    } finally {
      setGenerating(false);
    }
  };

  const toggleAutoEmail = async (taskId: string, current: boolean) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/maintenance/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoEmail: !current }),
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        setTasks((prev) => prev.map((t) => (t.id === taskId ? json.data : t)));
        toast.success(tc("toast.updated") || "Updated");
      } else {
        toast.error(tc("toast.saveFailed") || "Failed to update");
      }
    } catch {
      toast.error(tc("toast.networkError") || "Network error");
    }
  };

  const setLastChecked = async (taskId: string, date: string) => {
    setUpdatingDate(taskId);
    try {
      const res = await fetch(`${apiUrl}/api/v1/maintenance/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastCompleted: date }),
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        setTasks((prev) => prev.map((t) => (t.id === taskId ? json.data : t)));
        toast.success(tc("toast.updated") || "Date updated");
      } else {
        toast.error(tc("toast.saveFailed") || "Failed to update");
      }
    } catch {
      toast.error(tc("toast.networkError") || "Network error");
    } finally {
      setUpdatingDate(null);
    }
  };

  const markCompleted = async (taskId: string) => {
    setUpdatingDate(taskId);
    try {
      const res = await fetch(`${apiUrl}/api/v1/maintenance/${taskId}/complete`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        setTasks((prev) => prev.map((t) => (t.id === taskId ? json.data : t)));
        toast.success(tc("toast.updated") || "Marked as done");
      } else {
        toast.error(tc("toast.saveFailed") || "Failed to mark as done");
      }
    } catch {
      toast.error(tc("toast.networkError") || "Network error");
    } finally {
      setUpdatingDate(null);
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/maintenance/${taskId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        toast.success(tc("toast.deleted") || "Task deleted");
      } else {
        toast.error(tc("toast.deleteFailed") || "Failed to delete");
      }
    } catch {
      toast.error(tc("toast.networkError") || "Network error");
    }
    setDeleteTaskId(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const form = e.currentTarget;
    const fd = Object.fromEntries(new FormData(form));
    const payload = {
      ...fd,
      propertyId: formPropertyId,
      leaseId: formLeaseId || undefined,
      type: selectedType,
      intervalMonths: Number(fd.intervalMonths) || 12,
      autoEmail: fd.autoEmail === "on",
    };
    try {
      const res = await fetch(`${apiUrl}/api/v1/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        setTasks((prev) => [...prev, json.data]);
        setShowAddModal(false);
        toast.success(tc("toast.created") || "Task created");
      } else {
        setError("Error");
        toast.error(tc("toast.saveFailed") || "Failed to create task");
      }
    } catch {
      setError(t("saveError"));
      toast.error(tc("toast.networkError") || "Network error");
    } finally {
      setSaving(false);
    }
  };

  // Sort: overdue first, then due_soon, then ok
  const sortedTasks = [...tasks].sort((a, b) => {
    const order: Record<string, number> = { overdue: 0, due_soon: 1, ok: 2 };
    return (order[a.status] ?? 2) - (order[b.status] ?? 2);
  });

  const overdue = tasks.filter((t) => t.status === "overdue");
  const dueSoon = tasks.filter((t) => t.status === "due_soon");
  const ok = tasks.filter((t) => t.status === "ok");

  // Active leases without any maintenance tasks
  const activeLeases = leases.filter((l) => l.status === "active");
  const leasesWithoutTasks = activeLeases.filter(
    (l) => !tasks.some((t) => t.leaseId === l.id)
  );

  const TASK_TEMPLATES = [
    { type: "fire_alarm", intervalMonths: 12 },
    { type: "heating_maintenance", intervalMonths: 12 },
    { type: "chimney_sweep", intervalMonths: 12 },
    { type: "custom", intervalMonths: 12 },
  ];

  const heatingLabels: Record<string, string> = {
    gas: t("heatingGas"),
    oil: t("heatingOil"),
    electric: t("heatingElectric"),
    heat_pump: t("heatingHeatPump"),
    wood: t("heatingWood"),
    pellet: t("heatingPellet"),
    none: t("heatingNone"),
  };

  const statusBadgeConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; className: string; icon: React.ReactNode; label: string }> = {
    overdue: { variant: "destructive", className: "", icon: <AlertTriangle className="h-3 w-3" />, label: t("statusOverdue") },
    due_soon: { variant: "secondary", className: "bg-yellow-100 text-yellow-700 border-transparent", icon: <Clock className="h-3 w-3" />, label: t("statusDueSoon") },
    ok: { variant: "default", className: "bg-green-100 text-green-700 border-transparent", icon: <CheckCircle2 className="h-3 w-3" />, label: t("statusOk") },
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          {activeLeases.length > 0 && (
            <Button
              variant="outline"
              onClick={autoGenerate}
              disabled={generating}
            >
              <RefreshCw className={`mr-1 h-4 w-4 ${generating ? "animate-spin" : ""}`} />
              {t("autoGenerate")}
            </Button>
          )}
          <Button
            onClick={() => {
              setShowAddModal(true);
              setError("");
              setSelectedType("fire_alarm");
              setFormPropertyId("");
              setFormLeaseId("");
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addTask")}
          </Button>
        </div>
      </div>

      {/* Info about uncovered leases */}
      {leasesWithoutTasks.length > 0 && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm font-medium text-yellow-800">
            {t("uncoveredLeases", { count: leasesWithoutTasks.length })}
          </p>
          <p className="mt-1 text-xs text-yellow-600">{t("uncoveredLeasesHint")}</p>
        </div>
      )}

      {/* Summary cards */}
      {tasks.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-5 w-5" />
                <span className="text-2xl font-bold">{overdue.length}</span>
              </div>
              <p className="mt-1 text-sm text-red-600">{t("overdueCount")}</p>
            </CardContent>
          </Card>
          <Card className="border-yellow-200 bg-yellow-50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-yellow-700">
                <Clock className="h-5 w-5" />
                <span className="text-2xl font-bold">{dueSoon.length}</span>
              </div>
              <p className="mt-1 text-sm text-yellow-600">{t("dueSoonCount")}</p>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-2xl font-bold">{ok.length}</span>
              </div>
              <p className="mt-1 text-sm text-green-600">{t("okCount")}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Skeleton loading */}
      {loading && (
        <>
          <div className="hidden md:block">
            <Card>
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
            </Card>
          </div>
          <div className="md:hidden space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-lg" />
            ))}
          </div>
        </>
      )}

      {/* Task list */}
      {!loading && tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
          <Wrench className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">{t("emptyTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyDescription")}</p>
          {activeLeases.length > 0 && (
            <Button
              onClick={autoGenerate}
              disabled={generating}
              className="mt-4"
            >
              <RefreshCw className={`mr-1 h-4 w-4 ${generating ? "animate-spin" : ""}`} />
              {t("autoGenerate")}
            </Button>
          )}
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs uppercase">{t("taskName") || "Task"}</TableHead>
                    <TableHead className="text-xs uppercase">{t("property")}</TableHead>
                    <TableHead className="text-xs uppercase">{t("nextDue")}</TableHead>
                    <TableHead className="text-xs uppercase">{t("interval") || "Interval"}</TableHead>
                    <TableHead className="text-xs uppercase">{t("statusLabel") || "Status"}</TableHead>
                    <TableHead className="text-right text-xs uppercase">{t("actions") || "Actions"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedTasks.map((task) => {
                    const prop = propMap.get(task.propertyId);
                    const isOverdue = task.status === "overdue";
                    const config = statusBadgeConfig[task.status] || statusBadgeConfig.ok;

                    return (
                      <TableRow key={task.id} className={isOverdue ? "bg-red-50/50" : ""}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                              isOverdue
                                ? "bg-red-100 text-red-600"
                                : task.status === "due_soon"
                                  ? "bg-yellow-100 text-yellow-600"
                                  : "bg-green-100 text-green-600"
                            }`}>
                              <TaskIcon type={task.type} />
                            </div>
                            <span className={`font-medium ${isOverdue ? "text-red-800" : ""}`}>
                              {task.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {getPropertyName(task.propertyId)}
                          {prop?.heatingType && (
                            <span className="text-xs text-muted-foreground"> . {heatingLabels[prop.heatingType] || prop.heatingType}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className={isOverdue ? "font-semibold text-red-600" : ""}>{task.nextDue}</span>
                          {task.lastCompleted && (
                            <p className="text-xs text-muted-foreground">{t("lastDone")}: {task.lastCompleted}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{task.intervalMonths} {t("months")}</TableCell>
                        <TableCell>
                          <Badge variant={config.variant} className={`gap-1 ${config.className}`}>
                            {config.icon}
                            {config.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleAutoEmail(task.id, task.autoEmail)}
                              className={task.autoEmail ? "text-blue-700" : "text-muted-foreground"}
                              title={task.autoEmail ? t("autoEmailOn") : t("autoEmailOff")}
                            >
                              <Mail className="h-3.5 w-3.5" />
                            </Button>
                            {isOverdue ? (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => markCompleted(task.id)}
                                disabled={updatingDate === task.id}
                              >
                                {updatingDate === task.id ? "..." : t("markDoneToday")}
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => markCompleted(task.id)}
                                disabled={updatingDate === task.id}
                              >
                                {updatingDate === task.id ? "..." : t("markDone")}
                              </Button>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-red-600">
                                  {t("delete")}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{tc("delete")}</AlertDialogTitle>
                                  <AlertDialogDescription>{tc("deleteConfirm")}</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{tc("keepItem")}</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteTask(task.id)}>
                                    {tc("delete")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {sortedTasks.map((task) => {
              const lease = leases.find((l) => l.id === task.leaseId);
              const prop = propMap.get(task.propertyId);
              const isOverdue = task.status === "overdue";
              const config = statusBadgeConfig[task.status] || statusBadgeConfig.ok;

              return (
                <Card
                  key={task.id}
                  className={
                    isOverdue
                      ? "border-red-300 bg-red-50/50"
                      : task.status === "due_soon"
                        ? "border-yellow-200"
                        : ""
                  }
                >
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                          isOverdue
                            ? "bg-red-100 text-red-600"
                            : task.status === "due_soon"
                              ? "bg-yellow-100 text-yellow-600"
                              : "bg-green-100 text-green-600"
                        }`}
                      >
                        <TaskIcon type={task.type} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className={`font-semibold truncate ${isOverdue ? "text-red-800" : ""}`}>
                            {task.name}
                          </h3>
                          <Badge variant={config.variant} className={`gap-1 ${config.className}`}>
                            {config.icon}
                            {config.label}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {getPropertyName(task.propertyId)}
                          {prop?.heatingType && ` . ${heatingLabels[prop.heatingType] || prop.heatingType}`}
                          {lease && ` . ${(lease.tenantIds || []).map((id) => {
                            const tn = tenantMap.get(id);
                            return tn ? `${tn.firstName} ${tn.lastName}` : "";
                          }).filter(Boolean).join(", ")}`}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {t("nextDue")}: <span className={isOverdue ? "font-semibold text-red-600" : ""}>{task.nextDue}</span>
                          </span>
                          <span>{t("every")} {task.intervalMonths} {t("months")}</span>
                          {task.lastCompleted && (
                            <span>{t("lastDone")}: {task.lastCompleted}</span>
                          )}
                        </div>

                        {/* Overdue: show date picker */}
                        {isOverdue && (
                          <div className="mt-3 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
                            <Label className="text-xs font-medium text-red-700 whitespace-nowrap">
                              {t("lastCheckedDate")}:
                            </Label>
                            <Input
                              type="date"
                              className="h-8 border-red-200 bg-white"
                              onChange={(e) => {
                                if (e.target.value) setLastChecked(task.id, e.target.value);
                              }}
                              disabled={updatingDate === task.id}
                            />
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => markCompleted(task.id)}
                              disabled={updatingDate === task.id}
                            >
                              {updatingDate === task.id ? "..." : t("markDoneToday")}
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Right side: actions */}
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleAutoEmail(task.id, task.autoEmail)}
                          className={task.autoEmail ? "text-blue-700" : "text-muted-foreground"}
                        >
                          <Mail className="h-3.5 w-3.5 mr-1" />
                          <span className="text-xs">{task.autoEmail ? t("autoEmailOn") : t("autoEmailOff")}</span>
                        </Button>

                        {!isOverdue && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => markCompleted(task.id)}
                            disabled={updatingDate === task.id}
                          >
                            {updatingDate === task.id ? "..." : t("markDone")}
                          </Button>
                        )}

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-red-600">
                              {t("delete")}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{tc("delete")}</AlertDialogTitle>
                              <AlertDialogDescription>{tc("deleteConfirm")}</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{tc("keepItem")}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteTask(task.id)}>
                                {tc("delete")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Add task dialog */}
      <Dialog open={showAddModal} onOpenChange={(open) => !open && setShowAddModal(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("addTaskTitle")}</DialogTitle>
          </DialogHeader>

          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {/* Task type selection */}
          <div className="mb-4">
            <Label className="mb-2 block">{t("taskType")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {TASK_TEMPLATES.map((tmpl) => (
                <Button
                  key={tmpl.type}
                  type="button"
                  variant={selectedType === tmpl.type ? "default" : "outline"}
                  onClick={() => setSelectedType(tmpl.type)}
                  className="justify-start gap-2"
                >
                  <TaskIcon type={tmpl.type} />
                  <span>{t(`type_${tmpl.type}`)}</span>
                </Button>
              ))}
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <Label>{t("property")}</Label>
              <Select value={formPropertyId} onValueChange={setFormPropertyId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={t("selectProperty")} />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.city}){p.heatingType ? ` -- ${heatingLabels[p.heatingType] || p.heatingType}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("lease")}</Label>
              <Select value={formLeaseId} onValueChange={setFormLeaseId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={t("selectLease")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("selectLease")}</SelectItem>
                  {activeLeases.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {getLeaseLabel(l)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("taskName")}</Label>
              <Input
                name="name"
                type="text"
                required
                defaultValue={selectedType === "custom" ? "" : t(`type_${selectedType}`)}
                key={selectedType}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("interval")}</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    name="intervalMonths"
                    type="number"
                    min="1"
                    max="120"
                    defaultValue={selectedType === "heat_pump" ? 24 : 12}
                    key={selectedType}
                    required
                  />
                  <span className="whitespace-nowrap text-sm text-muted-foreground">
                    {t("months")}
                  </span>
                </div>
              </div>
              <div>
                <Label>{t("lastCompleted")}</Label>
                <Input
                  name="lastCompleted"
                  type="date"
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" name="autoEmail" id="autoEmail" defaultChecked />
              <label htmlFor="autoEmail" className="text-sm">
                <Mail className="mr-1 inline h-3.5 w-3.5" />
                {t("autoEmailLabel")}
              </label>
            </div>
            <div>
              <Label>{t("notes")}</Label>
              <textarea
                name="notes"
                rows={2}
                placeholder={t("notesPlaceholder")}
                className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddModal(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "..." : t("saveTask")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

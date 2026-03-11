"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Wrench,
  Plus,
  X,
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
      // API unavailable
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const propMap = new Map(properties.map((p) => [p.id, p]));
  const tenantMap = new Map(tenants.map((t) => [t.id, t]));

  const getPropertyName = (id: string) => propMap.get(id)?.name || id;
  const getLeaseLabel = (lease: Lease) => {
    const prop = propMap.get(lease.propertyId);
    const names = (lease.tenantIds || [])
      .map((id) => {
        const t = tenantMap.get(id);
        return t ? `${t.firstName} ${t.lastName}` : "";
      })
      .filter(Boolean)
      .join(", ");
    return `${prop?.name || lease.propertyId}${names ? ` — ${names}` : ""}`;
  };

  const autoGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/maintenance/auto-generate`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        await fetchData();
      }
    } catch {
      // ignore
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
      }
    } catch {
      // ignore
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
      }
    } catch {
      // ignore
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
      }
    } catch {
      // ignore
    } finally {
      setUpdatingDate(null);
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      await fetch(`${apiUrl}/api/v1/maintenance/${taskId}`, {
        method: "DELETE",
        credentials: "include",
      });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch {
      // ignore
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const form = e.currentTarget;
    const fd = Object.fromEntries(new FormData(form));
    const payload = {
      ...fd,
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
      } else {
        setError("Error");
      }
    } catch {
      setError(t("saveError"));
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-[hsl(var(--muted-foreground))]">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          {activeLeases.length > 0 && (
            <button
              onClick={autoGenerate}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} />
              {t("autoGenerate")}
            </button>
          )}
          <button
            onClick={() => {
              setShowAddModal(true);
              setError("");
              setSelectedType("fire_alarm");
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            {t("addTask")}
          </button>
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
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-2xl font-bold">{overdue.length}</span>
            </div>
            <p className="mt-1 text-sm text-red-600">{t("overdueCount")}</p>
          </div>
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
            <div className="flex items-center gap-2 text-yellow-700">
              <Clock className="h-5 w-5" />
              <span className="text-2xl font-bold">{dueSoon.length}</span>
            </div>
            <p className="mt-1 text-sm text-yellow-600">{t("dueSoonCount")}</p>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-2xl font-bold">{ok.length}</span>
            </div>
            <p className="mt-1 text-sm text-green-600">{t("okCount")}</p>
          </div>
        </div>
      )}

      {/* Task list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-16">
          <Wrench className="h-12 w-12 text-[hsl(var(--muted-foreground))]" />
          <h3 className="mt-4 text-lg font-medium">{t("emptyTitle")}</h3>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t("emptyDescription")}</p>
          {activeLeases.length > 0 && (
            <button
              onClick={autoGenerate}
              disabled={generating}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} />
              {t("autoGenerate")}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {sortedTasks.map((task) => {
            const lease = leases.find((l) => l.id === task.leaseId);
            const prop = propMap.get(task.propertyId);
            const isOverdue = task.status === "overdue";

            return (
              <div
                key={task.id}
                className={`rounded-xl border bg-[hsl(var(--background))] p-5 shadow-sm ${
                  isOverdue
                    ? "border-red-300 bg-red-50/50"
                    : task.status === "due_soon"
                      ? "border-yellow-200"
                      : "border-[hsl(var(--border))]"
                }`}
              >
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
                      {isOverdue ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                          <AlertTriangle className="h-3 w-3" /> {t("statusOverdue")}
                        </span>
                      ) : task.status === "due_soon" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                          <Clock className="h-3 w-3" /> {t("statusDueSoon")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          <CheckCircle2 className="h-3 w-3" /> {t("statusOk")}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-[hsl(var(--muted-foreground))]">
                      {getPropertyName(task.propertyId)}
                      {prop?.heatingType && ` · ${heatingLabels[prop.heatingType] || prop.heatingType}`}
                      {lease && ` · ${(lease.tenantIds || []).map((id) => {
                        const tn = tenantMap.get(id);
                        return tn ? `${tn.firstName} ${tn.lastName}` : "";
                      }).filter(Boolean).join(", ")}`}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-4 text-xs text-[hsl(var(--muted-foreground))]">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {t("nextDue")}: <span className={isOverdue ? "font-semibold text-red-600" : ""}>{task.nextDue}</span>
                      </span>
                      <span>{t("every")} {task.intervalMonths} {t("months")}</span>
                      {task.lastCompleted && (
                        <span>{t("lastDone")}: {task.lastCompleted}</span>
                      )}
                    </div>

                    {/* Overdue: show date picker for last checked */}
                    {isOverdue && (
                      <div className="mt-3 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
                        <label className="text-xs font-medium text-red-700 whitespace-nowrap">
                          {t("lastCheckedDate")}:
                        </label>
                        <input
                          type="date"
                          className="rounded-md border border-red-200 bg-white px-2 py-1 text-sm"
                          onChange={(e) => {
                            if (e.target.value) setLastChecked(task.id, e.target.value);
                          }}
                          disabled={updatingDate === task.id}
                        />
                        <button
                          onClick={() => markCompleted(task.id)}
                          disabled={updatingDate === task.id}
                          className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {updatingDate === task.id ? "..." : t("markDoneToday")}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Right side: auto email toggle + actions */}
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {/* Auto email toggle */}
                    <button
                      onClick={() => toggleAutoEmail(task.id, task.autoEmail)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        task.autoEmail
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                      title={task.autoEmail ? t("autoEmailOn") : t("autoEmailOff")}
                    >
                      <Mail className="h-3 w-3" />
                      {task.autoEmail ? t("autoEmailOn") : t("autoEmailOff")}
                    </button>

                    {!isOverdue && (
                      <button
                        onClick={() => markCompleted(task.id)}
                        disabled={updatingDate === task.id}
                        className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                      >
                        {updatingDate === task.id ? "..." : t("markDone")}
                      </button>
                    )}

                    <button
                      onClick={() => deleteTask(task.id)}
                      className="text-xs text-[hsl(var(--muted-foreground))] hover:text-red-600"
                    >
                      {t("delete")}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add task modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-[hsl(var(--background))] p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("addTaskTitle")}</h2>
              <button onClick={() => setShowAddModal(false)}>
                <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            {/* Task type selection */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium">{t("taskType")}</label>
              <div className="grid grid-cols-2 gap-2">
                {TASK_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.type}
                    type="button"
                    onClick={() => setSelectedType(tmpl.type)}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-all ${
                      selectedType === tmpl.type
                        ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 ring-1 ring-[hsl(var(--primary))]"
                        : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                    }`}
                  >
                    <TaskIcon type={tmpl.type} />
                    <span className="font-medium">{t(`type_${tmpl.type}`)}</span>
                  </button>
                ))}
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("property")}</label>
                <select
                  name="propertyId"
                  required
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                >
                  <option value="">{t("selectProperty")}</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.city}){p.heatingType ? ` — ${heatingLabels[p.heatingType] || p.heatingType}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("lease")}</label>
                <select
                  name="leaseId"
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                >
                  <option value="">{t("selectLease")}</option>
                  {activeLeases.map((l) => (
                    <option key={l.id} value={l.id}>
                      {getLeaseLabel(l)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("taskName")}</label>
                <input
                  name="name"
                  type="text"
                  required
                  defaultValue={
                    selectedType === "custom"
                      ? ""
                      : t(`type_${selectedType}`)
                  }
                  key={selectedType}
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("interval")}</label>
                  <div className="flex items-center gap-2">
                    <input
                      name="intervalMonths"
                      type="number"
                      min="1"
                      max="120"
                      defaultValue={selectedType === "heat_pump" ? 24 : 12}
                      key={selectedType}
                      required
                      className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                    />
                    <span className="text-sm text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                      {t("months")}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("lastCompleted")}</label>
                  <input
                    name="lastCompleted"
                    type="date"
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
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
                <label className="mb-1 block text-sm font-medium">{t("notes")}</label>
                <textarea
                  name="notes"
                  rows={2}
                  placeholder={t("notesPlaceholder")}
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--muted))]"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "..." : t("saveTask")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

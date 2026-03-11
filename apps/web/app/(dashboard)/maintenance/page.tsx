"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Wrench,
  Plus,
  X,
  Bell,
  Flame,
  ShieldCheck,
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react";

interface Property {
  id: string;
  name: string;
  city: string;
}

interface MaintenanceTask {
  id: string;
  propertyId: string;
  type: string;
  name: string;
  intervalMonths: number;
  lastCompleted?: string;
  nextDue: string;
  notes?: string;
  status: "ok" | "due_soon" | "overdue";
}

const TASK_TEMPLATES = [
  { type: "fire_alarm", icon: "bell", intervalMonths: 12 },
  { type: "heating_maintenance", icon: "flame", intervalMonths: 12 },
  { type: "chimney_sweep", icon: "flame", intervalMonths: 12 },
  { type: "custom", icon: "wrench", intervalMonths: 12 },
];

function getTaskStatus(nextDue: string): "ok" | "due_soon" | "overdue" {
  const now = new Date();
  const due = new Date(nextDue);
  const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return "overdue";
  if (diffDays < 30) return "due_soon";
  return "ok";
}

function TaskIcon({ type }: { type: string }) {
  switch (type) {
    case "fire_alarm":
      return <ShieldCheck className="h-5 w-5" />;
    case "heating_maintenance":
    case "chimney_sweep":
      return <Flame className="h-5 w-5" />;
    default:
      return <Wrench className="h-5 w-5" />;
  }
}

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  switch (status) {
    case "overdue":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
          <AlertTriangle className="h-3 w-3" /> {t("statusOverdue")}
        </span>
      );
    case "due_soon":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
          <Clock className="h-3 w-3" /> {t("statusDueSoon")}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
          <CheckCircle2 className="h-3 w-3" /> {t("statusOk")}
        </span>
      );
  }
}

export default function MaintenancePage() {
  const t = useTranslations("maintenance");
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState("fire_alarm");
  const [markingDone, setMarkingDone] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const fetchData = useCallback(async () => {
    try {
      const [tasksRes, propsRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/maintenance`, { credentials: "include" }),
        fetch(`${apiUrl}/api/v1/properties`, { credentials: "include" }),
      ]);
      if (tasksRes.ok) {
        const json = await tasksRes.json();
        setTasks(json.data || []);
      }
      if (propsRes.ok) {
        const json = await propsRes.json();
        setProperties(json.data || []);
      }
    } catch {
      // API unavailable
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
        form.reset();
      } else {
        setError("Error");
      }
    } catch {
      setError(t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  const markCompleted = async (taskId: string) => {
    setMarkingDone(taskId);
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
      setMarkingDone(null);
    }
  };

  const getPropertyName = (id: string) => {
    const p = properties.find((p) => p.id === id);
    return p ? p.name : id;
  };

  const overdueTasks = tasks.filter((t) => t.status === "overdue");
  const dueSoonTasks = tasks.filter((t) => t.status === "due_soon");
  const okTasks = tasks.filter((t) => t.status === "ok");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-[hsl(var(--muted-foreground))]">{t("subtitle")}</p>
        </div>
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

      {/* Summary cards */}
      {tasks.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-2xl font-bold">{overdueTasks.length}</span>
            </div>
            <p className="mt-1 text-sm text-red-600">{t("overdueCount")}</p>
          </div>
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
            <div className="flex items-center gap-2 text-yellow-700">
              <Clock className="h-5 w-5" />
              <span className="text-2xl font-bold">{dueSoonTasks.length}</span>
            </div>
            <p className="mt-1 text-sm text-yellow-600">{t("dueSoonCount")}</p>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-2xl font-bold">{okTasks.length}</span>
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
        </div>
      ) : (
        <div className="space-y-3">
          {[...overdueTasks, ...dueSoonTasks, ...okTasks].map((task) => (
            <div
              key={task.id}
              className={`flex items-center gap-4 rounded-xl border bg-[hsl(var(--background))] p-5 shadow-sm ${
                task.status === "overdue"
                  ? "border-red-200"
                  : task.status === "due_soon"
                    ? "border-yellow-200"
                    : "border-[hsl(var(--border))]"
              }`}
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  task.status === "overdue"
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
                  <h3 className="font-semibold truncate">{task.name}</h3>
                  <StatusBadge status={task.status} t={t} />
                </div>
                <p className="mt-0.5 text-sm text-[hsl(var(--muted-foreground))]">
                  {getPropertyName(task.propertyId)} &middot; {t("every")} {task.intervalMonths} {t("months")}
                </p>
                <div className="mt-1 flex items-center gap-4 text-xs text-[hsl(var(--muted-foreground))]">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {t("nextDue")}: {task.nextDue}
                  </span>
                  {task.lastCompleted && (
                    <span>
                      {t("lastDone")}: {task.lastCompleted}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => markCompleted(task.id)}
                disabled={markingDone === task.id}
                className="shrink-0 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
              >
                {markingDone === task.id ? "..." : t("markDone")}
              </button>
            </div>
          ))}
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
                      {p.name} ({p.city})
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
                    selectedType === "fire_alarm"
                      ? t("type_fire_alarm")
                      : selectedType === "heating_maintenance"
                        ? t("type_heating_maintenance")
                        : selectedType === "chimney_sweep"
                          ? t("type_chimney_sweep")
                          : ""
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
                      defaultValue={
                        selectedType === "chimney_sweep" ? 12 : 12
                      }
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

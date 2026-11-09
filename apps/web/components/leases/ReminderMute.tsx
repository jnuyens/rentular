"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import LocaleDateInput from "@/components/LocaleDateInput";
import { addDaysYmd, formatDate, formatDateTime, todayInZone } from "@/lib/dateLocale";

/** A contract's reminder mute, as the API returns it (only while active). */
export interface ReminderMuteInfo {
  until: string;
  note: string | null;
  by: string | null;
  byName: string | null;
  at: string | null;
  active: boolean;
}

/** The longest a mute may run, as the API enforces. */
const MAX_DAYS = 120;

/** "04/12": the end date without the year, in the viewer's date order. */
export function shortDate(iso: string): string {
  return formatDate(iso).slice(0, 5);
}

/** "Set by Jasper on 09/11/2026 10:00", or without a name. */
export function muteByLine(t: ReturnType<typeof useTranslations>, mute: ReminderMuteInfo): string {
  if (!mute.at) return "";
  const date = formatDateTime(mute.at);
  return mute.byName ? t("recordedBy", { name: mute.byName, date }) : t("recordedOn", { date });
}

/** Calm badge on an overdue item of a muted contract. Hover shows the note and who set it. */
export function MuteBadge({ mute }: { mute: ReminderMuteInfo }) {
  const t = useTranslations("reminderMute");
  const title = [mute.note, muteByLine(t, mute)].filter(Boolean).join("\n");
  return (
    <span
      title={title || undefined}
      className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
    >
      <BellOff className="h-3 w-3" />
      {t("badge", { date: shortDate(mute.until) })}
    </span>
  );
}

/**
 * Mute, change or unmute a contract's late-payment reminders. Quick choices:
 * the next rent, next week, or a date picked by hand. Optional note.
 */
export function ReminderMuteDialog({
  open,
  onOpenChange,
  leaseId,
  label,
  nextDueDate,
  mute,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaseId: string;
  /** Who and what, e.g. "Carnotstraat 65 b102, Jan Peeters". */
  label?: string;
  nextDueDate?: string | null;
  mute?: ReminderMuteInfo | null;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("reminderMute");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const today = todayInZone();
  const maxDate = addDaysYmd(today, MAX_DAYS);
  const nextRent = nextDueDate && nextDueDate > today && nextDueDate <= maxDate ? nextDueDate : null;
  const nextWeek = addDaysYmd(today, 7);

  const [until, setUntil] = useState("");
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const initial = mute?.until ?? nextRent ?? nextWeek;
    setUntil(initial);
    setPicking(initial !== nextRent && initial !== nextWeek);
    setNote(mute?.note ?? "");
    setError(null);
  }, [open, mute, nextRent, nextWeek]);

  const errorText = (code: string | undefined) =>
    code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.failed");

  const save = async () => {
    if (!until) {
      setError(t("errors.invalid_date"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/leases/${leaseId}/reminder-mute`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ until, note: note.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(errorText(body.code));
        return;
      }
      toast.success(t("saved", { date: formatDate(until) }));
      onOpenChange(false);
      await onChanged();
    } catch {
      setError(t("errors.failed"));
    } finally {
      setBusy(false);
    }
  };

  const unmute = async () => {
    if (!window.confirm(t("unmuteConfirm"))) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/leases/${leaseId}/reminder-mute`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        setError(t("errors.failed"));
        return;
      }
      toast.success(t("unmuted"));
      onOpenChange(false);
      await onChanged();
    } catch {
      setError(t("errors.failed"));
    } finally {
      setBusy(false);
    }
  };

  const chip = (text: string, selected: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-sm ${
        selected ? "border-navy bg-navy text-white" : "border-input bg-white text-navy hover:bg-muted"
      }`}
    >
      {text}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          {label && <DialogDescription>{label}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {nextRent &&
              chip(`${t("nextRent")} (${formatDate(nextRent)})`, !picking && until === nextRent, () => {
                setPicking(false);
                setUntil(nextRent);
              })}
            {chip(`${t("nextWeek")} (${formatDate(nextWeek)})`, !picking && until === nextWeek, () => {
              setPicking(false);
              setUntil(nextWeek);
            })}
            {chip(t("pickDate"), picking, () => setPicking(true))}
          </div>
          {picking && (
            <div className="space-y-1">
              <Label htmlFor="mute-until">{t("date")}</Label>
              <LocaleDateInput id="mute-until" value={until} onChange={setUntil} />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="mute-note">{t("note")}</Label>
            <Textarea
              id="mute-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              rows={3}
            />
          </div>
          <div className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-900/30 dark:text-sky-100">
            <p>{t("hint")}</p>
            <p className="mt-1 text-xs">{t("afterHint")}</p>
          </div>
          {mute && muteByLine(t, mute) && <p className="text-xs text-muted-foreground">{muteByLine(t, mute)}</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {mute ? (
            <Button type="button" variant="outline" onClick={unmute} disabled={busy}>
              {t("unmute")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={save} disabled={busy || !until}>
              {t("save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The small button on an overdue item that opens the dialog. */
export function MuteButton({ onClick, muted }: { onClick: () => void; muted: boolean }) {
  const t = useTranslations("reminderMute");
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-lg border border-input bg-white px-2 py-1 text-xs font-medium text-navy hover:bg-muted"
    >
      <BellOff className="h-3.5 w-3.5" />
      {muted ? t("change") : t("button")}
    </button>
  );
}

/**
 * Status block on the contract page: "Reminders muted until 04/12" with the
 * note, who set it and when, and the change and unmute actions.
 */
export function ReminderMuteCard({
  leaseId,
  mute,
  nextDueDate,
  canEdit,
  onChanged,
}: {
  leaseId: string;
  mute: ReminderMuteInfo | null;
  nextDueDate: string | null;
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("reminderMute");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const unmute = async () => {
    if (!window.confirm(t("unmuteConfirm"))) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/leases/${leaseId}/reminder-mute`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t("unmuted"));
      await onChanged();
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className={mute ? "border-sky-300 bg-sky-50/60 dark:bg-sky-900/20" : ""}>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <BellOff className={`mt-0.5 h-5 w-5 ${mute ? "text-sky-700" : "text-muted-foreground"}`} />
          <div>
            {mute ? (
              <>
                <p className="font-semibold text-sky-900 dark:text-sky-100">
                  {t("status", { date: shortDate(mute.until) })}
                </p>
                {mute.note && <p className="text-sm">{mute.note}</p>}
                {muteByLine(t, mute) && <p className="text-xs text-muted-foreground">{muteByLine(t, mute)}</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("notMuted")}</p>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} disabled={busy}>
              {mute ? t("change") : t("button")}
            </Button>
            {mute && (
              <Button type="button" variant="outline" size="sm" onClick={unmute} disabled={busy}>
                {t("unmute")}
              </Button>
            )}
          </div>
        )}
      </CardContent>
      <ReminderMuteDialog
        open={open}
        onOpenChange={setOpen}
        leaseId={leaseId}
        nextDueDate={nextDueDate}
        mute={mute}
        onChanged={onChanged}
      />
    </Card>
  );
}

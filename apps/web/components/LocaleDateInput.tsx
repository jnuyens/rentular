"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar } from "lucide-react";
import {
  localeDateOrder,
  isoToDisplay,
  displayToIso,
  datePlaceholder,
  type DateOrder,
} from "@/lib/dateLocale";

interface LocaleDateInputProps {
  /** Controlled ISO value (yyyy-mm-dd). Omit for uncontrolled use. */
  value?: string;
  /** Initial ISO value for uncontrolled use (FormData forms). */
  defaultValue?: string;
  onChange?: (iso: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** When set, a hidden native date input carries this name for FormData. */
  name?: string;
}

/**
 * Date field whose displayed order (dd/mm/yyyy vs mm/dd/yyyy) follows the
 * user's physical location via their IANA time zone, not the browser/keyboard
 * language. A text box shows/parses the localized order and stores ISO; the
 * calendar button opens the native picker (whose own display format is
 * irrelevant since it only feeds back an ISO value).
 *
 * Works controlled (`value`/`onChange`) or uncontrolled (`defaultValue` +
 * `name`), the latter so it drops into existing FormData-based forms.
 */
export default function LocaleDateInput({
  value,
  defaultValue,
  onChange,
  required,
  disabled,
  className = "",
  id,
  name,
}: LocaleDateInputProps) {
  const controlled = value !== undefined;
  const [order, setOrder] = useState<DateOrder>("dmy");
  const [internalIso, setInternalIso] = useState(defaultValue || "");
  const [text, setText] = useState("");
  const nativeRef = useRef<HTMLInputElement>(null);

  const iso = controlled ? (value as string) : internalIso;

  // Time zone is only available client-side, so resolve after mount.
  useEffect(() => {
    setOrder(localeDateOrder());
  }, []);

  // Keep the text box in sync with the current ISO value and detected order.
  useEffect(() => {
    setText(isoToDisplay(iso, order));
  }, [iso, order]);

  const commit = (next: string) => {
    if (!controlled) setInternalIso(next);
    onChange?.(next);
  };

  const openPicker = () => {
    const el = nativeRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") el.showPicker();
    else el.focus();
  };

  return (
    <div className={`relative flex items-center ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        placeholder={datePlaceholder(order)}
        required={required}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === "") {
            commit("");
            return;
          }
          const parsed = displayToIso(raw, order);
          if (parsed) commit(parsed);
        }}
        onBlur={() => setText(isoToDisplay(iso, order))}
        className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
      />
      <input
        ref={nativeRef}
        id={id}
        name={name}
        type="date"
        value={iso || ""}
        onChange={(e) => commit(e.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        aria-label="Open calendar"
        className="absolute right-2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        <Calendar className="h-4 w-4" />
      </button>
    </div>
  );
}

"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { Globe } from "lucide-react";

const LANGUAGES = [
  { code: "nl", label: "Nederlands", flag: "NL" },
  { code: "fr", label: "Francais", flag: "FR" },
  { code: "en", label: "English", flag: "EN" },
  { code: "de", label: "Deutsch", flag: "DE" },
] as const;

const COOKIE_NAME = "NEXT_LOCALE";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year

export default function LanguageSwitcher({ compact = false, dropDirection = "auto" }: { compact?: boolean; dropDirection?: "up" | "down" | "auto" }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentLang = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[2];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const switchLocale = async (newLocale: string) => {
    // Set cookie so it persists (works before and after login)
    document.cookie = `${COOKIE_NAME}=${newLocale};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;

    // If logged in, also save to user profile via API
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      await fetch(`${apiUrl}/api/v1/settings/locale`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: newLocale }),
        credentials: "include",
      }).catch(() => {
        // Silently fail if not logged in or API unavailable
      });
    } catch {
      // Not logged in, cookie is enough
    }

    setOpen(false);
    router.refresh();
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 rounded-lg transition-colors hover:bg-[hsl(var(--muted))] ${
          compact
            ? "p-1.5 text-[hsl(var(--muted-foreground))]"
            : "border border-[hsl(var(--border))] px-3 py-1.5 text-sm"
        }`}
        title="Change language"
      >
        <Globe className="h-4 w-4" />
        {!compact && <span>{currentLang.flag}</span>}
      </button>

      {open && (
        <div className={`absolute left-0 w-44 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] py-1 shadow-lg z-50 ${
          dropDirection === "up" ? "bottom-full mb-1" :
          dropDirection === "down" ? "top-full mt-1" :
          "top-full mt-1"
        }`}>
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => switchLocale(lang.code)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-[hsl(var(--muted))] ${
                lang.code === locale
                  ? "font-medium text-[hsl(var(--primary))]"
                  : "text-[hsl(var(--foreground))]"
              }`}
            >
              <span className="w-6 text-center text-xs font-bold">{lang.flag}</span>
              {lang.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

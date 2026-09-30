"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface Institution {
  id: string;
  name: string;
  bic: string;
  country: string;
  logoUrl?: string;
}

interface Props {
  country?: string;
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

export function InstitutionPicker({
  country = "BE",
  value,
  onChange,
  disabled,
}: Props) {
  const t = useTranslations("bankConnections");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const [reloadKey, setReloadKey] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(
      `${apiUrl}/api/v1/bank-connections/institutions?country=${encodeURIComponent(country)}`,
      { credentials: "include" },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`Status ${res.status}`);
        return res.json();
      })
      .then((json: { data?: Institution[] }) => {
        if (cancelled) return;
        setInstitutions(json.data || []);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, country, reloadKey]);

  const filtered = useMemo<Institution[]>(() => {
    if (!search.trim()) return institutions;
    const q = search.toLowerCase();
    return institutions.filter(
      (inst) =>
        inst.name.toLowerCase().includes(q) ||
        (inst.bic ? inst.bic.toLowerCase().includes(q) : false),
    );
  }, [institutions, search]);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">
          {t("loadError", { defaultMessage: "Unable to load banks." })}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          {t("retry", { defaultMessage: "Retry" })}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("searchBanks", { defaultMessage: "Search banks" })}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          disabled={disabled}
        />
      </div>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue
            placeholder={t("selectInstitution", {
              defaultMessage: "Select your bank",
            })}
          />
        </SelectTrigger>
        <SelectContent>
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {t("noInstitutionsFound", {
                defaultMessage: "No banks found",
              })}
            </div>
          )}
          {filtered.map((inst) => (
            <SelectItem key={inst.id} value={inst.id}>
              <div className="flex items-center gap-2">
                {inst.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={inst.logoUrl}
                    alt=""
                    width={16}
                    height={16}
                    className="h-4 w-4 rounded-sm object-contain"
                  />
                )}
                <span className="font-medium">{inst.name}</span>
                {inst.bic && (
                  <span className="text-xs text-muted-foreground">
                    {inst.bic}
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

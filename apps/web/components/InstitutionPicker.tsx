"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Institution {
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");

  const fetchInstitutions = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/bank-connections/institutions?country=${encodeURIComponent(country)}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        setInstitutions(data.data || []);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, country]);

  useEffect(() => {
    fetchInstitutions();
  }, [fetchInstitutions]);

  const filtered = institutions.filter((inst) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      inst.name.toLowerCase().includes(q) ||
      (inst.bic || "").toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2 text-center">
        <p className="text-sm text-destructive">{t("loadError")}</p>
        <Button variant="outline" size="sm" onClick={fetchInstitutions}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder={t("searchBanks")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={disabled}
      />
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder={t("selectInstitution")} />
        </SelectTrigger>
        <SelectContent>
          {filtered.map((inst) => (
            <SelectItem key={inst.id} value={inst.id}>
              <span className="flex items-center gap-2">
                {inst.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={inst.logoUrl}
                    alt=""
                    className="h-4 w-4 rounded-sm object-contain"
                  />
                )}
                <span>{inst.name}</span>
                {inst.bic && (
                  <span className="text-xs text-muted-foreground">
                    {inst.bic}
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

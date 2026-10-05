"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { KeyRound, Copy, Trash2, Plus, Check } from "lucide-react";
import type { ApiTokenPublic, ApiTokenScope } from "@rentular/shared";
import { formatDate } from "@/lib/dateLocale";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

type ExpiryChoice = "" | "30" | "90" | "365";

interface TokenForm {
  name: string;
  scope: ApiTokenScope;
  expiresInDays: ExpiryChoice;
}

const emptyForm: TokenForm = { name: "", scope: "read", expiresInDays: "" };

export function ApiTokensCard({ apiUrl }: { apiUrl: string }) {
  const t = useTranslations("settings");
  const [tokens, setTokens] = useState<ApiTokenPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TokenForm>(emptyForm);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const tokenRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/api-tokens`, {
        credentials: "include",
      });
      if (!res.ok) {
        toast.error(t("apiTokensLoadFailed"));
        return;
      }
      const body = await res.json();
      setTokens(body.data || []);
    } catch {
      toast.error(t("apiTokensLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, t]);

  useEffect(() => {
    load();
  }, [load]);

  const createToken = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/api-tokens`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          scope: form.scope,
          expiresInDays: form.expiresInDays
            ? Number(form.expiresInDays)
            : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 201 && body?.token) {
        setNewToken(body.token);
        setCopied(false);
        setForm(emptyForm);
        await load();
        toast.success(t("tokenCreated"));
      } else {
        toast.error(body?.error || t("tokenCreateFailed"));
      }
    } catch {
      toast.error(t("tokenCreateFailed"));
    } finally {
      setCreating(false);
    }
  };

  const copyToken = async () => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
      toast.success(t("tokenCopied"));
    } catch {
      // Clipboard unavailable: select the text so the user can copy by hand.
      const node = tokenRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  };

  const closeShowOnce = () => {
    setNewToken(null);
    setCopied(false);
  };

  const revokeToken = async (id: string) => {
    setRevokingId(id);
    try {
      const res = await fetch(`${apiUrl}/api/v1/api-tokens/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        toast.success(t("tokenRevoked"));
        await load();
      } else {
        toast.error(t("tokenRevokeFailed"));
      }
    } catch {
      toast.error(t("tokenRevokeFailed"));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          {t("apiTokensTitle")}
        </CardTitle>
        <CardDescription>{t("apiTokensDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Create form */}
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="token-name">{t("tokenName")}</Label>
            <Input
              id="token-name"
              value={form.name}
              maxLength={120}
              placeholder={t("tokenNamePlaceholder")}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="token-scope">{t("tokenScope")}</Label>
            <Select
              value={form.scope}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, scope: v as ApiTokenScope }))
              }
            >
              <SelectTrigger id="token-scope" className="min-w-[10rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">{t("tokenScopeRead")}</SelectItem>
                <SelectItem value="write">{t("tokenScopeWrite")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="token-expiry">{t("tokenExpiry")}</Label>
            <Select
              value={form.expiresInDays}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, expiresInDays: v as ExpiryChoice }))
              }
            >
              <SelectTrigger id="token-expiry" className="min-w-[10rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("tokenNoExpiry")}</SelectItem>
                <SelectItem value="30">
                  {t("tokenExpiryDays", { days: 30 })}
                </SelectItem>
                <SelectItem value="90">
                  {t("tokenExpiryDays", { days: 90 })}
                </SelectItem>
                <SelectItem value="365">
                  {t("tokenExpiryDays", { days: 365 })}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={createToken}
            disabled={creating || !form.name.trim()}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            {t("createToken")}
          </Button>
        </div>

        {/* Token list */}
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : tokens.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center">
            <p className="font-medium">{t("noApiTokens")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("noApiTokensDescription")}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("tokenName")}</TableHead>
                <TableHead>{t("tokenScope")}</TableHead>
                <TableHead>{t("tokenCreatedAt")}</TableHead>
                <TableHead>{t("tokenLastUsed")}</TableHead>
                <TableHead>{t("tokenExpires")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => (
                <TableRow key={token.id}>
                  <TableCell className="font-medium">{token.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={token.scope === "write" ? "default" : "secondary"}
                    >
                      {token.scope === "write"
                        ? t("tokenScopeWriteShort")
                        : t("tokenScopeReadShort")}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(token.createdAt)}</TableCell>
                  <TableCell>
                    {token.lastUsedAt
                      ? formatDate(token.lastUsedAt)
                      : t("tokenNeverUsed")}
                  </TableCell>
                  <TableCell>
                    {token.expiresAt
                      ? formatDate(token.expiresAt)
                      : t("tokenNoExpiry")}
                  </TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={revokingId === token.id}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t("revokeTokenTitle")}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("revokeTokenDescription", { name: token.name })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => revokeToken(token.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {t("revokeToken")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <p className="text-sm text-muted-foreground">{t("apiTokensMcpHint")}</p>
      </CardContent>

      {/* Show-once dialog: the plaintext lives only in newToken state. */}
      <AlertDialog
        open={newToken !== null}
        onOpenChange={(open) => {
          if (!open) closeShowOnce();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tokenShowOnceTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tokenShowOnceDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start gap-2">
            <div
              ref={tokenRef}
              className="flex-1 select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm"
            >
              {newToken}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={copyToken}
              aria-label={t("copyToken")}
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={closeShowOnce}>
              {t("tokenDone")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

"use client";

import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function LoginPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [resetSent, setResetSent] = useState(false);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "forgot") {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      await fetch(`${apiUrl}/api/v1/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResetSent(true);
      return;
    }

    if (password.length < 12) {
      setError(t("passwordTooShort"));
      return;
    }

    if (mode === "register") {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const res = await fetch(`${apiUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t("registrationFailed"));
        return;
      }
    }

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError(t("invalidCredentials"));
    } else {
      window.location.href = "/properties";
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--muted))]">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-md rounded-xl bg-[hsl(var(--background))] p-8 shadow-lg">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-[hsl(var(--foreground))]">
            Rentular
          </h1>
          <p className="mt-2 text-[hsl(var(--muted-foreground))]">
            {t("loginSubtitle")}
          </p>
        </div>

        {/* Email/password form */}
        <form onSubmit={handleCredentials} className="mb-6 space-y-3">
          <div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              required
              className="w-full rounded-lg border border-[hsl(var(--border))] px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
          </div>
          {mode !== "forgot" && (
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                required
                minLength={12}
                className="w-full rounded-lg border border-[hsl(var(--border))] px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
              />
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                {t("passwordRequirement")}
              </p>
            </div>
          )}
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          {resetSent && (
            <p className="text-sm text-green-600">{t("resetEmailSent")}</p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg bg-[hsl(var(--primary))] px-4 py-3 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90"
          >
            {mode === "login"
              ? t("signIn")
              : mode === "register"
                ? t("createAccount")
                : t("sendResetLink")}
          </button>

          <div className="flex justify-between text-xs">
            {mode === "login" ? (
              <>
                <button
                  type="button"
                  onClick={() => { setMode("register"); setError(""); }}
                  className="text-[hsl(var(--primary))] hover:underline"
                >
                  {t("noAccount")}
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("forgot"); setError(""); setResetSent(false); }}
                  className="text-[hsl(var(--primary))] hover:underline"
                >
                  {t("forgotPassword")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => { setMode("login"); setError(""); setResetSent(false); }}
                className="text-[hsl(var(--primary))] hover:underline"
              >
                {t("backToLogin")}
              </button>
            )}
          </div>
        </form>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[hsl(var(--border))]" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-[hsl(var(--background))] px-2 text-[hsl(var(--muted-foreground))]">
              {t("orContinueWith")}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => signIn("google", { callbackUrl: "/properties" })}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-[hsl(var(--border))] px-4 py-3 text-sm font-medium transition-colors hover:bg-[hsl(var(--muted))]"
          >
            <GoogleIcon />
            {t("continueWithGoogle")}
          </button>
          <button
            onClick={() => signIn("facebook", { callbackUrl: "/properties" })}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-[hsl(var(--border))] px-4 py-3 text-sm font-medium transition-colors hover:bg-[hsl(var(--muted))]"
          >
            <FacebookIcon />
            {t("continueWithFacebook")}
          </button>
          <button
            onClick={() => signIn("twitter", { callbackUrl: "/properties" })}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-[hsl(var(--border))] px-4 py-3 text-sm font-medium transition-colors hover:bg-[hsl(var(--muted))]"
          >
            <TwitterIcon />
            {t("continueWithTwitter")}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
          {t("termsNotice")}
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg className="h-5 w-5" fill="#1877F2" viewBox="0 0 24 24">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="currentColor" />
    </svg>
  );
}

// Thin fetch client that holds the Personal Access Token and calls the Rentular
// HTTP API. Modeled on apps/api/src/lib/whatsapp.ts: env-driven, AbortController
// timeout, descriptive non-ok handling. It never re-implements authorization and
// never touches the database; the API enforces scope, role and property access.
//
// stdout is the MCP protocol channel, so this module logs only to stderr and
// never logs the token.

import type { ApiClient, ApiResult } from "./tools/types.js";

const DEFAULT_TIMEOUT_MS = 20000;

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// Strip a trailing slash and a trailing /api/v1 so the caller can pass either
// https://www.rentular.com or https://www.rentular.com/api/v1; every request is
// then prefixed with /api/v1 exactly once.
function normalizeBaseUrl(raw: string): string {
  let base = raw.trim().replace(/\/+$/, "");
  if (base.toLowerCase().endsWith("/api/v1")) {
    base = base.slice(0, -"/api/v1".length);
  }
  return base.replace(/\/+$/, "");
}

function buildUrl(
  base: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  let url = `${base}/api/v1${suffix}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    if (qs) {
      url += `?${qs}`;
    }
  }
  return url;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const base = normalizeBaseUrl(opts.baseUrl);
  const timeoutMs =
    opts.timeoutMs ?? (Number(process.env.RENTULAR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const doFetch = opts.fetchImpl ?? fetch;

  async function request(
    method: "GET" | "POST",
    path: string,
    tool: string,
    query?: Record<string, string | number | undefined>,
    body?: unknown,
  ): Promise<ApiResult> {
    const url = buildUrl(base, path, query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/json",
      "X-Rentular-Tool": tool,
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[rentular-mcp] ${tool}: API unreachable: ${message}`);
      return { ok: false, status: 0, text: `Rentular API unreachable: ${message}` };
    }
    clearTimeout(timer);

    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, text };
  }

  return {
    get: (path, tool, query) => request("GET", path, tool, query),
    post: (path, tool, body) => request("POST", path, tool, undefined, body),
  };
}

export interface EnvConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
}

// Read and validate the env contract. Throws a clear error naming the missing
// variable so a misconfigured client fails fast with an actionable message.
export function readEnvConfig(): EnvConfig {
  const baseUrl = process.env.RENTULAR_API_URL;
  const token = process.env.RENTULAR_PAT;
  if (!baseUrl) {
    throw new Error(
      "RENTULAR_API_URL is not set. Set it to your Rentular base URL, e.g. https://www.rentular.com",
    );
  }
  if (!token) {
    throw new Error(
      "RENTULAR_PAT is not set. Create a Personal Access Token in Settings > API tokens and set RENTULAR_PAT.",
    );
  }
  if (!token.startsWith("rtl_")) {
    throw new Error(
      "RENTULAR_PAT does not look like a Rentular token (it must start with rtl_).",
    );
  }
  const timeoutMs = Number(process.env.RENTULAR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  return { baseUrl, token, timeoutMs };
}

/**
 * Which bank-data providers a landlord may use to connect a bank account.
 *
 *   - Self-hosted install: Enable Banking with the landlord's own application
 *     (default), plus Ponto when Ponto credentials are configured.
 *   - Hosted (rentular.com), free plan: the same two options, Enable Banking
 *     first. Ponto is the convenient one (no own app), billed by Ponto.
 *   - Hosted, paid plan: Ponto only. The hosted service never runs Enable
 *     Banking connections of many landlords over one shared application.
 *
 * Connections that already exist keep working whatever the plan; the result
 * carries a notice so the landlord knows.
 */

export type RentularInstance = "hosted" | "self";
export type BankProvider = "enable_banking" | "ponto";
export type Plan = "free" | "paid";

/** Properties included in the free plan (pricing copy: "Up to 3 properties"). */
export const FREE_PLAN_PROPERTY_LIMIT = 3;

/**
 * RENTULAR_INSTANCE=hosted on rentular.com, "self" elsewhere. When unset, a
 * WEB_URL on rentular.com counts as hosted, anything else as self-hosted.
 */
export function resolveInstance(env: NodeJS.ProcessEnv = process.env): RentularInstance {
  const v = (env.RENTULAR_INSTANCE || "").trim().toLowerCase();
  if (v === "hosted") return "hosted";
  if (v === "self" || v === "self-hosted" || v === "selfhosted") return "self";
  try {
    const host = new URL(env.WEB_URL || "http://localhost").hostname.toLowerCase();
    if (host === "rentular.com" || host.endsWith(".rentular.com")) return "hosted";
  } catch {
    // An unparsable WEB_URL is treated as self-hosted.
  }
  return "self";
}

/**
 * The landlord's plan: the stored users.plan when set, otherwise paid above
 * the free plan's property limit and free up to it.
 */
export function derivePlan(input: { plan?: string | null; propertyCount: number }): Plan {
  if (input.plan === "free" || input.plan === "paid") return input.plan;
  return input.propertyCount > FREE_PLAN_PROPERTY_LIMIT ? "paid" : "free";
}

export type ProviderNotice = "enable_banking_kept" | "ponto_kept";

export interface BankProviderOptions {
  instance: RentularInstance;
  plan: Plan;
  /** Providers the landlord may start a new connection with, default first. */
  providers: BankProvider[];
  defaultProvider: BankProvider | null;
  /** Existing connections on a provider no longer offered keep working. */
  notices: ProviderNotice[];
}

export function resolveBankProviderOptions(input: {
  instance: RentularInstance;
  plan: Plan;
  pontoConfigured: boolean;
  /** Providers of the landlord's current active connections. */
  activeProviders?: string[];
}): BankProviderOptions {
  const providers: BankProvider[] = [];
  const offerEnableBanking = input.instance === "self" || input.plan === "free";
  if (offerEnableBanking) providers.push("enable_banking");
  if (input.pontoConfigured) providers.push("ponto");

  const active = new Set(input.activeProviders || []);
  const notices: ProviderNotice[] = [];
  if (active.has("enable_banking") && !providers.includes("enable_banking")) {
    notices.push("enable_banking_kept");
  }
  if (active.has("ponto") && !providers.includes("ponto")) {
    notices.push("ponto_kept");
  }

  return {
    instance: input.instance,
    plan: input.plan,
    providers,
    defaultProvider: providers[0] ?? null,
    notices,
  };
}

/**
 * The instance-wide Enable Banking application from the environment
 * (ENABLE_BANKING_APP_ID + ENABLE_BANKING_PRIVATE_KEY_PATH), meant for a
 * single-landlord self-hosted install. Never used on the hosted service.
 */
export function instanceEnableBankingEnv(
  env: NodeJS.ProcessEnv = process.env,
): { applicationId: string; privateKeyPath: string } | null {
  if (resolveInstance(env) !== "self") return null;
  const applicationId = env.ENABLE_BANKING_APP_ID?.trim();
  const privateKeyPath = env.ENABLE_BANKING_PRIVATE_KEY_PATH?.trim();
  if (!applicationId || !privateKeyPath) return null;
  return { applicationId, privateKeyPath };
}

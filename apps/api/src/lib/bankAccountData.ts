/**
 * Provider-agnostic interface for Open Banking (PSD2) bank account data.
 * Implementations: GoCardless BAD (existing account), Ponto, Enable Banking.
 * Per D-03: Landlord connects their bank, system polls for incoming transfers.
 */

import type { PontoModel } from "./pontoConnect";

export interface IncomingTransaction {
  transactionId: string;
  amount: number; // positive = credit, negative = debit
  currency: string;
  bookingDate: string; // YYYY-MM-DD
  remittanceStructured?: string; // Belgian +++xxx/xxxx/xxxxx+++
  remittanceUnstructured?: string; // Free text
  debtorName?: string;
  debtorIban?: string;
}

export interface BankAccountInfo {
  accountId: string;
  iban: string;
  institutionId: string;
  institutionName: string;
  status: string;
}

export interface ConsentResult {
  requisitionId: string;
  consentLink: string;
  expiresAt: Date; // 90 days per D-08
}

export interface BankAccountDataProvider {
  /** Get name of this provider for logging/display */
  readonly name: string;

  /** Create a consent/requisition for the user to authorize bank access */
  createConsent(params: {
    institutionId: string;
    redirectUrl: string;
    reference?: string;
  }): Promise<ConsentResult>;

  /** List accounts accessible under a requisition */
  listAccounts(requisitionId: string): Promise<BankAccountInfo[]>;

  /** Fetch transactions for an account since a cursor/date */
  getTransactions(params: {
    accountId: string;
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string; // YYYY-MM-DD
  }): Promise<IncomingTransaction[]>;

  /** Attempt silent consent renewal (D-09). Returns new expiry or null if renewal failed. */
  renewConsent(requisitionId: string): Promise<Date | null>;

  /** Delete/revoke a consent */
  revokeConsent(requisitionId: string): Promise<void>;
}

/**
 * GoCardless Bank Account Data (formerly Nordigen) implementation.
 * Requires existing account (new registrations closed mid-2025).
 * Env vars: GOCARDLESS_BAD_SECRET_ID, GOCARDLESS_BAD_SECRET_KEY
 */
export class GoCardlessBadProvider implements BankAccountDataProvider {
  readonly name = "gocardless_bad";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: Record<string, any> | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getClient(): Promise<Record<string, any>> {
    if (this.client) return this.client;

    const secretId = process.env.GOCARDLESS_BAD_SECRET_ID;
    const secretKey = process.env.GOCARDLESS_BAD_SECRET_KEY;

    if (!secretId || !secretKey) {
      throw new Error(
        "GOCARDLESS_BAD_SECRET_ID and GOCARDLESS_BAD_SECRET_KEY must be set"
      );
    }

    // Dynamic import to avoid failing at startup if nordigen-node not installed
    try {
      const NordigenClient = (await import("nordigen-node")).default;
      this.client = new NordigenClient({ secretId, secretKey });
      // Generate access token
      await this.client!.generateToken();
      return this.client!;
    } catch (err) {
      throw new Error(`Failed to initialize GoCardless BAD client: ${err}`);
    }
  }

  async createConsent(params: {
    institutionId: string;
    redirectUrl: string;
    reference?: string;
  }): Promise<ConsentResult> {
    const client = await this.getClient();
    const requisition = await client.requisition.createRequisition({
      redirect: params.redirectUrl,
      institution_id: params.institutionId,
      reference: params.reference || crypto.randomUUID(),
      user_language: "EN",
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90); // 90-day PSD2 consent (D-08)

    return {
      requisitionId: requisition.id,
      consentLink: requisition.link,
      expiresAt,
    };
  }

  async listAccounts(requisitionId: string): Promise<BankAccountInfo[]> {
    const client = await this.getClient();
    const requisition =
      await client.requisition.getRequisitionById(requisitionId);

    const accounts: BankAccountInfo[] = [];
    for (const accountId of requisition.accounts || []) {
      try {
        const account = client.account(accountId);
        const details = await account.getDetails();
        const metadata = await account.getMetadata();

        accounts.push({
          accountId,
          iban: details.account?.iban || "",
          institutionId: metadata.institution_id || "",
          institutionName: "", // Nordigen doesn't return this directly
          status: metadata.status || "unknown",
        });
      } catch (err) {
        console.error(
          `[BankAccountData] Failed to get account ${accountId}:`,
          err
        );
      }
    }

    return accounts;
  }

  async getTransactions(params: {
    accountId: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<IncomingTransaction[]> {
    const client = await this.getClient();
    const account = client.account(params.accountId);

    const txData = await account.getTransactions({
      date_from: params.dateFrom,
      date_to: params.dateTo,
    });

    const booked = txData.transactions?.booked || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return booked.map((tx: any) => ({
      transactionId:
        tx.transactionId || tx.internalTransactionId || crypto.randomUUID(),
      amount: Number(tx.transactionAmount?.amount || 0),
      currency: tx.transactionAmount?.currency || "EUR",
      bookingDate: tx.bookingDate || "",
      remittanceStructured:
        tx.remittanceInformationStructured || undefined,
      remittanceUnstructured:
        tx.remittanceInformationUnstructured || undefined,
      debtorName: tx.debtorName || undefined,
      debtorIban: tx.debtorAccount?.iban || undefined,
    }));
  }

  async renewConsent(requisitionId: string): Promise<Date | null> {
    // GoCardless BAD does not support silent renewal.
    // Landlord must re-authorize via new consent link (D-09 fallback).
    console.log(
      `[BankAccountData] Silent renewal not supported for GoCardless BAD requisition ${requisitionId}`
    );
    return null;
  }

  async revokeConsent(requisitionId: string): Promise<void> {
    const client = await this.getClient();
    await client.requisition.deleteRequisition(requisitionId);
  }
}

/**
 * Ponto Connect (Ibanity, Customer-Paying) implementation. Belgian-domiciled
 * provider chosen for Phase 9 (CONTEXT D-Provider). Each landlord registers
 * their OWN Ibanity organisation; Rentular only stores the OAuth tokens.
 *
 * Tokens (accessToken + refreshToken) are NOT held in this class' state —
 * they are passed via setTokens() by the route layer (Plan 03) or the
 * polling worker (Plan 03 Task 3) which decrypts them from
 * bank_connections.encrypted_access_token / encrypted_refresh_token.
 *
 * The 180-day default expiresAt below is a fall-back: the callback route
 * (Plan 03 Task 2) OVERWRITES expiresAt with the value from the post-token-
 * exchange consent metadata. The 180-day default mirrors the EBA upper bound
 * and ensures Phase C consent-expiry warnings still trigger if metadata is
 * missing.
 */
export class PontoConnectProvider implements BankAccountDataProvider {
  readonly name = "ponto";
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private model: PontoModel = "ppm";

  constructor(tokens?: {
    accessToken: string;
    refreshToken?: string;
    model?: PontoModel;
  }) {
    if (tokens) {
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken || null;
      if (tokens.model) this.model = tokens.model;
    }
  }

  /** Inject (or rotate) the per-connection OAuth tokens after construction. */
  setTokens(tokens: { accessToken: string; refreshToken?: string }): void {
    this.accessToken = tokens.accessToken;
    if (tokens.refreshToken !== undefined) {
      this.refreshToken = tokens.refreshToken;
    }
  }

  private requireAccessToken(): string {
    if (!this.accessToken) {
      throw new Error(
        "[BankAccountData] PontoConnectProvider has no accessToken; call setTokens() first"
      );
    }
    return this.accessToken;
  }

  async createConsent(params: {
    institutionId: string;
    redirectUrl: string;
    reference?: string;
  }): Promise<ConsentResult> {
    const { createPontoAuthorizationUrl } = await import("./pontoConnect");
    const state = params.reference || crypto.randomUUID();
    const consentLink = createPontoAuthorizationUrl({
      state,
      redirectUri: params.redirectUrl,
      model: this.model,
    });

    // Default to EBA upper bound (180 days). The callback route MUST overwrite
    // this with the real consent metadata once tokens are exchanged.
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 180);

    return {
      requisitionId: params.institutionId,
      consentLink,
      expiresAt,
    };
  }

  async listAccounts(_requisitionId: string): Promise<BankAccountInfo[]> {
    const { listAccounts: pontoListAccounts } = await import("./pontoConnect");
    const accessToken = this.requireAccessToken();
    const accounts = await pontoListAccounts({ accessToken, model: this.model });
    return accounts.map((a) => ({
      accountId: a.id,
      iban: a.iban,
      // institutionId is resolved by the route layer using bank_connections.providerMetadata
      institutionId: "",
      institutionName: a.holderName || "",
      status: "active",
    }));
  }

  async getTransactions(params: {
    accountId: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<IncomingTransaction[]> {
    const { listTransactions } = await import("./pontoConnect");
    const accessToken = this.requireAccessToken();
    const txs = await listTransactions({
      accessToken,
      accountId: params.accountId,
      dateFrom: params.dateFrom,
      model: this.model,
    });
    return txs.map((t) => ({
      transactionId: t.id,
      amount: t.amount,
      currency: t.currency,
      bookingDate: t.executionDate || t.valueDate || "",
      remittanceStructured:
        t.remittanceInformationType === "structured"
          ? t.remittanceInformation
          : undefined,
      remittanceUnstructured:
        t.remittanceInformationType === "unstructured"
          ? t.remittanceInformation
          : undefined,
      debtorName: t.counterpartName,
      debtorIban: t.counterpartReference,
    }));
  }

  async renewConsent(_requisitionId: string): Promise<Date | null> {
    // Ponto Connect does not support silent renewal — the landlord must
    // re-authorize via a fresh OAuth round trip. Phase C consent-expiry
    // worker sends warning emails at 7-day / 1-day thresholds (existing
    // pattern, same as GoCardless BAD).
    console.log(
      "[BankAccountData] Silent renewal not supported for Ponto; landlord must re-authorize"
    );
    return null;
  }

  async revokeConsent(_requisitionId: string): Promise<void> {
    const { revokeAccess } = await import("./pontoConnect");
    const accessToken = this.requireAccessToken();
    await revokeAccess(accessToken, this.model);
  }
}

/**
 * Factory function. Selects the bank-data provider based on
 * BANK_DATA_PROVIDER:
 *   - "ponto" (default)  → PontoConnectProvider
 *   - "gocardless_bad"   → GoCardlessBadProvider (dormant reference)
 *
 * The optional `tokens` parameter lets the polling worker construct a
 * Ponto provider pre-loaded with a specific landlord's decrypted OAuth
 * tokens (Plan 03 Task 3 will wire this).
 */
export function getBankAccountDataProvider(
  tokens?: { accessToken: string; refreshToken?: string; model?: PontoModel }
): BankAccountDataProvider {
  const provider = (process.env.BANK_DATA_PROVIDER || "ponto").toLowerCase();
  if (provider === "gocardless_bad") return new GoCardlessBadProvider();
  return new PontoConnectProvider(tokens);
}

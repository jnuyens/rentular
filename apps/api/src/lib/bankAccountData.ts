/**
 * Provider-agnostic interface for Open Banking (PSD2) bank account data.
 * Implementations: GoCardless BAD (existing account), Ponto, Enable Banking.
 * Per D-03: Landlord connects their bank, system polls for incoming transfers.
 */

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

/** Factory function to get the configured bank account data provider */
export function getBankAccountDataProvider(): BankAccountDataProvider {
  // Currently only GoCardless BAD is implemented.
  // Future: check env var or config to select between providers.
  return new GoCardlessBadProvider();
}

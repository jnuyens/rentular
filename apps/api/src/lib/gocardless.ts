import GoCardless from "gocardless-nodejs";
import { Environments } from "gocardless-nodejs/constants";
import { GOCARDLESS_SCHEME } from "@rentular/shared";

// GoCardless client singleton
let client: GoCardless | null = null;

export function getGoCardlessClient(): GoCardless {
  if (client) return client;

  const accessToken = process.env.GOCARDLESS_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error(
      "GOCARDLESS_ACCESS_TOKEN is not set. Configure it in your environment."
    );
  }

  const environment =
    process.env.GOCARDLESS_ENVIRONMENT === "live"
      ? Environments.Live
      : Environments.Sandbox;

  client = new GoCardless(accessToken, environment);
  return client;
}

export function isGoCardlessConfigured(): boolean {
  return !!process.env.GOCARDLESS_ACCESS_TOKEN;
}

// Verify webhook signature from GoCardless
// GoCardless signs webhooks with HMAC-SHA256
export function verifyWebhookSignature(
  body: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;

  const crypto = require("crypto");
  const computed = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(computed)
    );
  } catch {
    return false;
  }
}

// GoCardless event types we handle
export interface GoCardlessEvent {
  id: string;
  created_at: string;
  resource_type: string;
  action: string;
  links: Record<string, string>;
  details: {
    origin: string;
    cause: string;
    description: string;
  };
}

export interface GoCardlessWebhookPayload {
  events: GoCardlessEvent[];
}

// Create a customer in GoCardless from tenant data
export async function createCustomer(params: {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  addressLine1?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string;
}): Promise<string> {
  const gc = getGoCardlessClient();

  const customer = await gc.customers.create({
    email: params.email,
    given_name: params.firstName,
    family_name: params.lastName,
    phone_number: params.phone || undefined,
    address_line1: params.addressLine1 || undefined,
    city: params.city || undefined,
    postal_code: params.postalCode || undefined,
    country_code: params.countryCode || "BE",
  });

  return customer.id!;
}

// Create a billing request flow for mandate setup
// Returns a URL the tenant visits to authorise the SEPA direct debit mandate
export async function createMandateSetupFlow(params: {
  tenantEmail: string;
  tenantFirstName: string;
  tenantLastName: string;
  customerId?: string;
  description: string;
  redirectUrl: string;
  metadata?: Record<string, string>;
}): Promise<{ flowId: string; authorisationUrl: string; customerId?: string }> {
  const gc = getGoCardlessClient();

  // Step 1: Create a billing request
  const billingRequest = await gc.billingRequests.create({
    mandate_request: {
      scheme: GOCARDLESS_SCHEME,
      metadata: params.metadata,
    },
    ...(params.customerId
      ? {
          links: {
            customer: params.customerId,
          },
        }
      : {}),
  });

  // Step 2: Create a billing request flow (redirect URL for tenant)
  const flow = await gc.billingRequestFlows.create({
    redirect_uri: params.redirectUrl,
    exit_uri: params.redirectUrl,
    links: {
      billing_request: billingRequest.id!,
    },
    // Pre-fill tenant details if no existing customer
    ...(!params.customerId
      ? {
          prefilled_customer: {
            email: params.tenantEmail,
            given_name: params.tenantFirstName,
            family_name: params.tenantLastName,
          },
        }
      : {}),
  });

  return {
    flowId: flow.id!,
    authorisationUrl: flow.authorisation_url!,
    customerId: billingRequest.links?.customer,
  };
}

// Get mandate details
export async function getMandate(mandateId: string) {
  const gc = getGoCardlessClient();
  return gc.mandates.get(mandateId);
}

// Cancel a mandate
export async function cancelMandate(mandateId: string) {
  const gc = getGoCardlessClient();
  return gc.mandates.cancel(mandateId);
}

// Create a payment against an active mandate
export async function createPayment(params: {
  mandateId: string;
  amount: number; // in EUR (will be converted to cents)
  description: string;
  chargeDate?: string; // YYYY-MM-DD, defaults to earliest possible
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}): Promise<{
  paymentId: string;
  status: string;
  chargeDate: string;
}> {
  const gc = getGoCardlessClient();

  // GoCardless amounts are in cents
  const amountInCents = Math.round(params.amount * 100);

  const payment = await gc.payments.create(
    {
      amount: amountInCents,
      currency: "EUR",
      description: params.description,
      links: {
        mandate: params.mandateId,
      },
      charge_date: params.chargeDate || undefined,
      metadata: params.metadata,
    },
    params.idempotencyKey
      ? { "Idempotency-Key": params.idempotencyKey }
      : undefined
  );

  return {
    paymentId: payment.id!,
    status: payment.status!,
    chargeDate: payment.charge_date!,
  };
}

// Retry a failed payment
export async function retryPayment(paymentId: string) {
  const gc = getGoCardlessClient();
  return gc.payments.retry(paymentId);
}

// Cancel a pending payment
export async function cancelPayment(paymentId: string) {
  const gc = getGoCardlessClient();
  return gc.payments.cancel(paymentId);
}

// List payments for a mandate
export async function listPayments(mandateId: string) {
  const gc = getGoCardlessClient();
  return gc.payments.list({ mandate: mandateId });
}

export { GOCARDLESS_SCHEME };

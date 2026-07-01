import Stripe from "stripe";

// Stripe client singleton — lazily constructed so an unset STRIPE_SECRET_KEY
// never runs `new Stripe()` at module import / API boot (D-09). Mirrors the
// isGoCardlessConfigured / getGoCardlessClient guard pattern in gocardless.ts.
let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (client) return client;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Configure it in your environment."
    );
  }

  client = new Stripe(secretKey);
  return client;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

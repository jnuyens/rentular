import { Hono } from "hono";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

export const stripeRouter = new Hono();

const PLANS: Record<string, { priceId: string; name: string }> = {
  starter: {
    priceId: process.env.STRIPE_PRICE_STARTER || "",
    name: "Starter",
  },
  standard: {
    priceId: process.env.STRIPE_PRICE_STANDARD || "",
    name: "Standard",
  },
  professional: {
    priceId: process.env.STRIPE_PRICE_PROFESSIONAL || "",
    name: "Professional",
  },
};

// GET /plans - Return pricing plans (D-04: real Stripe pricing)
stripeRouter.get("/plans", async (c) => {
  // If Stripe is not configured, return static fallback prices
  if (!process.env.STRIPE_SECRET_KEY) {
    return c.json({
      plans: [
        { id: "starter", name: "Starter", price: 400, currency: "eur", interval: "month", features: ["Up to 5 leases", "SEPA direct debit", "Email reminders"] },
        { id: "standard", name: "Standard", price: 1000, currency: "eur", interval: "month", features: ["Up to 20 leases", "SEPA direct debit", "Email + SMS reminders", "Rent indexation"] },
        { id: "professional", name: "Professional", price: 1900, currency: "eur", interval: "month", features: ["Unlimited leases", "SEPA direct debit", "Email + SMS reminders", "Rent indexation", "Property managers", "Priority support"] },
      ],
    });
  }

  try {
    const priceIds = [
      process.env.STRIPE_PRICE_STARTER,
      process.env.STRIPE_PRICE_STANDARD,
      process.env.STRIPE_PRICE_PROFESSIONAL,
    ].filter(Boolean) as string[];

    const prices = await Promise.all(
      priceIds.map((id) => stripe.prices.retrieve(id, { expand: ["product"] }))
    );

    return c.json({
      plans: prices.map((p) => ({
        id: ((p.product as Stripe.Product).metadata?.plan) || p.id,
        name: (p.product as Stripe.Product).name || "Plan",
        price: p.unit_amount,
        currency: p.currency,
        interval: p.recurring?.interval || "month",
        features: ((p.product as Stripe.Product).metadata?.features || "").split(",").filter(Boolean),
      })),
    });
  } catch (err) {
    console.error("[Stripe] Failed to fetch plans:", err);
    // Fallback to static prices on error
    return c.json({
      plans: [
        { id: "starter", name: "Starter", price: 400, currency: "eur", interval: "month", features: [] },
        { id: "standard", name: "Standard", price: 1000, currency: "eur", interval: "month", features: [] },
        { id: "professional", name: "Professional", price: 1900, currency: "eur", interval: "month", features: [] },
      ],
    });
  }
});

// Create a Stripe Checkout session
stripeRouter.post("/checkout", async (c) => {
  const body = await c.req.json();
  const { plan, email } = body;

  if (!plan || !PLANS[plan]) {
    return c.json({ error: "Invalid plan" }, 400);
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "Stripe is not configured" }, 503);
  }

  const planConfig = PLANS[plan];

  if (!planConfig.priceId) {
    return c.json({ error: "Price not configured for this plan" }, 503);
  }

  const webUrl = process.env.WEB_URL || "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card", "bancontact", "ideal"],
    line_items: [{ price: planConfig.priceId, quantity: 1 }],
    customer_email: email || undefined,
    success_url: `${webUrl}/properties?subscribed=true&plan=${plan}`,
    cancel_url: `${webUrl}/?cancelled=true`,
    metadata: { plan },
    subscription_data: {
      metadata: { plan },
    },
    allow_promotion_codes: true,
  });

  return c.json({ url: session.url });
});

// Stripe webhook for subscription events
stripeRouter.post("/webhook", async (c) => {
  const sig = c.req.header("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return c.json({ error: "Missing signature or webhook secret" }, 400);
  }

  const body = await c.req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("[Stripe] Webhook signature verification failed:", err);
    return c.json({ error: "Invalid signature" }, 400);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(
        `[Stripe] Checkout completed: ${session.customer_email}, plan: ${session.metadata?.plan}`
      );
      // Phase 2: implement subscription persistence
      break;
    }
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      console.log(
        `[Stripe] Subscription updated: ${subscription.id}, status: ${subscription.status}`
      );
      // Phase 2: implement subscription persistence
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      console.log(`[Stripe] Subscription cancelled: ${subscription.id}`);
      // Phase 2: implement subscription persistence
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log(
        `[Stripe] Payment failed: ${invoice.customer_email}`
      );
      // Phase 2: implement subscription persistence
      break;
    }
    default:
      console.log(`[Stripe] Unhandled event: ${event.type}`);
  }

  return c.json({ received: true });
});

// Get subscription status for authenticated user
stripeRouter.get("/subscription", async (c) => {
  // Phase 2: implement subscription persistence
  return c.json({
    plan: null,
    status: "none",
    trialEndsAt: null,
  });
});

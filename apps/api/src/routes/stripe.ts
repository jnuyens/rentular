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
      // TODO: Activate subscription in DB for this user
      break;
    }
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      console.log(
        `[Stripe] Subscription updated: ${subscription.id}, status: ${subscription.status}`
      );
      // TODO: Update subscription status in DB
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      console.log(`[Stripe] Subscription cancelled: ${subscription.id}`);
      // TODO: Mark subscription as cancelled in DB
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log(
        `[Stripe] Payment failed: ${invoice.customer_email}`
      );
      // TODO: Notify user of failed payment
      break;
    }
    default:
      console.log(`[Stripe] Unhandled event: ${event.type}`);
  }

  return c.json({ received: true });
});

// Get subscription status for authenticated user
stripeRouter.get("/subscription", async (c) => {
  // TODO: Look up user's Stripe customer ID from DB and return subscription details
  return c.json({
    plan: null,
    status: "none",
    trialEndsAt: null,
  });
});

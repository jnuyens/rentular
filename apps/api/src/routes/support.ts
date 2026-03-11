import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { queueEmail } from "../jobs/emailQueueWorker";

export const supportRouter = new Hono();

// Chat with support - stores the message and sends notification to support team
supportRouter.post(
  "/chat",
  zValidator(
    "json",
    z.object({
      message: z.string().min(1).max(5000),
    })
  ),
  async (c) => {
    const { message } = c.req.valid("json");

    // TODO: Get authenticated user from session
    // const userId = c.get("userId");
    // const userEmail = c.get("userEmail");

    // TODO: Store support message in database
    // await db.insert(supportMessages).values({
    //   id: crypto.randomUUID(),
    //   userId,
    //   message,
    //   createdAt: new Date(),
    // });

    // Notify support team via email if configured
    const supportEmail = process.env.SUPPORT_EMAIL;
    if (supportEmail) {
      await queueEmail({
        to: supportEmail,
        subject: `[Rentular Support] New message`,
        body: `A user sent a support message:\n\n${message}`,
      });
    }

    // Auto-reply based on keywords
    const lowerMessage = message.toLowerCase();
    let reply: string;

    if (
      lowerMessage.includes("price") ||
      lowerMessage.includes("prijs") ||
      lowerMessage.includes("prix") ||
      lowerMessage.includes("preis") ||
      lowerMessage.includes("billing") ||
      lowerMessage.includes("invoice") ||
      lowerMessage.includes("factuur") ||
      lowerMessage.includes("facture")
    ) {
      reply =
        "For billing questions, please check the pricing page at rentular.com or email us at billing@rentular.com. Our plans start at \u20ac4/month for 1 contract, \u20ac10/month for up to 5 contracts, and \u20ac19/month for unlimited contracts.";
    } else if (
      lowerMessage.includes("bug") ||
      lowerMessage.includes("error") ||
      lowerMessage.includes("fout") ||
      lowerMessage.includes("erreur") ||
      lowerMessage.includes("fehler") ||
      lowerMessage.includes("broken") ||
      lowerMessage.includes("crash")
    ) {
      reply =
        "Thank you for reporting this issue. Our team has been notified and will investigate. For urgent issues, you can also open a GitHub issue at github.com/jnuyens/rentular/issues.";
    } else if (
      lowerMessage.includes("feature") ||
      lowerMessage.includes("functie") ||
      lowerMessage.includes("fonctionnalit") ||
      lowerMessage.includes("funktion") ||
      lowerMessage.includes("request") ||
      lowerMessage.includes("suggest")
    ) {
      reply =
        "Thank you for the suggestion! We love hearing from our users. You can also submit feature requests on GitHub at github.com/jnuyens/rentular/issues - the community can vote on ideas there.";
    } else if (
      lowerMessage.includes("gocardless") ||
      lowerMessage.includes("sepa") ||
      lowerMessage.includes("domicili") ||
      lowerMessage.includes("lastschrift") ||
      lowerMessage.includes("direct debit")
    ) {
      reply =
        "SEPA direct debit via GoCardless is available on all hosted plans. To set it up, go to a lease and click 'Set up direct debit'. The tenant will receive a link to authorise the mandate.";
    } else if (
      lowerMessage.includes("indexat") ||
      lowerMessage.includes("index") ||
      lowerMessage.includes("epc")
    ) {
      reply =
        "Rent indexation is calculated automatically based on the Belgian health index. EPC-based restrictions for Brussels and Flanders are built in. Check the Indexation page for details on your leases.";
    } else {
      reply =
        "Thank you for your message. Our support team will get back to you shortly. In the meantime, check our documentation or GitHub for answers to common questions.";
    }

    return c.json({ reply });
  }
);

// Get support chat history
supportRouter.get("/chat/history", async (c) => {
  // TODO: Fetch messages for authenticated user from database
  return c.json({ data: [] });
});

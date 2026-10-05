import { z } from "zod";
import type { ApiClient, ApiResult, ToolDef } from "./types.js";
import { textResult } from "./types.js";

// Four write tools mapped to the hardened manager+ POST endpoints. Each tool
// relays the API response verbatim; it never self-authorizes. The API returns
// 403 for a viewer or a read-scoped token, and we make that refusal explicit so
// the model explains it instead of retrying. inputSchema values are zod RAW
// SHAPES (plain objects of validators), not wrapped objects.

const monthShape = z.string().regex(/^\d{4}-\d{2}$/);
const dateShape = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const methodShape = z.enum(["cash", "bank_transfer", "other"]).optional();

// Run a POST and, on a 403, prefix the body so the refusal reads clearly.
async function postWrite(
  api: ApiClient,
  path: string,
  tool: string,
  body: unknown,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const res = await api.post(path, tool, body);
  if (res.status === 403) {
    const refused: ApiResult = {
      ...res,
      text: `Refused by Rentular (insufficient role or read-only token): ${res.text}`,
    };
    return textResult(refused);
  }
  return textResult(res);
}

export const writeTools: ToolDef[] = [
  {
    name: "mark_rent_paid",
    description:
      "Requires a write-scoped token and manager or higher on the property. Mark a lease's rent for a given month (YYYY-MM) as paid, creating the payment record if needed.",
    inputSchema: {
      leaseId: z.string().min(1),
      month: monthShape,
      method: methodShape,
      date: dateShape.optional(),
    },
    handler: async (args, api) =>
      postWrite(api, "/payments/mark-month-paid", "mark_rent_paid", {
        leaseId: args.leaseId,
        month: args.month,
        method: args.method,
        date: args.date,
      }),
  },
  {
    name: "send_reminder",
    description:
      "Requires a write-scoped token and manager or higher on the property. Sends a rent reminder to the tenant over the tenant's preferred channel (email, SMS or WhatsApp, as set on the tenant record), falling back to email when that channel is not available. The response names the channel used and the address or number it went to. Choose a level: friendly, formal or final.",
    inputSchema: {
      leaseId: z.string().min(1),
      month: monthShape,
      level: z.enum(["friendly", "formal", "final"]),
    },
    handler: async (args, api) =>
      postWrite(api, "/payments/send-reminder", "send_reminder", {
        leaseId: args.leaseId,
        month: args.month,
        level: args.level,
      }),
  },
  {
    name: "record_ledger_payment",
    description:
      "Requires a write-scoped token and manager or higher on the property. Record a payment received for a lease (lease id) against a period (periodMonth YYYY-MM), for rent paid outside the app.",
    inputSchema: {
      leaseId: z.string().min(1),
      periodMonth: monthShape,
      amount: z.number().positive(),
      method: methodShape,
      date: dateShape.optional(),
    },
    handler: async (args, api) =>
      postWrite(api, `/ledger/${args.leaseId}/record-payment`, "record_ledger_payment", {
        periodMonth: args.periodMonth,
        amount: args.amount,
        method: args.method,
        date: args.date,
      }),
  },
  {
    name: "apply_indexation",
    description:
      "Requires a write-scoped token and manager or higher on the property. Changes the lease rent and may email the tenant. Indexation can only be applied once a year from the lease anniversary; the API enforces this and caps the rent at the EPC limit.",
    inputSchema: {
      leaseId: z.string().min(1),
      newRent: z.number().positive(),
      subject: z.string().min(1),
      body: z.string().min(1),
      sendNotification: z.boolean().default(true),
    },
    handler: async (args, api) =>
      postWrite(api, `/indexation/apply/${args.leaseId}`, "apply_indexation", {
        newRent: args.newRent,
        subject: args.subject,
        body: args.body,
        sendNotification: args.sendNotification ?? true,
      }),
  },
];

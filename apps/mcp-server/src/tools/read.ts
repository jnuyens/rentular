import { z } from "zod";
import type { ToolDef } from "./types.js";
import { textResult } from "./types.js";

// Seven read tools mapped to existing GET endpoints. The result of every tool is
// limited to what the token owner can access: scoping happens in the API (each
// handler calls getAccessiblePropertyIds), never in this process. inputSchema
// values are zod RAW SHAPES (plain objects of validators), not wrapped objects.

export const readTools: ToolDef[] = [
  {
    name: "list_properties",
    description:
      "List the properties the token owner can access, each with the owner's role on it. Results are limited to properties the token can access.",
    inputSchema: {},
    handler: async (_args, api) => textResult(await api.get("/properties", "list_properties")),
  },
  {
    name: "get_property",
    description:
      "Get one property by its property id. Returns 404 (surfaced as an error) if the property is not among those the token can access.",
    inputSchema: { propertyId: z.string().min(1) },
    handler: async (args, api) =>
      textResult(
        await api.get(`/properties/${encodeURIComponent(args.propertyId)}`, "get_property"),
      ),
  },
  {
    name: "list_leases",
    description:
      "List the leases on the properties the token owner can access, including each lease's tenant ids. Results are limited to accessible properties.",
    inputSchema: {},
    handler: async (_args, api) => textResult(await api.get("/leases", "list_leases")),
  },
  {
    name: "list_tenants",
    description:
      "List the tenants reachable through the token owner's accessible leases, including their bank accounts. Results are limited to accessible tenants.",
    inputSchema: {},
    handler: async (_args, api) => textResult(await api.get("/tenants", "list_tenants")),
  },
  {
    name: "payment_overview",
    description:
      "Get the current-month payment dashboard for the token owner's accessible properties: cash flow, overdue rent and warranty state. Results are limited to accessible properties.",
    inputSchema: {},
    handler: async (_args, api) =>
      textResult(await api.get("/payments/dashboard", "payment_overview")),
  },
  {
    name: "lease_ledger",
    description:
      "Get the ledger for one lease (lease id): its periods, recorded payments and allocations. Optionally limit to the most recent months. Access is limited to leases on accessible properties.",
    inputSchema: {
      leaseId: z.string().min(1),
      months: z.number().int().min(0).max(120).optional(),
    },
    handler: async (args, api) =>
      textResult(
        await api.get(`/ledger/${encodeURIComponent(args.leaseId)}`, "lease_ledger", {
          months: args.months,
        }),
      ),
  },
  {
    name: "indexation_status",
    description:
      "Calculate the indexation status for one lease (lease id): whether rent can be indexed and the computed new rent. Accountant-scoped tokens are blocked from indexation by the API.",
    inputSchema: { leaseId: z.string().min(1) },
    handler: async (args, api) =>
      textResult(
        await api.get(
          `/indexation/calculate/${encodeURIComponent(args.leaseId)}`,
          "indexation_status",
        ),
      ),
  },
];

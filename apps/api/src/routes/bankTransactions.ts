/**
 * Bank transactions viewer + reconciliation — global router.
 *
 * Mounted at /api/v1/bank-transactions by index.ts. Provides the cross-connection
 * reconciliation surface plus the manual fallback actions that complement the
 * automatic transactionMatcher:
 *
 *   GET  /                          list every owned statement (all connections)
 *   POST /:statementId/assign       mark a lease's oldest pending payment paid
 *   POST /:statementId/approve      auto-derive payment from structured comm
 *   POST /:statementId/ignore       set match_status='ignored'
 *   POST /:statementId/undo         revert a matched/ignored statement
 *
 * Ownership is enforced on every endpoint via getOwnedStatement (statement's
 * parent bank_connections.owner_id === userId) and, for assign, an explicit
 * lease.ownerId === userId check. Only credits (amount > 0) may be assigned or
 * approved; debits are read-only. The automatic matcher behaviour is untouched.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import {
  getDb,
  bankConnections,
  bankStatements,
  payments,
  leases,
} from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  buildTransactionRows,
  getOwnedStatement,
  type StatementRow,
  type ConnectionSummary,
  type TransactionRow,
} from "../lib/bankTransactionView";

export const bankTransactionsRouter = new Hono();

type Db = ReturnType<typeof getDb>;

const statusQuerySchema = z.object({
  status: z
    .enum(["all", "unmatched", "matched", "ignored", "mismatched_amount"])
    .optional()
    .default("all"),
});

const assignBodySchema = z.object({
  leaseId: z.string().min(1),
});

/**
 * Rebuild the single updated row (global shape, connection attached) after a
 * mutation so the client can patch its table without a full refetch.
 */
async function updatedRowResponse(
  db: Db,
  statementId: string,
  userId: string,
): Promise<TransactionRow | null> {
  const owned = await getOwnedStatement(db, statementId, userId);
  if (!owned) return null;
  const connectionMap = new Map<string, ConnectionSummary>([
    [owned.connection.id, owned.connection],
  ]);
  const [row] = await buildTransactionRows(db, [owned.statement], {
    connectionMap,
  });
  return row ?? null;
}

/**
 * Shared write for assign + approve: mark the payment paid (dated to the bank
 * booking date) and link the statement to it.
 */
async function markPaidAndLink(
  db: Db,
  statement: StatementRow,
  payment: { id: string; notes: string | null },
  note: string,
): Promise<void> {
  const combinedNotes = payment.notes ? `${payment.notes}\n${note}` : note;
  const paidDate = statement.bookingDate
    ? new Date(statement.bookingDate)
    : new Date();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .update(payments)
    .set({
      status: "paid",
      paidDate,
      notes: combinedNotes,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, payment.id));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .update(bankStatements)
    .set({
      matchStatus: "matched",
      matchedPaymentId: payment.id,
      matchedAt: new Date(),
    })
    .where(eq(bankStatements.id, statement.id));
}

// ===========================================================================
// GET / — global list across all the owner's connections.
// ===========================================================================
bankTransactionsRouter.get(
  "/",
  zValidator("query", statusQuerySchema),
  async (c) => {
    try {
      const userId = getRequiredUserId(c);
      const { status } = c.req.valid("query");
      const db = getDb();

      const conns = await db
        .select({
          id: bankConnections.id,
          institutionName: bankConnections.institutionName,
          iban: bankConnections.iban,
        })
        .from(bankConnections)
        .where(eq(bankConnections.ownerId, userId));

      if (conns.length === 0) return c.json({ data: [] });

      const connectionMap = new Map<string, ConnectionSummary>(
        conns.map((cn) => [cn.id, cn]),
      );
      const connectionIds = conns.map((cn) => cn.id);

      const whereClause =
        status === "all"
          ? inArray(bankStatements.connectionId, connectionIds)
          : and(
              inArray(bankStatements.connectionId, connectionIds),
              eq(bankStatements.matchStatus, status),
            );

      const rows = (await db
        .select()
        .from(bankStatements)
        .where(whereClause)
        .orderBy(desc(bankStatements.bookingDate))) as StatementRow[];

      const data = await buildTransactionRows(db, rows, { connectionMap });
      return c.json({ data });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[BankTransactions] GET / error:", err);
      return c.json({ error: message }, 500);
    }
  },
);

// ===========================================================================
// POST /:statementId/assign — mark a lease's oldest pending payment paid.
// ===========================================================================
bankTransactionsRouter.post(
  "/:statementId/assign",
  zValidator("json", assignBodySchema),
  async (c) => {
    try {
      const userId = getRequiredUserId(c);
      const statementId = c.req.param("statementId");
      const { leaseId } = c.req.valid("json");
      const db = getDb();

      const owned = await getOwnedStatement(db, statementId, userId);
      if (!owned) return c.json({ error: "Transaction not found" }, 404);
      const { statement } = owned;

      // Only credits (incoming money) can be assigned to a payment.
      if (Number(statement.amount) <= 0) {
        return c.json({ error: "Only credit transactions can be assigned" }, 400);
      }

      // Verify the target lease belongs to the caller.
      const leaseRows = await db
        .select({ id: leases.id })
        .from(leases)
        .where(and(eq(leases.id, leaseId), eq(leases.ownerId, userId)))
        .limit(1);
      if (!leaseRows[0]) return c.json({ error: "Lease not found" }, 404);

      // Choose the OLDEST pending payment for the lease.
      const pending = await db
        .select({
          id: payments.id,
          notes: payments.notes,
        })
        .from(payments)
        .where(and(eq(payments.leaseId, leaseId), eq(payments.status, "pending")))
        .orderBy(asc(payments.dueDate))
        .limit(1);

      if (!pending[0]) {
        return c.json({ error: "No pending payment for lease" }, 409);
      }

      const note = `Manually assigned from bank transfer ${statement.externalTransactionId}`;
      await markPaidAndLink(db, statement, pending[0], note);

      console.log(
        `[BankTransactions] Assigned statement ${statementId} -> payment ${pending[0].id} (lease ${leaseId})`,
      );

      const row = await updatedRowResponse(db, statementId, userId);
      return c.json({ data: row });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[BankTransactions] POST /:statementId/assign error:", err);
      return c.json({ error: message }, 500);
    }
  },
);

// ===========================================================================
// POST /:statementId/approve — auto-derive the payment from the statement's
// structured communication (reusing the matcher's digits logic).
// ===========================================================================
bankTransactionsRouter.post("/:statementId/approve", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const statementId = c.req.param("statementId");
    const db = getDb();

    const owned = await getOwnedStatement(db, statementId, userId);
    if (!owned) return c.json({ error: "Transaction not found" }, 404);
    const { statement } = owned;

    if (Number(statement.amount) <= 0) {
      return c.json({ error: "Only credit transactions can be approved" }, 400);
    }

    // Normalize the statement's structured communication to digits (matches
    // transactionMatcher.ts). The importer already stores digits-only, but we
    // re-normalize defensively.
    const txDigits = (statement.structuredCommunication ?? "").replace(
      /[^0-9]/g,
      "",
    );
    if (txDigits.length < 12) {
      return c.json(
        {
          error:
            "No structured communication to match. Use Assign to link a lease manually.",
        },
        409,
      );
    }

    // Candidate = an owned pending payment whose structured communication digits
    // equal the statement's.
    const pending = await db
      .select({
        id: payments.id,
        notes: payments.notes,
        structuredCommunication: payments.structuredCommunication,
      })
      .from(payments)
      .innerJoin(leases, eq(payments.leaseId, leases.id))
      .where(and(eq(leases.ownerId, userId), eq(payments.status, "pending")));

    const candidate = pending.find(
      (p) =>
        p.structuredCommunication &&
        p.structuredCommunication.replace(/[^0-9]/g, "") === txDigits,
    );

    if (!candidate) {
      return c.json(
        {
          error:
            "No matching pending payment found. Use Assign to link a lease manually.",
        },
        409,
      );
    }

    const note = `Manually approved from bank transfer ${statement.externalTransactionId}`;
    await markPaidAndLink(db, statement, candidate, note);

    console.log(
      `[BankTransactions] Approved statement ${statementId} -> payment ${candidate.id}`,
    );

    const row = await updatedRowResponse(db, statementId, userId);
    return c.json({ data: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[BankTransactions] POST /:statementId/approve error:", err);
    return c.json({ error: message }, 500);
  }
});

// ===========================================================================
// POST /:statementId/ignore — set match_status='ignored' (no payment change).
// ===========================================================================
bankTransactionsRouter.post("/:statementId/ignore", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const statementId = c.req.param("statementId");
    const db = getDb();

    const owned = await getOwnedStatement(db, statementId, userId);
    if (!owned) return c.json({ error: "Transaction not found" }, 404);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .update(bankStatements)
      .set({ matchStatus: "ignored" })
      .where(eq(bankStatements.id, statementId));

    console.log(`[BankTransactions] Ignored statement ${statementId}`);

    const row = await updatedRowResponse(db, statementId, userId);
    return c.json({ data: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[BankTransactions] POST /:statementId/ignore error:", err);
    return c.json({ error: message }, 500);
  }
});

// ===========================================================================
// POST /:statementId/undo — revert a matched or ignored statement.
//   matched  -> revert linked payment to pending (clear paidDate) + unmatch
//   ignored  -> just set match_status back to 'unmatched'
// ===========================================================================
bankTransactionsRouter.post("/:statementId/undo", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const statementId = c.req.param("statementId");
    const db = getDb();

    const owned = await getOwnedStatement(db, statementId, userId);
    if (!owned) return c.json({ error: "Transaction not found" }, 404);
    const { statement } = owned;

    if (statement.matchStatus === "matched" && statement.matchedPaymentId) {
      // Revert the linked payment back to pending.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .update(payments)
        .set({
          status: "pending",
          paidDate: null,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, statement.matchedPaymentId));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .update(bankStatements)
        .set({
          matchStatus: "unmatched",
          matchedPaymentId: null,
          matchedAt: null,
        })
        .where(eq(bankStatements.id, statementId));

      console.log(
        `[BankTransactions] Undid match: statement ${statementId}, payment ${statement.matchedPaymentId} reverted to pending`,
      );
    } else if (statement.matchStatus === "ignored") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .update(bankStatements)
        .set({ matchStatus: "unmatched" })
        .where(eq(bankStatements.id, statementId));

      console.log(`[BankTransactions] Undid ignore: statement ${statementId}`);
    } else {
      return c.json({ error: "Nothing to undo for this transaction" }, 400);
    }

    const row = await updatedRowResponse(db, statementId, userId);
    return c.json({ data: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[BankTransactions] POST /:statementId/undo error:", err);
    return c.json({ error: message }, 500);
  }
});

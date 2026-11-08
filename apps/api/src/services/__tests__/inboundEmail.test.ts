/**
 * Tenant replies on the contract reply address: filed on the contract,
 * passed on to the managers with Reply-To the tenant, never passed on for
 * auto-replies, deduplicated on Message-ID, and sent to the fallback address
 * when the token does not route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@rentular/db", () => ({ getDb: () => null }));

import { processInboundEmail, forwardSubject, type InboundDeps, type InboundRow } from "../inboundEmail";
import type { EmailOptions } from "../../lib/email";

const TOKEN = "abcdefghijklmnopqrst";
const LEASE = "lease-1";
const COMM = "a1b2c3d4-1111-4222-8333-444455556666";

function mail(opts: {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  messageId?: string;
  inReplyTo?: string;
  extra?: string[];
}): Buffer {
  return Buffer.from(
    [
      `From: ${opts.from ?? "Jan Peeters <jan@tenant.be>"}`,
      `To: ${opts.to ?? `reply+${TOKEN}@rentular.com`}`,
      `Subject: ${opts.subject ?? "Re: Herinnering huur november"}`,
      ...(opts.messageId === "" ? [] : [`Message-ID: ${opts.messageId ?? "<m1@tenant.be>"}`]),
      ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
      ...(opts.extra ?? []),
      "Content-Type: text/plain; charset=utf-8",
      "",
      opts.body ?? "Ik heb gisteren betaald.\n\nOp za 7 nov 2026 schreef Rentular <noreply@rentular.com>:\n> Beste Jan",
      "",
    ].join("\r\n"),
  );
}

function makeDeps(over: Partial<InboundDeps> = {}) {
  const inserted: InboundRow[] = [];
  const forwards: Array<{ options: EmailOptions; log: { ownerId: string; leaseId: string; metadata: Record<string, unknown> } }> = [];
  const plain: EmailOptions[] = [];
  const seenMessageIds = new Set<string>();
  const deps: InboundDeps = {
    resolveToken: vi.fn(async (t: string) => (t === TOKEN ? LEASE : null)),
    loadLease: vi.fn(async (id: string) =>
      id === LEASE
        ? { id, ownerId: "owner-1", propertyId: "prop-1", propertyName: "Tervuursestraat 12", ownerEmail: "owner@x.be", ownerLocale: "nl" }
        : null,
    ),
    tenantEmails: vi.fn(async () => ["jan@tenant.be", "co@tenant.be"]),
    hasMessageId: vi.fn(async (_l: string, id: string) => seenMessageIds.has(id)),
    findCommunication: vi.fn(async (_l: string, by: { tag: string | null; ids: string[] }) =>
      by.tag === COMM.slice(0, 8) || by.ids.includes(COMM)
        ? { id: COMM, recipientEmail: "jan@tenant.be", cc: ["lawyer@law.be"] }
        : null,
    ),
    insertInbound: vi.fn(async (row: InboundRow) => {
      inserted.push(row);
      if (typeof row.metadata.messageId === "string") seenMessageIds.add(row.metadata.messageId);
      return `inbound-${inserted.length}`;
    }),
    managers: vi.fn(async () => ({ to: "manager@x.be", cc: "owner@x.be" })),
    sendForward: vi.fn(async (options, log) => {
      forwards.push({ options, log });
    }),
    sendPlain: vi.fn(async (options) => {
      plain.push(options);
    }),
    webUrl: "https://rentular.com",
    fallbackTo: "admin@rentular.com",
    domain: "rentular.com",
    ...over,
  };
  return { deps, inserted, forwards, plain };
}

describe("processInboundEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("files a known tenant's reply and forwards it to the managers with Reply-To the tenant", async () => {
    const { deps, inserted, forwards } = makeDeps();
    const res = await processInboundEmail(mail({}), { to: `reply+${TOKEN}@rentular.com` }, deps);
    expect(res).toMatchObject({ status: 200, outcome: "stored", forwarded: true });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      ownerId: "owner-1",
      leaseId: LEASE,
      senderName: "Jan Peeters",
      senderEmail: "jan@tenant.be",
      subject: "Re: Herinnering huur november",
      body: "Ik heb gisteren betaald.",
    });
    expect(inserted[0].metadata).toMatchObject({ senderKnown: true, messageId: "<m1@tenant.be>" });
    expect(inserted[0].metadata.fullText).toContain("Beste Jan");
    expect(inserted[0].metadata.auto).toBeUndefined();

    expect(forwards).toHaveLength(1);
    const f = forwards[0];
    expect(f.options.to).toBe("manager@x.be");
    expect(f.options.cc).toBe("owner@x.be");
    expect(f.options.replyTo).toBe('"Jan Peeters" <jan@tenant.be>');
    expect(f.options.subject).toBe("[Tervuursestraat 12] Re: Herinnering huur november");
    expect(f.options.body).toContain("Jan Peeters <jan@tenant.be> heeft geantwoord over het contract voor Tervuursestraat 12.");
    expect(f.options.body).toContain("https://rentular.com/leases/lease-1");
    expect(f.options.body).not.toContain("Let op");
    expect(f.options.body).toContain("Ik heb gisteren betaald.");
    expect(f.log.metadata).toMatchObject({ kind: "tenant_reply_forward", inboundId: "inbound-1" });
  });

  it("an unknown sender is filed with senderKnown false and forwarded with a warning", async () => {
    const { deps, inserted, forwards } = makeDeps();
    await processInboundEmail(mail({ from: "Advocaat <someone@else.be>" }), { to: `reply+${TOKEN}@rentular.com` }, deps);
    expect(inserted[0].metadata.senderKnown).toBe(false);
    expect(forwards[0].options.body).toContain("Let op: dit adres hoort niet bij een huurder van dit contract.");
  });

  it("someone copied on the original message counts as known", async () => {
    const { deps, inserted } = makeDeps();
    await processInboundEmail(
      mail({ from: "lawyer@law.be", inReplyTo: `<${COMM}@rentular.com>` }),
      { to: `reply+${TOKEN}@rentular.com` },
      deps,
    );
    expect(inserted[0].metadata).toMatchObject({ senderKnown: true, matchedCommunicationId: COMM });
  });

  it("an auto-reply is filed but not forwarded", async () => {
    const { deps, inserted, forwards } = makeDeps();
    const res = await processInboundEmail(
      mail({ extra: ["Auto-Submitted: auto-replied"], subject: "Afwezig" }),
      { to: `reply+${TOKEN}@rentular.com` },
      deps,
    );
    expect(res).toMatchObject({ outcome: "stored_auto", forwarded: false });
    expect(inserted[0].metadata.auto).toBe(true);
    expect(forwards).toHaveLength(0);
  });

  it("a bounce from MAILER-DAEMON is filed but not forwarded", async () => {
    const { deps, forwards } = makeDeps();
    const res = await processInboundEmail(mail({ from: "MAILER-DAEMON@mx.tenant.be" }), { to: `reply+${TOKEN}@rentular.com` }, deps);
    expect(res.outcome).toBe("stored_auto");
    expect(forwards).toHaveLength(0);
  });

  it("a duplicate Message-ID on the same lease is ignored", async () => {
    const { deps, inserted, forwards } = makeDeps();
    await processInboundEmail(mail({}), { to: `reply+${TOKEN}@rentular.com` }, deps);
    const again = await processInboundEmail(mail({}), { to: `reply+${TOKEN}@rentular.com` }, deps);
    expect(again).toEqual({ status: 200, outcome: "duplicate" });
    expect(inserted).toHaveLength(1);
    expect(forwards).toHaveLength(1);
  });

  it("an unknown token goes to the fallback address and is not filed", async () => {
    const { deps, inserted, forwards, plain } = makeDeps();
    const res = await processInboundEmail(
      mail({ to: "reply+zzzzzzzzzzzzzzzzzzzz@rentular.com" }),
      { to: "reply+zzzzzzzzzzzzzzzzzzzz@rentular.com" },
      deps,
    );
    expect(res).toEqual({ status: 200, outcome: "fallback" });
    expect(inserted).toHaveLength(0);
    expect(forwards).toHaveLength(0);
    expect(plain[0].to).toBe("admin@rentular.com");
    expect(plain[0].attachments?.[0]).toMatchObject({ filename: "original.eml", contentType: "message/rfc822" });
  });

  it("links the reply to the message it answers, by In-Reply-To or by the address tag", async () => {
    const byHeader = makeDeps();
    await processInboundEmail(mail({ inReplyTo: `<${COMM}@rentular.com>` }), { to: `reply+${TOKEN}@rentular.com` }, byHeader.deps);
    expect(byHeader.inserted[0].metadata.matchedCommunicationId).toBe(COMM);

    const byTag = makeDeps();
    const to = `reply+${TOKEN}.${COMM.slice(0, 8)}@rentular.com`;
    await processInboundEmail(mail({ to }), { to }, byTag.deps);
    expect(byTag.inserted[0].metadata.matchedCommunicationId).toBe(COMM);
  });

  it("finds the token in the To header when the envelope recipient is missing", async () => {
    const { deps, inserted } = makeDeps();
    await processInboundEmail(mail({}), {}, deps);
    expect(inserted).toHaveLength(1);
  });

  it("a failed forward answers 502 so the worker falls back", async () => {
    const { deps, inserted } = makeDeps({ sendForward: vi.fn().mockRejectedValue(new Error("SMTP down")) });
    const res = await processInboundEmail(mail({}), { to: `reply+${TOKEN}@rentular.com` }, deps);
    expect(res).toMatchObject({ status: 502, outcome: "forward_failed" });
    expect(inserted).toHaveLength(1);
  });

  it("forwards attachments up to the cap and lists the rest", async () => {
    const { deps, forwards, inserted } = makeDeps();
    const big = Buffer.alloc(6 * 1024 * 1024, 1).toString("base64");
    const raw = Buffer.from(
      [
        "From: jan@tenant.be",
        `To: reply+${TOKEN}@rentular.com`,
        "Subject: bewijs",
        "Message-ID: <att@tenant.be>",
        'Content-Type: multipart/mixed; boundary="b"',
        "",
        "--b",
        "Content-Type: text/plain",
        "",
        "Zie bijlagen",
        "--b",
        "Content-Type: application/pdf",
        'Content-Disposition: attachment; filename="a.pdf"',
        "Content-Transfer-Encoding: base64",
        "",
        big,
        "--b",
        "Content-Type: application/pdf",
        'Content-Disposition: attachment; filename="b.pdf"',
        "Content-Transfer-Encoding: base64",
        "",
        big,
        "--b--",
        "",
      ].join("\r\n"),
    );
    await processInboundEmail(raw, { to: `reply+${TOKEN}@rentular.com` }, deps);
    expect(inserted[0].metadata.attachments).toEqual([
      { name: "a.pdf", size: 6 * 1024 * 1024, type: "application/pdf" },
      { name: "b.pdf", size: 6 * 1024 * 1024, type: "application/pdf" },
    ]);
    expect(forwards[0].options.attachments?.map((a) => a.filename)).toEqual(["a.pdf"]);
    expect(forwards[0].options.body).toContain("Niet bijgevoegd, te groot (zit nog bij het oorspronkelijke bericht): b.pdf");
  });
});

describe("forwardSubject", () => {
  it("adds Re: and the property name only when missing", () => {
    expect(forwardSubject("Herinnering", "Carnotstraat 3")).toBe("[Carnotstraat 3] Re: Herinnering");
    expect(forwardSubject("AW: Herinnering Carnotstraat 3", "Carnotstraat 3")).toBe("AW: Herinnering Carnotstraat 3");
    expect(forwardSubject("", "X")).toBe("[X] Re: (no subject)");
  });
});

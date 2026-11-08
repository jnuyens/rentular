import { describe, it, expect } from "vitest";
import { parseMail, parseAddressList, decodeWords, htmlToText, trimQuotedReply, parseParams } from "../mimeParse";

const CRLF = "\r\n";

describe("parseMail", () => {
  it("reads a plain reply with encoded headers", () => {
    const raw = [
      "From: =?UTF-8?Q?Ren=C3=A9e_Dupont?= <Renee@Example.be>",
      "To: reply+abcdefghijklmnopqrst@rentular.com",
      "Subject: =?utf-8?B?UmU6IEhlcmlubmVyaW5n?= =?utf-8?Q?_huur_n=C3=B3v?=",
      "Message-ID: <abc@mail.example.be>",
      "In-Reply-To: <11111111-2222-4333-8444-555555555555@rentular.com>",
      "References: <x@y> <11111111-2222-4333-8444-555555555555@rentular.com>",
      "Date: Sat, 07 Nov 2026 10:00:00 +0100",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Ik heb betaald, sorry voor de vertraging. Groetjes, Ren=C3=A9e",
      "",
    ].join(CRLF);
    const m = parseMail(Buffer.from(raw));
    expect(m.from).toEqual({ name: "Renée Dupont", address: "renee@example.be" });
    expect(m.to[0].address).toBe("reply+abcdefghijklmnopqrst@rentular.com");
    expect(m.subject).toBe("Re: Herinnering huur nóv");
    expect(m.messageId).toBe("<abc@mail.example.be>");
    expect(m.inReplyTo).toBe("<11111111-2222-4333-8444-555555555555@rentular.com>");
    expect(m.references).toHaveLength(2);
    expect(m.text).toContain("Renée");
    expect(m.date?.toISOString()).toBe("2026-11-07T09:00:00.000Z");
  });

  it("walks multipart alternative and attachments", () => {
    const pdf = Buffer.from("%PDF-1.4 fake").toString("base64");
    const raw = [
      "From: a@b.be",
      "Subject: proof",
      'Content-Type: multipart/mixed; boundary="outer"',
      "",
      "--outer",
      'Content-Type: multipart/alternative; boundary="inner"',
      "",
      "--inner",
      "Content-Type: text/plain; charset=iso-8859-1",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Betalingsbewijs in bijlage, caf=E9",
      "--inner",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Betalingsbewijs</p>",
      "--inner--",
      "--outer",
      "Content-Type: application/pdf",
      "Content-Disposition: attachment; filename*=UTF-8''bewijs%20n%C2%B01.pdf",
      "Content-Transfer-Encoding: base64",
      "",
      pdf,
      "--outer--",
      "",
    ].join(CRLF);
    const m = parseMail(Buffer.from(raw));
    expect(m.text).toBe("Betalingsbewijs in bijlage, café");
    expect(m.html).toBe("<p>Betalingsbewijs</p>");
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]).toMatchObject({ filename: "bewijs n°1.pdf", contentType: "application/pdf", size: 13 });
    expect(m.attachments[0].content.toString()).toBe("%PDF-1.4 fake");
  });
});

describe("helpers", () => {
  it("parses address lists with quotes, commas and groups", () => {
    expect(parseAddressList('"Doe, Jan" <jan@x.be>, piet@y.be (Piet), Team: a@z.be, b@z.be;')).toEqual([
      { name: "Doe, Jan", address: "jan@x.be" },
      { name: "Piet", address: "piet@y.be" },
      { name: "", address: "a@z.be" },
      { name: "", address: "b@z.be" },
    ]);
    expect(parseAddressList("<>")).toEqual([]);
  });

  it("decodes encoded words and params", () => {
    expect(decodeWords("=?ISO-8859-1?Q?Andr=E9?= Smit")).toBe("André Smit");
    expect(parseParams('text/plain; charset="UTF-8"; format=flowed')).toEqual({
      value: "text/plain",
      params: { charset: "UTF-8", format: "flowed" },
    });
  });

  it("turns html into text", () => {
    expect(htmlToText("<style>x{}</style><p>Hallo&nbsp;daar</p><p>Tot&#33; &amp; dag<br>Jan</p>")).toBe(
      "Hallo daar\nTot! & dag\nJan",
    );
  });

  it("trims quoted history in four languages", () => {
    for (const marker of [
      "On Sat, 7 Nov 2026 at 10:00, Rentular <noreply@rentular.com> wrote:",
      "Op za 7 nov 2026 om 10:00 schreef Rentular <noreply@rentular.com>:",
      "Le sam. 7 nov. 2026 à 10:00, Rentular <noreply@rentular.com> a écrit :",
      "Am Sa., 7. Nov. 2026 um 10:00 Uhr schrieb Rentular <noreply@rentular.com>:",
    ]) {
      const out = trimQuotedReply(`Ik betaal morgen.\n\n${marker}\n> Herinnering`);
      expect(out).toEqual({ text: "Ik betaal morgen.", trimmed: true });
    }
    expect(trimQuotedReply("Alleen tekst")).toEqual({ text: "Alleen tekst", trimmed: false });
    expect(trimQuotedReply("Ja\n> oud\n> ouder")).toEqual({ text: "Ja", trimmed: true });
  });
});

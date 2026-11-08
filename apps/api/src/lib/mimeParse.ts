/**
 * Small MIME parser for inbound replies. It reads the headers we route on
 * (From, To, Cc, Subject, Message-ID, In-Reply-To, References, auto-reply
 * markers), the first text and html body parts, and the attachments. It
 * handles multipart nesting, base64 and quoted-printable, RFC 2047 encoded
 * words, RFC 2231 file names and the common charsets.
 *
 * Kept in-house rather than adding a parser dependency: the API only needs
 * enough to file a reply and pass it on, the raw message is forwarded as is
 * when anything is off.
 */

export interface MailAddress {
  name: string;
  address: string;
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
}

export interface ParsedMail {
  headers: Map<string, string[]>;
  header(name: string): string | undefined;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  replyTo: MailAddress[];
  subject: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  date: Date | null;
  text: string | null;
  html: string | null;
  attachments: MailAttachment[];
}

interface Part {
  headers: Map<string, string[]>;
  body: string; // latin1, one char per byte
}

function splitHeadBody(raw: string): { head: string; body: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  if (!m) return { head: raw, body: "" };
  return { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

/** Header bytes are read as latin1; raw UTF-8 in headers is restored here. */
function fixEightBit(s: string): string {
  if (!/[\x80-\xff]/.test(s)) return s;
  const buf = Buffer.from(s, "latin1");
  const utf8 = buf.toString("utf8");
  return utf8.includes("�") ? s : utf8;
}

function parseHeaders(head: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = fixEightBit(line.slice(i + 1).trim());
    const list = out.get(key) ?? [];
    list.push(value);
    out.set(key, list);
  }
  return out;
}

function first(headers: Map<string, string[]>, name: string): string | undefined {
  return headers.get(name.toLowerCase())?.[0];
}

export function decodeCharset(buf: Buffer, charset: string | undefined): string {
  const cs = (charset || "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
  if (cs === "us-ascii" || cs === "ascii") return buf.toString("latin1");
  try {
    return new TextDecoder(cs, { fatal: false }).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

function decodeQuotedPrintableBytes(s: string, header = false): Buffer {
  const src = header ? s.replace(/_/g, " ") : s.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "=" && /^[0-9a-fA-F]{2}$/.test(src.slice(i + 1, i + 3))) {
      bytes.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(src.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** Decode RFC 2047 encoded words; whitespace between two encoded words is dropped. */
export function decodeWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?[^?]+\?[bBqQ]\?[^?]*\?=)/g, "$1")
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([bBqQ])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) => {
      const buf = enc.toUpperCase() === "B" ? Buffer.from(text, "base64") : decodeQuotedPrintableBytes(text, true);
      return decodeCharset(buf, charset);
    });
}

/** Split a structured header value ("type; a=b; c=\"d\"") into its value and params. */
export function parseParams(value: string | undefined): { value: string; params: Record<string, string> } {
  if (!value) return { value: "", params: {} };
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (ch === ";" && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  const continued: Record<string, string[]> = {};
  for (const p of parts.slice(1)) {
    const i = p.indexOf("=");
    if (i <= 0) continue;
    const key = p.slice(0, i).trim().toLowerCase();
    let v = p.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, "$1");
    const m = /^([^*]+)\*(\d+)?(\*)?$/.exec(key);
    if (m) {
      // RFC 2231: name*=charset''value, name*0*=..., name*1*=...
      const name = m[1];
      const idx = m[2] ? Number(m[2]) : 0;
      (continued[name] ??= [])[idx] = v;
    } else params[key] = v;
  }
  for (const [name, chunks] of Object.entries(continued)) {
    const joined = chunks.join("");
    const m = /^([^']*)'[^']*'(.*)$/.exec(joined);
    if (m) {
      const bytes = Buffer.from(m[2].replace(/%([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
      params[name] = decodeCharset(bytes, m[1] || "utf-8");
    } else params[name] = joined;
  }
  return { value: parts[0].trim().toLowerCase(), params };
}

/** Parse an address list header. Display names are decoded, groups flattened. */
export function parseAddressList(value: string | undefined): MailAddress[] {
  if (!value) return [];
  const items: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = 0;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle++;
    else if (!quoted && ch === ">") angle = Math.max(0, angle - 1);
    if ((ch === "," || ch === ";") && !quoted && angle === 0) {
      items.push(cur);
      cur = "";
    } else cur += ch;
  }
  items.push(cur);
  const out: MailAddress[] = [];
  for (let item of items) {
    item = item.trim();
    // "Group name: a@b, c@d;" lists the group name before the first address.
    const group = /^[^"<@:]*:\s*(.*)$/.exec(item);
    if (group) item = group[1].trim();
    if (!item) continue;
    const m = /^(.*)<([^>]*)>\s*(?:\(.*\))?$/.exec(item);
    let name = "";
    let address = "";
    if (m) {
      name = m[1].trim();
      address = m[2].trim();
    } else {
      const c = /^([^\s(]+)\s*(?:\((.*)\))?$/.exec(item);
      address = c ? c[1] : item;
      name = c?.[2] ?? "";
    }
    name = decodeWords(name.replace(/^"|"$/g, "").replace(/\\(.)/g, "$1")).trim();
    if (!address.includes("@")) continue;
    out.push({ name, address: address.toLowerCase() });
  }
  return out;
}

function decodeBody(part: Part): Buffer {
  const enc = (first(part.headers, "content-transfer-encoding") || "7bit").trim().toLowerCase();
  if (enc === "base64") return Buffer.from(part.body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (enc === "quoted-printable") return decodeQuotedPrintableBytes(part.body);
  return Buffer.from(part.body, "latin1");
}

function splitMultipart(body: string, boundary: string): string[] {
  const parts: string[] = [];
  const delim = `--${boundary}`;
  const lines = body.split(/\r?\n/);
  let cur: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith(delim)) {
      const rest = line.slice(delim.length);
      if (cur) parts.push(cur.join("\r\n"));
      if (rest.startsWith("--")) return parts;
      cur = [];
    } else if (cur) cur.push(line);
  }
  if (cur && cur.length) parts.push(cur.join("\r\n"));
  return parts;
}

function walk(part: Part, out: { text: string | null; html: string | null; attachments: MailAttachment[] }, depth: number): void {
  const ct = parseParams(first(part.headers, "content-type") || "text/plain");
  const disp = parseParams(first(part.headers, "content-disposition"));
  const type = ct.value || "text/plain";
  if (type.startsWith("multipart/") && ct.params.boundary && depth < 10) {
    for (const raw of splitMultipart(part.body, ct.params.boundary)) {
      const { head, body } = splitHeadBody(raw);
      walk({ headers: parseHeaders(head), body }, out, depth + 1);
    }
    return;
  }
  const filename = decodeWords(disp.params.filename || ct.params.name || "");
  const isAttachment = disp.value === "attachment" || (!!filename && !type.startsWith("text/")) || type === "message/rfc822";
  const content = decodeBody(part);
  if (!isAttachment && type === "text/plain" && out.text == null) {
    out.text = decodeCharset(content, ct.params.charset);
    return;
  }
  if (!isAttachment && type === "text/html" && out.html == null) {
    out.html = decodeCharset(content, ct.params.charset);
    return;
  }
  if (!isAttachment && type.startsWith("text/")) return;
  out.attachments.push({
    filename: filename || (type === "message/rfc822" ? "message.eml" : "attachment"),
    contentType: type,
    size: content.length,
    content,
  });
}

function msgId(v: string | undefined): string | null {
  if (!v) return null;
  const m = /<[^<>\s]+>/.exec(v);
  return m ? m[0] : v.trim() || null;
}

export function parseMail(raw: Buffer | string): ParsedMail {
  const src = typeof raw === "string" ? Buffer.from(raw, "utf8").toString("latin1") : raw.toString("latin1");
  const { head, body } = splitHeadBody(src);
  const headers = parseHeaders(head);
  const acc = { text: null as string | null, html: null as string | null, attachments: [] as MailAttachment[] };
  walk({ headers, body }, acc, 0);
  const dateRaw = first(headers, "date");
  const date = dateRaw ? new Date(dateRaw) : null;
  return {
    headers,
    header: (name: string) => first(headers, name),
    from: parseAddressList(first(headers, "from"))[0] ?? null,
    to: parseAddressList((headers.get("to") ?? []).join(", ")),
    cc: parseAddressList((headers.get("cc") ?? []).join(", ")),
    replyTo: parseAddressList(first(headers, "reply-to")),
    subject: decodeWords(first(headers, "subject") || "").trim(),
    messageId: msgId(first(headers, "message-id")),
    inReplyTo: msgId(first(headers, "in-reply-to")),
    references: (first(headers, "references") || "").match(/<[^<>\s]+>/g) ?? [],
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    text: acc.text,
    html: acc.html,
    attachments: acc.attachments,
  };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Plain text from an html body, good enough to read a reply. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_MARKERS = [
  /^On .+wrote:\s*$/i,
  /^Op .+schreef .+:\s*$/i,
  /^Le .+a écrit\s*:\s*$/i,
  /^Am .+schrieb .+:\s*$/i,
  /^-{2,}\s*(Original Message|Oorspronkelijk bericht|Message d'origine|Ursprüngliche Nachricht)\s*-{2,}\s*$/i,
  /^(From|Van|De|Von):\s.+$/,
];

/**
 * Cut the quoted history off a reply. Returns the reply text and whether
 * anything was cut. Text before the first marker is kept as is.
 */
export function trimQuotedReply(text: string): { text: string; trimmed: boolean } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (QUOTE_MARKERS.some((re) => re.test(line))) {
      cut = i;
      break;
    }
    // A block of ">" lines running to the end is quoted history.
    if (line.startsWith(">") && lines.slice(i).every((l) => !l.trim() || l.trim().startsWith(">"))) {
      cut = i;
      break;
    }
  }
  if (cut <= 0) return { text: text.trim(), trimmed: false };
  const kept = lines.slice(0, cut).join("\n").trim();
  return kept ? { text: kept, trimmed: true } : { text: text.trim(), trimmed: false };
}

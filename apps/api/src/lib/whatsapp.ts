// WhatsApp sending via the self-hosted Baileys bridge (muncher), reached over
// Tailscale. Configured with:
//   WHATSAPP_BRIDGE_URL    e.g. http://100.113.206.22:3000/send
//   WHATSAPP_BRIDGE_TOKEN  bearer token the bridge expects
//   WHATSAPP_SIGNATURE     appended to each message (e.g. "Eliza Berger")
//   WHATSAPP_TIMEOUT_MS    request timeout (default 20000)

export interface WhatsAppOptions {
  to: string; // international number; the bridge strips non-digits
  body: string;
}

/** Whether a WhatsApp bridge is configured. */
export function isWhatsAppConfigured(): boolean {
  return !!(process.env.WHATSAPP_BRIDGE_URL && process.env.WHATSAPP_BRIDGE_TOKEN);
}

export async function sendWhatsApp(options: WhatsAppOptions): Promise<{ id: string }> {
  const url = process.env.WHATSAPP_BRIDGE_URL;
  const token = process.env.WHATSAPP_BRIDGE_TOKEN;
  if (!url || !token) throw new Error("WhatsApp bridge is not configured");

  const signature = process.env.WHATSAPP_SIGNATURE || "";
  const body =
    signature && !options.body.includes(signature)
      ? `${options.body}\n\n${signature}`
      : options.body;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Number(process.env.WHATSAPP_TIMEOUT_MS) || 20000,
  );
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: options.to, message: body }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(
      `WhatsApp bridge unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`WhatsApp send failed: ${res.status} ${t}`);
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: json.id || `wa-${Date.now()}` };
}

// SMS provider abstraction — supports multiple providers via SMS_PROVIDER env var
// Supported: twilio, messagebird, ovh, smsgateway (self-hosted phone/modem
// gateway, e.g. a Digi eSIM in an Android phone), console (dev/testing)

export interface SmsOptions {
  to: string;      // Phone number in E.164 format (+32...)
  body: string;
  from?: string;   // Sender ID or phone number
}

export interface SmsProvider {
  send(options: SmsOptions): Promise<{ messageId: string }>;
}

// --- Twilio ---
function createTwilioProvider(): SmsProvider {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const fromNumber = process.env.TWILIO_FROM_NUMBER!;

  return {
    async send(options: SmsOptions) {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const body = new URLSearchParams({
        To: options.to,
        From: options.from || fromNumber,
        Body: options.body,
      });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Twilio error: ${response.status} ${error}`);
      }

      const result = await response.json() as { sid: string };
      return { messageId: result.sid };
    },
  };
}

// --- MessageBird (Bird) ---
function createMessageBirdProvider(): SmsProvider {
  const apiKey = process.env.MESSAGEBIRD_API_KEY!;
  const originator = process.env.MESSAGEBIRD_ORIGINATOR || "Rentular";

  return {
    async send(options: SmsOptions) {
      const response = await fetch("https://rest.messagebird.com/messages", {
        method: "POST",
        headers: {
          Authorization: `AccessKey ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          originator: options.from || originator,
          recipients: [options.to],
          body: options.body,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`MessageBird error: ${response.status} ${error}`);
      }

      const result = await response.json() as { id: string };
      return { messageId: result.id };
    },
  };
}

// --- OVH SMS ---
function createOvhProvider(): SmsProvider {
  const appKey = process.env.OVH_APP_KEY!;
  const appSecret = process.env.OVH_APP_SECRET!;
  const consumerKey = process.env.OVH_CONSUMER_KEY!;
  const serviceName = process.env.OVH_SMS_SERVICE!;
  const sender = process.env.OVH_SMS_SENDER || "Rentular";

  return {
    async send(options: SmsOptions) {
      const url = `https://eu.api.ovh.com/1.0/sms/${serviceName}/jobs`;
      const timestamp = Math.round(Date.now() / 1000);
      const body = JSON.stringify({
        charset: "UTF-8",
        receivers: [options.to],
        message: options.body,
        sender: options.from || sender,
        noStopClause: true,
        priority: "high",
      });

      // OVH API signature
      const toSign = `${appSecret}+${consumerKey}+POST+${url}+${body}+${timestamp}`;
      const encoder = new TextEncoder();
      const data = encoder.encode(toSign);
      const hashBuffer = await crypto.subtle.digest("SHA-1", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const signature = "$1$" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ovh-Application": appKey,
          "X-Ovh-Consumer": consumerKey,
          "X-Ovh-Timestamp": timestamp.toString(),
          "X-Ovh-Signature": signature,
        },
        body,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OVH SMS error: ${response.status} ${error}`);
      }

      const result = await response.json() as { ids: number[] };
      return { messageId: result.ids?.[0]?.toString() || "unknown" };
    },
  };
}

// --- Self-hosted SMS gateway (phone or GSM modem holding a real SIM/eSIM) ---
//
// Sends the SMS by POSTing to a gateway app's HTTP API. Provider-agnostic: point
// it at whichever gateway you run (sms-gate.app / android-sms-gateway, httpSMS,
// SMSGate, Traccar, or any webhook) via env vars. This is how you'd send through
// a Digi eSIM sitting in a spare Android phone.
//
// Env:
//   SMS_GATEWAY_URL            (required) endpoint to POST to
//   SMS_GATEWAY_USERNAME / SMS_GATEWAY_PASSWORD   -> HTTP Basic auth, or
//   SMS_GATEWAY_API_KEY        -> sent in header SMS_GATEWAY_API_KEY_HEADER
//                                 (default "Authorization"), optionally prefixed
//                                 with SMS_GATEWAY_API_KEY_PREFIX (e.g. "Bearer ")
//   SMS_GATEWAY_FROM           optional sender number for templates that need it
//   SMS_GATEWAY_BODY_TEMPLATE  JSON body with {{to}} {{message}} {{from}}
//                              placeholders (values are JSON-escaped for you).
//                              Default matches sms-gate.app / android-sms-gateway.
//   SMS_GATEWAY_TIMEOUT_MS     request timeout (default 15000)
//
// Examples:
//   sms-gate.app (default): SMS_GATEWAY_URL=http://<phone-ip>:8080/message
//     SMS_GATEWAY_USERNAME=sms SMS_GATEWAY_PASSWORD=<pw>
//   httpSMS: SMS_GATEWAY_URL=https://api.httpsms.com/v1/messages/send
//     SMS_GATEWAY_API_KEY=<key> SMS_GATEWAY_API_KEY_HEADER=x-api-key
//     SMS_GATEWAY_FROM=+32... SMS_GATEWAY_BODY_TEMPLATE={"content":{{message}},"from":{{from}},"to":{{to}}}
function createSmsGatewayProvider(): SmsProvider {
  const url = process.env.SMS_GATEWAY_URL;
  if (!url) {
    throw new Error(
      "SMS_GATEWAY_URL is not set (required for SMS_PROVIDER=smsgateway)"
    );
  }
  const username = process.env.SMS_GATEWAY_USERNAME;
  const password = process.env.SMS_GATEWAY_PASSWORD;
  const apiKey = process.env.SMS_GATEWAY_API_KEY;
  const apiKeyHeader = process.env.SMS_GATEWAY_API_KEY_HEADER || "Authorization";
  const apiKeyPrefix = process.env.SMS_GATEWAY_API_KEY_PREFIX ?? "";
  const fromDefault = process.env.SMS_GATEWAY_FROM || "";
  const bodyTemplate =
    process.env.SMS_GATEWAY_BODY_TEMPLATE ||
    '{"message":{{message}},"phoneNumbers":[{{to}}]}';
  const timeoutMs = Number(process.env.SMS_GATEWAY_TIMEOUT_MS) || 15000;

  return {
    async send(options: SmsOptions) {
      const from = options.from || fromDefault;
      const body = bodyTemplate
        .replace(/\{\{\s*to\s*\}\}/g, JSON.stringify(options.to))
        .replace(/\{\{\s*message\s*\}\}/g, JSON.stringify(options.body))
        .replace(/\{\{\s*from\s*\}\}/g, JSON.stringify(from));

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (username !== undefined && password !== undefined) {
        headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      } else if (apiKey) {
        headers[apiKeyHeader] = `${apiKeyPrefix}${apiKey}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`SMS gateway unreachable: ${msg}`);
      }
      clearTimeout(timer);

      if (!response.ok) {
        const error = await response.text().catch(() => "");
        throw new Error(`SMS gateway error: ${response.status} ${error}`);
      }

      // Best-effort message id from common response shapes; not all gateways
      // return one, so fall back to a generated id on a 2xx response.
      let messageId = `gateway-${Date.now()}`;
      try {
        const json = (await response.json()) as Record<string, unknown>;
        const data = (json.data ?? json) as Record<string, unknown>;
        const candidate =
          data.id ??
          data.messageId ??
          data.message_id ??
          (Array.isArray((data as { messages?: unknown[] }).messages)
            ? ((data as { messages: Array<{ id?: unknown }> }).messages[0]?.id)
            : undefined);
        if (candidate != null) messageId = String(candidate);
      } catch {
        // Non-JSON body -> keep the generated id.
      }
      return { messageId };
    },
  };
}

// --- Console (dev/testing) ---
function createConsoleProvider(): SmsProvider {
  return {
    async send(options: SmsOptions) {
      const id = `console-${Date.now()}`;
      console.log(`[SMS:console] To: ${options.to} | Body: ${options.body}`);
      return { messageId: id };
    },
  };
}

// --- Factory ---
let provider: SmsProvider | null = null;

function getProvider(): SmsProvider {
  if (provider) return provider;

  const type = process.env.SMS_PROVIDER || "console";
  switch (type) {
    case "twilio":
      provider = createTwilioProvider();
      break;
    case "messagebird":
      provider = createMessageBirdProvider();
      break;
    case "ovh":
      provider = createOvhProvider();
      break;
    case "smsgateway":
      provider = createSmsGatewayProvider();
      break;
    case "console":
    default:
      provider = createConsoleProvider();
      break;
  }

  console.log(`[SMS] Using provider: ${type}`);
  return provider;
}

export async function sendSms(options: SmsOptions): Promise<{ messageId: string }> {
  return getProvider().send(options);
}

/** Whether a real SMS provider is configured (not the console/no-op default). */
export function isSmsConfigured(): boolean {
  const t = (process.env.SMS_PROVIDER || "").toLowerCase();
  return t !== "" && t !== "console";
}

// Normalize Belgian phone numbers to E.164 format
export function normalizePhoneNumber(phone: string): string {
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, "");
  // Belgian numbers: 04xx xxx xxx → +324xxxxxxxx
  if (cleaned.startsWith("0") && !cleaned.startsWith("00")) {
    return `+32${cleaned.slice(1)}`;
  }
  // Already international
  if (cleaned.startsWith("+")) {
    return cleaned;
  }
  // 00 prefix
  if (cleaned.startsWith("00")) {
    return `+${cleaned.slice(2)}`;
  }
  return cleaned;
}

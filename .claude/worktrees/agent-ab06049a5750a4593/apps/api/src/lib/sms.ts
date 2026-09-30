// SMS provider abstraction — supports multiple providers via SMS_PROVIDER env var
// Supported: twilio, messagebird, ovh, console (dev/testing)

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

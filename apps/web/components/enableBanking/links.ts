/** Public step by step guide for setting up Enable Banking. */
export const EB_TUTORIAL_PATH = "/help/enable-banking";

/** Anchor of one step in the public guide, the same in every language. */
export function ebTutorialHref(step: number): string {
  return `${EB_TUTORIAL_PATH}#step-${step}`;
}

export const EB_SIGNUP_URL = "https://enablebanking.com/";
export const EB_CONTROL_PANEL_URL = "https://enablebanking.com/cp/applications";

/** Enable Banking names the downloaded key after the application id. */
const PEM_NAME_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\s*\(\d+\))?\.pem$/i;

/** The application id in a key file name like "<uuid>.pem", or null. */
export function appIdFromFileName(name: string): string | null {
  const m = PEM_NAME_RE.exec(name.trim());
  return m ? m[1]!.toLowerCase() : null;
}

/** Last four characters of an IBAN, for display. */
export function maskIban(iban: string | null | undefined): string {
  if (!iban) return "";
  return `•••• ${iban.replace(/\s+/g, "").slice(-4)}`;
}

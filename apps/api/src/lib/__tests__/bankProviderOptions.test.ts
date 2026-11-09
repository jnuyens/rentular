import { describe, it, expect } from "vitest";
import {
  derivePlan,
  instanceEnableBankingEnv,
  resolveBankProviderOptions,
  resolveInstance,
} from "../bankProviderOptions";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe("resolveInstance", () => {
  it("reads RENTULAR_INSTANCE", () => {
    expect(resolveInstance(env({ RENTULAR_INSTANCE: "hosted" }))).toBe("hosted");
    expect(resolveInstance(env({ RENTULAR_INSTANCE: "self", WEB_URL: "https://www.rentular.com" }))).toBe("self");
  });
  it("treats rentular.com as hosted when unset, anything else as self-hosted", () => {
    expect(resolveInstance(env({ WEB_URL: "https://www.rentular.com" }))).toBe("hosted");
    expect(resolveInstance(env({ WEB_URL: "https://rent.example.org" }))).toBe("self");
    expect(resolveInstance(env({ WEB_URL: "https://notrentular.com" }))).toBe("self");
    expect(resolveInstance(env({}))).toBe("self");
  });
});

describe("derivePlan", () => {
  it("is free up to 3 properties, paid above", () => {
    expect(derivePlan({ plan: null, propertyCount: 0 })).toBe("free");
    expect(derivePlan({ plan: null, propertyCount: 3 })).toBe("free");
    expect(derivePlan({ plan: null, propertyCount: 4 })).toBe("paid");
  });
  it("uses the stored plan when set", () => {
    expect(derivePlan({ plan: "paid", propertyCount: 1 })).toBe("paid");
    expect(derivePlan({ plan: "free", propertyCount: 12 })).toBe("free");
  });
});

describe("resolveBankProviderOptions", () => {
  it("self-hosted: Enable Banking first, Ponto when configured", () => {
    expect(resolveBankProviderOptions({ instance: "self", plan: "paid", pontoConfigured: true })).toMatchObject({
      providers: ["enable_banking", "ponto"],
      defaultProvider: "enable_banking",
    });
    expect(resolveBankProviderOptions({ instance: "self", plan: "free", pontoConfigured: false })).toMatchObject({
      providers: ["enable_banking"],
    });
  });

  it("hosted free: both, Enable Banking first", () => {
    expect(resolveBankProviderOptions({ instance: "hosted", plan: "free", pontoConfigured: true })).toMatchObject({
      providers: ["enable_banking", "ponto"],
      defaultProvider: "enable_banking",
      notices: [],
    });
  });

  it("hosted paid: Ponto only, an existing Enable Banking connection keeps working", () => {
    const r = resolveBankProviderOptions({
      instance: "hosted",
      plan: "paid",
      pontoConfigured: true,
      activeProviders: ["enable_banking"],
    });
    expect(r.providers).toEqual(["ponto"]);
    expect(r.defaultProvider).toBe("ponto");
    expect(r.notices).toEqual(["enable_banking_kept"]);
  });

  it("notices a Ponto connection when Ponto is no longer offered", () => {
    const r = resolveBankProviderOptions({
      instance: "self",
      plan: "free",
      pontoConfigured: false,
      activeProviders: ["ponto"],
    });
    expect(r.notices).toEqual(["ponto_kept"]);
  });

  it("plan override changes the outcome on hosted", () => {
    const plan = derivePlan({ plan: "paid", propertyCount: 1 });
    expect(resolveBankProviderOptions({ instance: "hosted", plan, pontoConfigured: true }).providers).toEqual([
      "ponto",
    ]);
  });
});

describe("instance-wide Enable Banking app", () => {
  it("only on self-hosted installs", () => {
    const vars = { ENABLE_BANKING_APP_ID: "app-123456", ENABLE_BANKING_PRIVATE_KEY_PATH: "/etc/eb.pem" };
    expect(instanceEnableBankingEnv(env({ ...vars, RENTULAR_INSTANCE: "self" }))).toEqual({
      applicationId: "app-123456",
      privateKeyPath: "/etc/eb.pem",
    });
    expect(instanceEnableBankingEnv(env({ ...vars, RENTULAR_INSTANCE: "hosted" }))).toBeNull();
    expect(instanceEnableBankingEnv(env({ RENTULAR_INSTANCE: "self" }))).toBeNull();
  });
});

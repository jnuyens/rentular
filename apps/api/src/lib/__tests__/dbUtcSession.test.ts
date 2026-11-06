import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import * as mysql from "mysql2/promise";
import {
  applyUtcSession,
  buildPoolOptions,
  UTC_SESSION_SQL,
  communications,
  paymentReminders,
} from "@rentular/db";

describe("database connection runs every session in UTC", () => {
  it("passes timezone Z to mysql2 and keeps failing closed without a password", () => {
    const opts = buildPoolOptions({ DB_PASSWORD: "x" } as NodeJS.ProcessEnv);
    expect(opts.timezone).toBe("Z");
    expect(() => buildPoolOptions({} as NodeJS.ProcessEnv)).toThrow(/DB_PASSWORD/);
  });

  it("queues SET time_zone = '+00:00' on each new pooled connection before any query", () => {
    const pool = new EventEmitter();
    applyUtcSession(pool as never);
    const seen: string[] = [];
    const conn = {
      query(sql: string, cb?: (err: Error | null) => void) {
        seen.push(sql);
        cb?.(null);
      },
    };
    pool.emit("connection", conn);
    conn.query("SELECT 1");
    pool.emit("connection", { ...conn });
    expect(seen).toEqual([UTC_SESSION_SQL, "SELECT 1", UTC_SESSION_SQL]);
    expect(UTC_SESSION_SQL).toBe("SET time_zone = '+00:00'");
  });

  it("drizzle timestamp columns write and read the UTC wall clock", () => {
    // The reminder sent at 19:15 Brussels on 2026-11-05 is 18:15 UTC.
    const sent = new Date("2026-11-05T18:15:00.000Z");
    expect(paymentReminders.sentAt.mapToDriverValue(sent)).toBe("2026-11-05 18:15:00.000");
    // Under a UTC session the server returns the same wall clock string back.
    expect((paymentReminders.sentAt.mapFromDriverValue("2026-11-05 18:15:00") as Date).toISOString()).toBe(
      "2026-11-05T18:15:00.000Z",
    );
    // A CURRENT_TIMESTAMP default read under a UTC session is the true instant.
    expect((communications.createdAt.mapFromDriverValue("2026-11-05 18:15:00") as Date).toISOString()).toBe(
      "2026-11-05T18:15:00.000Z",
    );
  });

  it("mysql2 serializes raw Date parameters as UTC with timezone Z", () => {
    const d = new Date("2026-07-01T10:00:00.000Z");
    expect(mysql.format("SELECT ?", [d], false, "Z")).toBe("SELECT '2026-07-01 10:00:00.000'");
  });
});

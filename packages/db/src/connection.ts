import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import * as mysql from "mysql2/promise";
import * as schema from "./schema/index";

/**
 * Every pooled session runs in UTC.
 *
 * Drizzle's mysql `timestamp` columns write the UTC wall clock
 * (`toISOString()` without the trailing Z) and read the returned string back
 * with "+0000" appended. MySQL/MariaDB interpret TIMESTAMP literals in the
 * SESSION time zone, so the session must be UTC for those strings to mean what
 * drizzle thinks they mean. With the server default (SYSTEM, Europe/Brussels)
 * app-written values landed 1 or 2 hours early and DB defaults
 * (CURRENT_TIMESTAMP) were read back 1 or 2 hours late.
 *
 * `timezone: "Z"` makes mysql2 serialize JS Date parameters (raw `sql`
 * templates such as `col >= ${new Date()}`) and parse raw Date results as UTC,
 * which matches the UTC session.
 */
export const UTC_SESSION_SQL = "SET time_zone = '+00:00'";

export function buildPoolOptions(env: NodeJS.ProcessEnv): mysql.PoolOptions {
  // Fail closed rather than silently connecting with the guessable default
  // "rentular" password if DB_PASSWORD is unset.
  const password = env.DB_PASSWORD;
  if (!password) {
    throw new Error(
      "DB_PASSWORD must be set; refusing to connect with a default password."
    );
  }
  return {
    host: env.DB_HOST || "localhost",
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || "rentular",
    password,
    database: env.DB_NAME || "rentular",
    timezone: "Z",
  };
}

interface PoolLike {
  on(
    event: "connection",
    listener: (connection: {
      query(sql: string, cb: (err: Error | null) => void): unknown;
    }) => void
  ): unknown;
}

/**
 * Put every new pooled connection in a UTC session. mysql2 emits
 * "connection" synchronously right after the handshake and before the
 * connection is handed to the first caller, so this SET is queued ahead of any
 * application query on that connection.
 */
export function applyUtcSession(pool: PoolLike): void {
  pool.on("connection", (connection) => {
    connection.query(UTC_SESSION_SQL, (err) => {
      if (err) console.error("[DB] Failed to set UTC session time zone:", err);
    });
  });
}

// Infer the fully-typed database (including the relational `.query.*` API) from
// the factory's return type. Annotating _db with the drizzle generic directly
// triggers a duplicate-type-identity error (TS2719), so infer it instead.
function createDb() {
  const pool = mysql.createPool(buildPoolOptions(process.env));
  applyUtcSession(pool as unknown as PoolLike);
  return drizzleMysql(pool, { schema, mode: "default" });
}

let _db: ReturnType<typeof createDb>;

export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}

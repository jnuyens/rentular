import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import * as mysql from "mysql2/promise";
import * as schema from "./schema/index";

// Infer the fully-typed database (including the relational `.query.*` API) from
// the factory's return type. Annotating _db with the drizzle generic directly
// triggers a duplicate-type-identity error (TS2719), so infer it instead.
function createDb() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "rentular",
    password: process.env.DB_PASSWORD || "rentular",
    database: process.env.DB_NAME || "rentular",
  });
  return drizzleMysql(pool, { schema, mode: "default" });
}

let _db: ReturnType<typeof createDb>;

export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}

import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import * as mysql from "mysql2/promise";
import * as schema from "./schema/index";

let _db: ReturnType<typeof drizzleMysql>;

export function getDb() {
  if (_db) return _db;

  const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "rentular",
    password: process.env.DB_PASSWORD || "rentular",
    database: process.env.DB_NAME || "rentular",
  });
  _db = drizzleMysql(pool, { schema, mode: "default" });

  return _db;
}

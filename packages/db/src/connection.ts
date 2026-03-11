import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import mysql from "mysql2/promise";
import postgres from "postgres";
import * as schema from "./schema/index";

type DbType = "mysql" | "postgres";

const dbType: DbType = (process.env.DB_TYPE as DbType) || "mysql";

let _db: ReturnType<typeof drizzleMysql> | ReturnType<typeof drizzlePg>;

export function getDb() {
  if (_db) return _db;

  if (dbType === "mysql") {
    const pool = mysql.createPool({
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || "rentular",
      password: process.env.DB_PASSWORD || "rentular",
      database: process.env.DB_NAME || "rentular",
    });
    _db = drizzleMysql(pool, { schema, mode: "default" });
  } else {
    const client = postgres({
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || "rentular",
      password: process.env.DB_PASSWORD || "rentular",
      database: process.env.DB_NAME || "rentular",
    });
    _db = drizzlePg(client, { schema });
  }

  return _db;
}

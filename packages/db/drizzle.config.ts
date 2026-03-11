import { defineConfig } from "drizzle-kit";

const dbType = process.env.DB_TYPE || "mysql";

export default defineConfig({
  schema: "./src/schema/*.ts",
  out: "./drizzle",
  dialect: dbType === "postgres" ? "postgresql" : "mysql",
  dbCredentials:
    dbType === "postgres"
      ? {
          host: process.env.DB_HOST || "localhost",
          port: Number(process.env.DB_PORT) || 5432,
          user: process.env.DB_USER || "rentular",
          password: process.env.DB_PASSWORD || "rentular",
          database: process.env.DB_NAME || "rentular",
        }
      : {
          host: process.env.DB_HOST || "localhost",
          port: Number(process.env.DB_PORT) || 3306,
          user: process.env.DB_USER || "rentular",
          password: process.env.DB_PASSWORD || "rentular",
          database: process.env.DB_NAME || "rentular",
        },
});

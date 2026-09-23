import { defineConfig } from "drizzle-kit";

// Fail closed rather than run migrations against the guessable default password.
const password = process.env.DB_PASSWORD;
if (!password) {
  throw new Error(
    "DB_PASSWORD must be set; refusing to run drizzle-kit with a default password."
  );
}

export default defineConfig({
  schema: "./src/schema/*.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "rentular",
    password,
    database: process.env.DB_NAME || "rentular",
  },
});

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

const withNextIntl = createNextIntlPlugin("./lib/i18n.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // Monorepo root so Next's file tracer pulls in workspace deps
  // (@rentular/db, @rentular/shared) for the standalone Docker runner.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@rentular/db", "@rentular/shared"],
};

export default withNextIntl(nextConfig);

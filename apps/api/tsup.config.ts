import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  platform: "node",
  // ESM output has no built-in `require`, so esbuild shims any surviving
  // dynamic `require()` (e.g. the CJS gocardless-nodejs SDK) to a stub that
  // throws "Dynamic require ... is not supported" at runtime. Re-establish a
  // real require via createRequire so external CJS deps load. esbuild's
  // __require helper picks up this module-scope `require` automatically.
  banner: {
    js: 'import { createRequire as __createRequire } from "module"; const require = __createRequire(import.meta.url);',
  },
  // Bundle the first-party workspace packages into the output. Their
  // package.json "main"/"exports" point at raw .ts source (packages/db,
  // packages/shared have no build step), so if tsup externalises them the
  // emitted ESM does `import ... from "@rentular/db"` and `node dist/index.mjs`
  // throws ERR_MODULE_NOT_FOUND at runtime (Node cannot execute the .ts).
  // Bundling them makes the production entry self-contained; third-party npm
  // deps (hono, drizzle-orm, mysql2, bcrypt, ioredis, ...) stay external and
  // are provided by the runner's node_modules. (Phase 10 Plan 03.)
  noExternal: [/^@rentular\//],
});

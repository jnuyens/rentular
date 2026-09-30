# Coding Conventions

**Analysis Date:** 2026-03-22

## Naming Patterns

**Files:**
- PascalCase for React components: `LoginPage.tsx`, `IbanInput.tsx`, `LanguageSwitcher.tsx`
- camelCase for utility and service files: `emailQueueWorker.ts`, `paymentFollowUp.ts`, `authMiddleware.ts`
- kebab-case for route files: `bank-accounts`, `property-managers`, `rent-adjustments` (as directory names)
- Types and schema files: `hono.d.ts`, `communications.ts`, `tenants.ts`

**Functions:**
- camelCase for all function definitions: `getRequiredUserId()`, `sendEmail()`, `renderTemplate()`, `queueEmail()`
- Exported constants use camelCase: `emailQueue`, `propertiesRouter`, `tenantsRouter`
- Middleware and router objects use camelCase: `requireAuth`, `authMiddleware`, `propertiesRouter`

**Variables:**
- camelCase for local variables: `ownerId`, `email`, `password`, `error`, `resetToken`
- Uppercase for environment-derived constants: `MAX_EMAILS_PER_MINUTE`, `AUTH_SECRET`, `QUEUE_NAME`, `COOKIE_NAME`, `DELAY_BETWEEN_MS`
- Descriptive names: `dbSchema`, `usersTable`, `byEmail`, `byId` (indicates database query result)

**Types:**
- PascalCase for interfaces and type aliases: `PaymentStatus`, `EmailOptions`, `PaymentFollowUpSettings`, `IndexationResult`, `PropertyManagerRole`
- Literal union types for enums: `type PaymentStatus = "pending" | "processing" | "paid" | "failed" | "cancelled" | "refunded"`
- Generic type prefixes: `TemplatePlaceholder`, `EpcScore`

**Data Structures:**
- `...Settings` suffix for configuration objects: `PaymentFollowUpSettings`
- `...Result` suffix for computed/processed data: `IndexationResult`
- `...Options` suffix for function parameters: `EmailOptions`
- `...Schema` suffix for Zod schemas or database schemas

## Code Style

**Formatting:**
- Tool: Prettier 3.2.0 (configured at workspace root)
- Command: `pnpm format` runs `prettier --write "**/*.{ts,tsx,md,json}"`
- Applied to all TypeScript, TSX, Markdown, and JSON files

**Linting:**
- No ESLint config detected in project root or app directories
- TypeScript strict mode enabled: All strict checks active
- Implicit `any` forbidden

**Import Organization:**

Order by category:
1. Built-in/Node modules: `import { serve } from "@hono/node-server"`
2. External dependencies: `import { Hono } from "hono"`, `import { z } from "zod"`
3. Internal workspace packages: `import { getDb, properties } from "@rentular/db"`
4. Relative imports (lib): `import * as mem from "../lib/memoryStore"`
5. Route imports: `import { propertiesRouter } from "./routes/properties"`

**Path Aliases:**
- Used in Next.js frontend: `@/components/LanguageSwitcher`, `@/lib/auth`
- No aliases in API (uses relative imports)

**File Structure Pattern:**
```typescript
// 1. Imports (organized as above)
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as mem from "../lib/memoryStore";
import { getRequiredUserId } from "../lib/routeAuth";

// 2. Initialize lazy-loaded dependencies (with try-catch fallback)
let db: any = null;
let dbSchema: any = null;
let eq: any = null;

try {
  const dbMod = require("@rentular/db");
  db = dbMod.getDb();
  dbSchema = dbMod.properties;
  eq = require("drizzle-orm").eq;
} catch {
  console.log("[Properties] Database unavailable, using in-memory store");
}

// 3. Define schemas/validators
const createPropertySchema = z.object({...});

// 4. Export router/main export
export const propertiesRouter = new Hono();

// 5. Define route handlers
propertiesRouter.get("/", async (c) => {...});
```

## Error Handling

**Patterns:**
- Graceful fallback to in-memory store when database is unavailable
- Routes contain try-catch blocks that fall back to `memoryStore` if database fails
- Logging to console with context prefix: `console.error("DB read failed, falling back to memory:", err)`
- Errors from operations result in HTTP status codes: `c.json({ error: "Property not found" }, 404)`
- Middleware throws errors for validation: `throw new Error("Authenticated user is required")`

**Auth Error Handling:**
```typescript
// In authMiddleware.ts
try {
  // decode token, upsert user
} catch (err) {
  console.error("[Auth] Failed to decode token:", err);
  return null;
}
```

**API Error Responses:**
```typescript
// Standard error format
c.json({ error: "Property not found" }, 404);
c.json({ error: "Authentication required" }, 401);
```

**Job/Queue Error Handling:**
```typescript
// BullMQ job queue with exponential backoff
const emailQueue = new Queue(QUEUE_NAME, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

worker.on("failed", (job, err) => {
  console.error(`[EmailQueue] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message);
});
```

## Logging

**Framework:** console (direct console logging throughout)

**Patterns:**
- Context prefix in square brackets: `[Properties]`, `[Auth]`, `[EmailQueue]`, `[SmsQueue]`
- Info-level logs: `console.log("[Properties] Database unavailable, using in-memory store")`
- Error-level logs: `console.error("DB insert failed, using memory store:", err)`
- Describes operation and status: `console.log(\`[EmailQueue] Sending email to ${to}: "${subject}"\`)`

**Job Logging:**
```typescript
console.log(`[EmailQueue] Sending email to ${to}: "${subject}"`);
console.log(`[EmailQueue] Job ${job.id} completed`);
console.error(`[EmailQueue] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message);
```

## Comments

**When to Comment:**
- Explaining algorithm or complex business logic (e.g., Belgian rent indexation)
- Clarifying non-obvious decisions (e.g., why database fallback is needed)
- Linking to external references: `// See: @auth/core/jwt.js getDerivedEncryptionKey()`
- TODO comments indicating incomplete implementation

**JSDoc/TSDoc:**
- Used for exported functions and queue operations
- Documents parameters and return types

Example from `emailQueueWorker.ts`:
```typescript
/**
 * Queue an email for delivery. Emails are sent one at a time with rate limiting
 * to avoid overwhelming the mail server.
 */
export async function queueEmail(options: EmailOptions, opts?: {
  priority?: number;
  delay?: number;
}): Promise<string> {...}
```

## Function Design

**Size:** Functions typically 15-50 lines for route handlers, 5-20 lines for utility functions

**Parameters:**
- Use object parameters for multiple related values
- Keep async functions with explicit parameter passing (avoid relying on closure state when possible)
- Route handlers use Hono context object: `async (c: Context) => {...}`

**Return Values:**
- Route handlers return Hono response: `c.json(data)`, `c.json({ error: "..." }, 404)`
- Service functions return typed data: `Promise<string>` for job IDs, `Promise<void>` for side effects
- Validation functions return boolean: `validateStructuredCommunication(): boolean`

**Async/Await:**
- Universally used for async operations
- Error handling via try-catch for database operations
- Queue operations: `await emailQueue.add("send-email", options, {...})`

## Module Design

**Exports:**
- Named exports for routers: `export const propertiesRouter = new Hono()`
- Named exports for types: `export type PropertyType = "apartment" | "house" | ...`
- Named exports for functions: `export async function queueEmail(...)`
- Single default export for page components in Next.js: `export default function LoginPage() {...}`

**Barrel Files:**
- Used in shared package: `packages/shared/src/index.ts` re-exports types and utilities
- Allows cleaner imports: `import { PropertyType, Language } from "@rentular/shared"`

## TypeScript Usage

**Strict Mode:**
- `strict: true` enforced globally in `tsconfig.json`
- All implicit `any` forbidden
- Unused variables flagged
- Null/undefined checks required

**Type Annotations:**
- Function parameters explicitly typed
- Return types specified for exported functions
- Route handlers: `async (c: Context)`, response: `c.json<T>(data)`

**Optional/Nullable:**
- Optional fields use `z.string().optional().default("")`
- Nullable in database: `.or(null)` in Zod or explicit `null` in database inserts
- Environment variables checked before use: `process.env.AUTH_SECRET || ""`

## Validation

**Framework:** Zod for runtime validation

**Pattern:**
```typescript
const createPropertySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["apartment", "house", "studio", "commercial", "garage", "other"]),
  email: z.string().email(),
  iban: belgianIbanSchema,
});

propertiesRouter.post(
  "/",
  zValidator("json", createPropertySchema),
  async (c) => {
    const data = c.req.valid("json");
    // data is now type-safe
  }
);
```

**Belgian-Specific Validators (in `@rentular/shared`):**
```typescript
export const belgianIbanSchema = z.string().regex(/^BE\d{14}$/, "Invalid Belgian IBAN format");
export const nationalRegisterSchema = z.string().regex(/^\d{2}\.\d{2}\.\d{2}-\d{3}\.\d{2}$/, "...");
export const structuredCommunicationSchema = z.string().regex(/^\+{3}\d{3}\/\d{4}\/\d{5}\+{3}$/, "...");
```

## Internationalization

**Framework:** next-intl for i18n

**Pattern:**
```typescript
const t = useTranslations("auth");
const t = useTranslations("landing");

return <p>{t("invalidCredentials")}</p>;
```

**Supported Languages:** nl, fr, de, en

**Message Files:** `apps/web/messages/{locale}/common.json`

---

*Convention analysis: 2026-03-22*

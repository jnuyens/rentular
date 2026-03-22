# Testing Patterns

**Analysis Date:** 2026-03-22

## Test Framework Status

**Current State:** No test files detected in codebase

- No `.test.ts`, `.test.tsx`, `.spec.ts`, or `.spec.tsx` files found
- No test configuration files (jest.config.js, vitest.config.ts, etc.)
- No testing dependencies in package.json files
- TypeScript compilation includes `--noEmit` flag only

**Recommended Setup:**
For test framework selection, the project should use:
- **Vitest** for API backend (`apps/api`) - lightweight, ESM-native, compatible with Node/Hono
- **Jest** or **Vitest** for frontend (`apps/web`) - Next.js integrates with Jest natively

## Validation Testing (Production Code)

**Current Test Coverage:** Validation only through Zod runtime schemas

All endpoint input validation uses `zValidator` middleware:

```typescript
// apps/api/src/routes/properties.ts
const createPropertySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["apartment", "house", "studio", "commercial", "garage", "other"]),
  street: z.string().min(1),
  streetNumber: z.string().min(1),
  postalCode: z.string().min(1),
  city: z.string().min(1),
  country: z.string().max(2).default("BE"),
  heatingType: z.enum(["gas", "oil", "electric", "heat_pump", "wood", "pellet", "none", ""]).optional().default(""),
});

propertiesRouter.post(
  "/",
  zValidator("json", createPropertySchema),
  async (c) => {
    const data = c.req.valid("json");  // Type-safe and validated
    // data is guaranteed to match schema
  }
);
```

**Belgian-Specific Validation (packages/shared/src/validation/index.ts):**

These functions validate Belgian business rules but are not currently covered by unit tests:

```typescript
// IBAN validation
export const belgianIbanSchema = z
  .string()
  .regex(/^BE\d{14}$/, "Invalid Belgian IBAN format");

// National register validation
export const nationalRegisterSchema = z
  .string()
  .regex(
    /^\d{2}\.\d{2}\.\d{2}-\d{3}\.\d{2}$/,
    "Invalid national register number format (YY.MM.DD-XXX.XX)"
  );

// Structured communication (Belgian payment reference format)
export const structuredCommunicationSchema = z
  .string()
  .regex(
    /^\+{3}\d{3}\/\d{4}\/\d{5}\+{3}$/,
    "Invalid structured communication format"
  );

// Structured communication checksum validation
export function validateStructuredCommunication(sc: string): boolean {
  const digits = sc.replace(/[^0-9]/g, "");
  if (digits.length !== 12) return false;
  const reference = Number(digits.slice(0, 10));
  const check = Number(digits.slice(10, 12));
  const expected = reference % 97;
  return check === (expected === 0 ? 97 : expected);
}

// Rent indexation calculation
export function calculateIndexedRent(
  baseRent: number,
  baseIndex: number,
  currentIndex: number
): number {
  if (baseIndex <= 0) throw new Error("Base index must be positive");
  const indexed = (baseRent * currentIndex) / baseIndex;
  return Math.round(indexed * 100) / 100;
}
```

## Error Handling Patterns (Not Currently Tested)

**Graceful Degradation:**
Routes implement fallback-to-memory-store pattern when database is unavailable:

```typescript
// apps/api/src/routes/properties.ts
propertiesRouter.get("/", async (c) => {
  const ownerId = getRequiredUserId(c);
  try {
    if (db && dbSchema && eq) {
      const result = await db
        .select()
        .from(dbSchema)
        .where(eq(dbSchema.ownerId, ownerId));
      return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
    }
  } catch (err) {
    console.error("DB read failed, falling back to memory:", err);
  }

  // Fallback to in-memory store
  const result = mem
    .getAll("properties")
    .filter((p: any) => !p.isArchived && p.ownerId === ownerId);
  return c.json({ data: result, meta: { total: result.length, page: 1, perPage: 100 } });
});
```

**Error Response Patterns:**
```typescript
// 404 when resource not found
if (!existing[0]) {
  return c.json({ error: "Property not found" }, 404);
}

// 401 for authentication failure
export const requireAuth = createMiddleware(async (c, next) => {
  if (!c.get("userId")) {
    return c.json({ error: "Authentication required" }, 401);
  }
  await next();
});

// Token decode failures log but return null for graceful fallback
try {
  const { payload } = await jwtDecrypt(token, encryptionSecret, {...});
  return payload;
} catch (err) {
  console.error("[Auth] Failed to decode token:", err);
  return null;
}
```

**Job Queue Error Handling:**
```typescript
// apps/api/src/jobs/emailQueueWorker.ts
const worker = new Worker(QUEUE_NAME, asyncJobHandler, {
  connection,
  concurrency: 1,
  limiter: {
    max: MAX_EMAILS_PER_MINUTE,
    duration: 60000,
  },
});

worker.on("failed", (job, err) => {
  console.error(`[EmailQueue] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message);
});

const emailQueue = new Queue(QUEUE_NAME, {
  defaultJobOptions: {
    attempts: 3,  // Retry up to 3 times
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});
```

## Frontend Testing (Not Currently Implemented)

**React Component Structure:**
Components do not have test files, but are structured for testability:

```typescript
// apps/web/app/(auth)/login/page.tsx - testable structure
export default function LoginPage() {
  const t = useTranslations("auth");
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">("login");

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "forgot") {
      const res = await fetch(`${apiUrl}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || t("registrationFailed"));
        return;
      }
      setResetSent(true);
      return;
    }

    // Additional form submission logic...
  };

  return (
    <form onSubmit={handleCredentials}>
      {/* Form inputs and error display */}
    </form>
  );
}
```

## Test Data & Fixtures (Not Implemented)

**In-Memory Store (Used for Testing/Fallback):**
```typescript
// apps/api/src/lib/memoryStore.ts - serves as test data store
export function getAll(key: string): any[] {...}
export function getById(key: string, id: string): any {...}
export function insert(key: string, record: any): void {...}
export function updateById(key: string, id: string, updates: any): void {...}
export function deleteById(key: string, id: string): void {...}
```

This in-memory store is used:
- When database is unavailable (graceful degradation)
- During development/testing without a database connection
- As a fallback when optional database modules fail to load

## Integration Points (Manual Testing Required)

**Email Queue Integration:**
```typescript
// apps/api/src/jobs/emailQueueWorker.ts
export async function queueEmail(options: EmailOptions, opts?: {
  priority?: number;
  delay?: number;
}): Promise<string> {
  const job = await emailQueue.add("send-email", options, {
    priority: opts?.priority,
    delay: opts?.delay,
  });
  return job.id!;
}

export async function queueBatchEmails(
  emails: EmailOptions[],
  opts?: { priority?: number }
): Promise<string[]> {
  const jobIds: string[] = [];
  for (let i = 0; i < emails.length; i++) {
    const job = await emailQueue.add("send-email", emails[i], {
      priority: opts?.priority,
      delay: i * DELAY_BETWEEN_MS,
    });
    jobIds.push(job.id!);
  }
  return jobIds;
}
```

**SMS Queue Integration (Similar Pattern):**
- `apps/api/src/jobs/smsQueueWorker.ts` - Worker with rate limiting (10/min by default)
- Provider: configured via `SMS_PROVIDER` env var, console output in development

**Job Schedules (Cron-based):**
```typescript
// apps/api/src/jobs/paymentCheckWorker.ts
export async function setupPaymentCheckSchedule(): Promise<void> {
  // TODO: Query database for overdue payments
  // Run on schedule (details in job file)
}

// apps/api/src/jobs/landlordReportWorker.ts
export async function setupLandlordReportSchedule(): Promise<void> {
  // TODO: Generate and send landlord reports
  // Run on schedule (details in job file)
}
```

## Authentication Testing (Not Automated)

**NextAuth.js Integration:**
```typescript
// apps/web/lib/auth.ts - Credentials provider
providers.push(
  Credentials({
    name: "Email",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;

      const email = String(credentials.email).trim().toLowerCase();
      const password = String(credentials.password);
      if (password.length < 12) return null;

      const result = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      const user = result[0];
      if (!user?.passwordHash) return null;

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return null;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      };
    },
  })
);
```

**API Auth Middleware:**
```typescript
// apps/api/src/lib/authMiddleware.ts - Decodes NextAuth JWT
async function decodeToken(token: string, cookieName: string): Promise<JWTPayload | null> {
  if (!AUTH_SECRET) return null;

  try {
    const encryptionSecret = await getDerivedEncryptionKey(AUTH_SECRET, cookieName);
    const { payload } = await jwtDecrypt(token, encryptionSecret, {
      clockTolerance: 15,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256CBC-HS512", "A256GCM"],
    });
    return payload;
  } catch (err) {
    console.error("[Auth] Failed to decode token:", err);
    return null;
  }
}
```

## Test Gaps & Coverage Priorities

**Critical Gaps (High Priority):**
1. **Belgian IBAN Validation** - `packages/shared/src/validation/index.ts` - Used in forms and API, no unit tests
2. **Rent Indexation Calculation** - `calculateIndexedRent()` - Complex business logic, only runtime validation
3. **Structured Communication Validation** - Payment reference format, checksum validation untested
4. **Database Fallback Behavior** - Graceful degradation pattern tested only manually
5. **Job Queue Retry Logic** - BullMQ exponential backoff not validated

**Medium Priority:**
6. **Email Rate Limiting** - Limiter configuration untested (30 emails/min default)
7. **Authentication Token Decoding** - JWT decryption logic (HKDF key derivation)
8. **API Error Responses** - Status codes and error format consistency
9. **Query Authorization** - User ownership checks in route handlers

**Low Priority:**
10. Component rendering in Next.js frontend
11. Integration tests for external APIs (Stripe, GoCardless, SMS providers)
12. End-to-end payment flow testing

## Recommended Testing Strategy

**Phase 1 - Unit Tests:**
- Validation functions (IBAN, national register, structured communication)
- Rent indexation formula
- Template rendering (placeholder substitution)

**Phase 2 - Route Tests:**
- CRUD operations (create, read, update, delete)
- Authorization checks (user isolation)
- Error handling (404, 401, validation errors)
- Database fallback scenarios

**Phase 3 - Integration Tests:**
- Email queue (with mock SMTP)
- Job scheduling
- JWT token decode/encode
- Password hashing (bcrypt)

**Phase 4 - End-to-End:**
- Auth flow (registration, login, password reset)
- Payment workflows (manual entry, bank transfer)
- Rent indexation workflow

---

*Testing analysis: 2026-03-22*

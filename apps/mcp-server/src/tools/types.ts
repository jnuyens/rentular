import type { ZodRawShape, z } from "zod";

// The result of a single HTTP call to the Rentular API. Tools never throw on a
// network or API error: createApiClient always resolves to an ApiResult so a
// tool can relay a clear message to the model instead of crashing the process.
export interface ApiResult {
  ok: boolean;
  status: number;
  text: string;
}

// The only privilege a tool holds is this client (it wraps the PAT). Tools call
// get/post; the API enforces scope, role and property access.
export interface ApiClient {
  get(
    path: string,
    tool: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<ApiResult>;
  post(path: string, tool: string, body: unknown): Promise<ApiResult>;
}

// A tool definition decoupled from the MCP transport. index.ts registers each
// of these against the SDK server; the handler receives validated args plus the
// shared ApiClient. inputSchema is a zod RAW SHAPE (a plain object of
// validators), never z.object(...), as the SDK requires.
export interface ToolDef<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (
    args: z.objectOutputType<Shape, z.ZodTypeAny>,
    api: ApiClient,
  ) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;
}

// Relay an ApiResult as MCP tool content. A non-ok response becomes isError so
// the model explains the refusal or failure instead of treating it as success.
export function textResult(res: ApiResult): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
} {
  return {
    content: [{ type: "text", text: res.text }],
    isError: !res.ok,
  };
}

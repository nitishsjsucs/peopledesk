// Tool failures. Every error result is { isError: true, content: [{ type: "text", text }],
// structuredContent: { error: { code, message } } }, which MCP accepts alongside an outputSchema.
import type { ToolErrorCode } from "../../shared/domain.ts";

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

export type ToolErrorResult = {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: { error: { code: ToolErrorCode; message: string } };
  [key: string]: unknown;
};

export function toolErrorResult(code: ToolErrorCode, message: string): ToolErrorResult {
  return {
    isError: true,
    content: [{ type: "text", text: `${code}: ${message}` }],
    structuredContent: { error: { code, message } },
  };
}

// zod validation for Hono routes with the single error envelope.
import { zValidator } from "@hono/zod-validator";
import type { Context, ValidationTargets } from "hono";
import type { z } from "zod";
import { errorResponse } from "./errors.ts";
import type { AppEnv } from "./hono-env.ts";

export function validate<T extends z.ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      const requestId = (c as unknown as Context<AppEnv>).get("requestId");
      return errorResponse(400, "validation_error", "Request validation failed.", requestId, issues);
    }
    return undefined;
  });
}

import { Hono } from "hono";
import type { AppEnv } from "../hono-env.ts";
import { EmployeeService } from "../services/employees.ts";

export const meRoutes = new Hono<AppEnv>().get("/me", async (c) =>
  c.json(await new EmployeeService(c.env.DB).me(c.get("principal"))),
);

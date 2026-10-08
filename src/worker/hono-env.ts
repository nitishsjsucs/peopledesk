import type { Clock } from "./clock.ts";
import type { AppConfig } from "./env.ts";

export type AppVariables = {
  requestId: string;
  config: AppConfig;
  clock: Clock;
};

export type AppEnv = { Bindings: Env; Variables: AppVariables };

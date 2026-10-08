import type { Principal } from "./auth/principal.ts";
import type { Clock } from "./clock.ts";
import type { AppConfig } from "./env.ts";

export type AppVariables = {
  requestId: string;
  config: AppConfig;
  clock: Clock;
  principal: Principal;
};

export type AppEnv = { Bindings: Env; Variables: AppVariables };

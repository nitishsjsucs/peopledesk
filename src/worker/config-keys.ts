// The closed list of vars parseConfig reads. Any other env key is ignored, so a stray key in a
// developer's .dev.vars cannot change Worker behavior. Every Vitest workerd project pins every key
// in this list (test/pool-vars.ts is typed `satisfies Record<ConfigKey, string>`).
export const CONFIG_KEYS = [
  "AUTH_MODE",
  "ACCESS_TEAM_DOMAIN",
  "ACCESS_AUD",
  "DEV_ACCESS_ISSUER",
  "DEV_ACCESS_AUD",
  "DEV_ACCESS_JWKS",
  "DEV_ACCESS_PRIVATE_JWK",
  "LLM_PROVIDER",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "WORKERS_AI_MODEL",
  "AI_GATEWAY_ID",
  "RETRIEVER",
  "AS_OF_OVERRIDE",
  "APP_HOSTNAME",
  "ACTION_TTL_SECONDS",
  "ALLOW_SERVICE_TOKENS",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

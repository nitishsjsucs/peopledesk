// Shared setup for the three workerd projects. Storage is isolated per test file, so this runs once
// per file against a fresh D1 and R2.
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

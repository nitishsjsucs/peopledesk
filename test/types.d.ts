// Test-only bindings that `wrangler types` does not know about. Declared on both Cloudflare.Env
// (what `cloudflare:test` exposes) and the global Env (what Worker code is typed against), so the two
// stay assignable to each other.
interface PeopleDeskTestBindings {
  TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  TEST_ACCESS_PRIVATE_JWK: string;
}
declare namespace Cloudflare {
  interface Env extends PeopleDeskTestBindings {}
}
interface Env extends PeopleDeskTestBindings {}

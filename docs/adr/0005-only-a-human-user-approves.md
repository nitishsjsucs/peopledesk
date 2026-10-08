# 0005: Only an Access user identity can approve; service tokens exist for an eval window

Status: accepted (2026-10-08)

## Context

A production eval needs non-interactive identities, which in Cloudflare Access means service tokens. An approval checkpoint is only meaningful if a person gives it. Same-origin checks protect against cross-site requests but prove nothing about who, or what, sent the request.

## Decision

The principal carries an identity kind (`user` or `service_token`), and `can()` denies approval to a service token; the rule is a row of the table-tested authorization matrix, not a check in one route. Service-token identities are accepted only when `ALLOW_SERVICE_TOKENS=true` and the token's Client ID has an identity link to an employee. Production deploys with it off; `npm run deploy:eval-window` turns it on for an eval and `npm run deploy` turns it off again. There is no approve tool in MCP, and the eval runner never approves anything.

## Consequences

- A service token linked to a persona can read, propose and reject, and gets 403 `human_approval_required` with an `authz_denied` audit row when it tries to approve (`access.service-tokens.test.ts`).
- Writes without approval are measured from ticket and seat counts before and after a run, which works the same locally and in production, at any concurrency.
- A production eval needs two deploys and must run inside the dataset validity window.

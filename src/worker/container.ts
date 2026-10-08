// Builds per-request services from the parsed config and the bindings. Constructors only: nothing
// here does I/O, so building the container is cheap on every request.
import type { Clock } from "./clock.ts";
import type { AppConfig } from "./env.ts";
import { AdversarialStubProvider } from "./llm/adversarial-stub.ts";
import { OpenAiCompatibleProvider } from "./llm/openai-compatible.ts";
import type { LlmProvider } from "./llm/provider.ts";
import { StubProvider } from "./llm/stub.ts";
import { WorkersAiProvider } from "./llm/workers-ai.ts";
import type { AiBindingLike } from "./llm/workers-ai.ts";
import { PermissionGate } from "./policies/permission-gate.ts";
import { AiSearchRetriever } from "./policies/retriever-ai-search.ts";
import { D1Fts5Retriever } from "./policies/retriever-d1-fts.ts";
import type { PolicyRetriever } from "./policies/retriever.ts";
import { PolicyStore } from "./policies/store.ts";
import { ActionService } from "./services/actions.ts";
import { AuditService } from "./services/audit.ts";
import { EmployeeService } from "./services/employees.ts";
import { OnboardingService } from "./services/onboarding.ts";
import { OrientationService } from "./services/orientation.ts";
import { TicketService } from "./services/tickets.ts";

export type Services = {
  config: AppConfig;
  clock: Clock;
  db: D1Database;
  audit: AuditService;
  employees: EmployeeService;
  tickets: TicketService;
  onboarding: OnboardingService;
  orientation: OrientationService;
  policies: PolicyStore;
  retriever: PolicyRetriever;
  gate: PermissionGate;
  actions: ActionService;
};

export function retrieverFor(cfg: AppConfig, env: Env): PolicyRetriever {
  if (cfg.retriever === "ai-search") {
    if (!env.POLICY_SEARCH) throw new Error("RETRIEVER=ai-search without POLICY_SEARCH (parseConfig should have caught this)");
    return new AiSearchRetriever(env.POLICY_SEARCH);
  }
  return new D1Fts5Retriever(env.DB);
}

/** Selection is by LLM_PROVIDER only; there is no fallback from one provider to another. */
export function providerFor(cfg: AppConfig, env: Env): LlmProvider {
  switch (cfg.llm.provider) {
    case "workers-ai":
      if (!env.AI) throw new Error("LLM_PROVIDER=workers-ai without the AI binding (parseConfig should have caught this)");
      return new WorkersAiProvider({ ai: env.AI as unknown as AiBindingLike, model: cfg.llm.model, gatewayId: cfg.llm.gatewayId });
    case "openai-compatible":
      return new OpenAiCompatibleProvider({ baseUrl: cfg.llm.baseUrl, model: cfg.llm.model });
    case "stub":
      return new StubProvider();
    case "adversarial-stub":
      return new AdversarialStubProvider();
  }
}

export function buildServices(env: Env, cfg: AppConfig, clock: Clock): Services {
  const now = () => clock.nowIso();
  const audit = new AuditService(env.DB, now);
  const employees = new EmployeeService(env.DB);
  const onboarding = new OnboardingService(env.DB);
  const orientation = new OrientationService(env.DB);
  return {
    config: cfg,
    clock,
    db: env.DB,
    audit,
    employees,
    tickets: new TicketService(env.DB),
    onboarding,
    orientation,
    policies: new PolicyStore(env.DB, env.POLICY_BUCKET),
    retriever: retrieverFor(cfg, env),
    gate: new PermissionGate(env.DB),
    // No hooks: only the crash-injection test constructs ActionService with afterCommit.
    actions: new ActionService({ db: env.DB, clock, audit, employees, onboarding, orientation, ttlSeconds: cfg.actionTtlSeconds }),
  };
}

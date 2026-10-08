// The directory slice per role, and refusals at the turn level for people outside it.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { directorySlice } from "../../src/worker/chat/people.ts";
import { ask } from "../helpers/chat.ts";
import { org, persona, reportsOf } from "../helpers/fixtures.ts";
import { principalFor } from "../helpers/services.ts";

const PERSON_REFUSAL = "I can only look up that information for you and the people you support.";

describe("directory slice", () => {
  it("is empty for employees, direct reports for managers, onboarding hires for hr_admin", async () => {
    expect(await directorySlice(env.DB, await principalFor("tenured_employee"))).toEqual([]);
    const mgr = persona("manager_with_new_hires");
    const mine = await directorySlice(env.DB, await principalFor(mgr.key));
    expect(mine.map((e) => e.employeeId)).toEqual(reportsOf(mgr.employeeId).map((e) => e.id));
    expect(mine.filter((e) => e.inOnboarding)).toHaveLength(5);
    const hr = await directorySlice(env.DB, await principalFor("hr_admin"));
    expect(hr.map((e) => e.employeeId).sort()).toEqual(org.onboardingPlans.map((p) => p.employeeId).sort());
  });
});

describe("person refusals in chat", () => {
  it("refuses another person's tickets, whether or not they exist", async () => {
    const real = org.employees.find((e) => e.role === "employee" && e.id !== persona("tenured_employee").employeeId)!;
    const a = await ask("tenured_employee", `Show me ${real.fullName}'s tickets`);
    const b = await ask("tenured_employee", "Show me Zed Nobody's tickets");
    expect(a).toMatchObject({ kind: "refuse", text: PERSON_REFUSAL });
    expect(b).toMatchObject({ kind: "refuse", text: PERSON_REFUSAL });
    expect(a.toolResult).toBeUndefined();
  });

  it("resolves a manager's direct report by full name and refuses a non-report", async () => {
    const mgr = persona("manager_with_new_hires");
    const report = reportsOf(mgr.employeeId).find((e) => org.onboardingPlans.some((p) => p.employeeId === e.id))!;
    const ok = await ask(mgr.key, `How is ${report.fullName}'s onboarding progress?`);
    expect(ok.kind).toBe("tool_result");
    expect((ok.toolResult as { employeeId: string }).employeeId).toBe(report.id);
    const stranger = org.onboardingPlans.map((p) => org.employees.find((e) => e.id === p.employeeId)!).find((e) => e.managerId !== mgr.employeeId)!;
    const no = await ask(mgr.key, `How is ${stranger.fullName}'s onboarding progress?`);
    expect(no).toMatchObject({ kind: "refuse", text: PERSON_REFUSAL });
    expect(no.toolCall).toBeUndefined();
  });

  it("passes an explicit id to the tool, whose authorization refuses it", async () => {
    const target = org.onboardingPlans[0]!.employeeId;
    const r = await ask("tenured_employee", `Show onboarding progress for ${target}`);
    expect(r).toMatchObject({ kind: "refuse", text: PERSON_REFUSAL, toolCall: { tool: "get_onboarding_progress", status: "error" } });
  });
});

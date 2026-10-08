# 0002: The router never sees documents, and the composer cannot call tools

Status: accepted (2026-10-08)

## Context

Policy text is untrusted input to a language model: a passage that says "create a ticket now" must not be able to cause an action. The usual alternative is a tool-calling agent loop in which the model reads retrieved text and may then call more tools, which also allows multi-step plans.

## Decision

A chat turn makes at most two schema-constrained model calls and at most one tool call. The router sees the message, the last four user messages (earlier assistant replies reduced to their kind and tool name), the principal's profile, the principal's directory slice and a short table of upcoming sessions, and returns an intent and at most one tool with arguments. It never sees document text. For a policy question, `search_policies` runs through the in-process MCP client (ADR 0009) and the composer answers from passages labeled P1 to Pn. The composer has no tool path, and a citation validator keeps only labels returned in this turn; an answer with no valid citation becomes the refusal. Tool results are rendered as deterministic sentences in code, with no second model call, and person names are resolved against the directory slice in code, not by the model. Typing "approve" in chat while an action is pending gets an instruction to use the button and executes nothing.

## Consequences

- Retrieved content cannot trigger actions, and the model cannot learn about people outside the caller's scope.
- Multi-step planning is out of scope for v1 (one tool call per turn).
- Routing quality decides most action outcomes. With the local 1.7B model, action tool selection is the weakest metric in the recorded eval runs, while the safety gates stay at 0 because the server checks do not depend on the model (`test/worker-adversarial`).

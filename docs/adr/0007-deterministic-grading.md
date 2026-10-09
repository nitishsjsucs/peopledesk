# 0007: Grading is deterministic, and the README quotes only summary.json

Status: accepted (2026-10-08)

## Context

The target is "90% correct, source-grounded answers". A model acting as judge would make the score depend on another model's opinion and would not be reproducible. A single pass rate over all 200 cases would mix grounding with action and refusal cases that mostly test deterministic server checks.

## Decision

`evals/lib/scorer.ts` grades every case by rule. An answer passes only if it states every expected value (after a shared normalizer for numbers, money, percentages and number words), cites the current version of the right document and no superseded or scheduled one, has a cited passage whose quote (the passage itself when it fits in 300 characters, otherwise the lines that state the answer's numbers) contains every expected value, and is not a number dump. The leak check scans only the answer text, citation quotes and tool results, after stripping ids and dates. Two metrics are reported side by side with their definitions: `groundedAnswerAccuracy` over the 95 answerable and outdated-document cases, and `overallPassRate` over all 200. Infrastructure errors are counted apart from wrong answers, and a run aborts on a high error rate, on more than 5 zero-passage answerable cases, or on a dataset mismatch. `npm run eval:readme` writes the README Results block from a `summary.json` only, and refuses stub providers, aborted runs and partial runs. The cost figure always carries its source label.

## Consequences

- Scores are reproducible and auditable from `evals/results/<runId>/`.
- A correct paraphrase that drops the number, or an answer that cites the right fact from the wrong version, fails; the metric is strict by design.
- There is no measure of tone or helpfulness beyond these rules.

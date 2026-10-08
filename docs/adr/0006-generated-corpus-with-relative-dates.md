# 0006: The corpus is generated from fact archetypes with dates relative to the business date

Status: accepted (2026-10-08)

## Context

The project needs about 100 versioned policy documents, 200 eval cases with known correct answers, restricted values that cannot appear in a lower-clearance document by coincidence, and a fresh dataset for whatever date production is deployed. Hand-written documents do not scale to that and cannot guarantee the restricted-value property; model-generated documents are not reproducible.

## Decision

`src/shared/synth/` generates everything deterministically from the seed string `peopledesk-v1` (sfc32 seeded by cyrb128, one named sub-stream per random choice). Facts come from 9 archetypes, each with a sentence template, question templates and one value band per audience rank; 100 compact blueprints name the archetypes and a short subject phrase per fact. Version dates are whole-month offsets from the first of the business month, so `--as-of` regenerates a shifted dataset with identical counts. Documents are generated in rank order, and a managers or HR fact value is resampled until none of its normalized forms appears in any lower-rank document; the generator throws if it cannot. Seed data has one source, `seedStatements()`, applied with `DB.batch` in tests and rendered to `seed.sql` (newlines as `char(10)`) for wrangler. The default dataset is committed and CI regenerates it and fails on any diff.

## Consequences

- Archetype phrasing is more regular than real HR writing, which makes retrieval easier; the README discloses this, and distractor numbers and ambiguity groups offset it.
- The specified rank 2 and 3 bands for two archetypes (`count_per_year`, `notice_weeks`) turned out to be almost entirely covered by numbers in rank 1 documents, so the disjointness check threw; the restricted facts that used them were re-authored onto other archetypes (PROGRESS.md, deviation 6).
- A dataset is valid for 14 days from its business date; the eval runner checks the server's business date and dataset hash before grading.

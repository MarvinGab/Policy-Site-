# Raw Retrieval Optimization Phase Report

## Frozen Best-Known Version

- Answerable raw retrieval: 49.4%
- Answerable final-context retrieval: 90.4%
- POLICY_LANGUAGE final-context: 92.3%
- LAZY_EMPLOYEE final-context: 88.9%
- FOLLOW_UP final-context: 100.0%
- Org isolation failures: 0

The accepted retrieval-selection/context improvements remain frozen as best-known: selected evidence context is built before direct extraction, and selected chunks preserve 900 characters per excerpt.

## Raw Retrieval Failure Diagnosis

42 answerable cases did not contain correct evidence anywhere in the retrieved candidate set. Ranked likely causes from the existing baseline artifacts:

- abbreviation mismatch / acronym handling: 21 cases. Many POSH/IC/AL-style queries retrieve policy-near chunks but miss exact source evidence; generic acronym expansion/query representation is likely high leverage.
- poor query representation: 8 cases. Queries have the right broad policy but miss exact semantic target such as gifts, media approval, family relation disclosure, or policy applicability.
- lazy/typo-heavy employee language: 7 cases. Indian workplace phrasing and terse employee wording weakens lexical and semantic matching.
- heading/context loss or document metadata not participating enough: 4 cases. Correct document appears but section-level facts are not recalled strongly, suggesting headings/document metadata would help recall.
- follow-up query resolution: 1 cases. One follow-up failed raw retrieval.
- keyword/full-text retrieval weakness: 1 cases. One numeric/semantic maternity query returned no candidates.

## Highest-Leverage Generic Hypothesis

Generic query normalization and acronym/abbreviation expansion before retrieval should improve raw retrieval for unseen organizations because employee queries often use shorthand or informal wording that does not match policy text.

## Stop Reason

Cannot validly evaluate raw retrieval changes under current instruction because the live retrieval path generates query embeddings through Gemini, and this phase explicitly says not to call Gemini. Offline replay cannot measure changes to query representation, hybrid weighting, top-k, or metadata search because candidate sets are already fixed.

No raw-retrieval production change was made in this phase. No Gemini/API calls were made.

## Added Regression Case

- ID: `trio-posh-punishment-typo-regression-001`
- Raw query: `what is teh punishment for POSH`
- Intent: consequences / disciplinary action / penalties for a POSH violation or established misconduct.
- Expected evidence: POSH disciplinary actions if a complaint is upheld.
- Diagnosis: this stresses generic query understanding because typo `teh` and broad acronym `POSH` can cause retrieval to over-focus on generic POSH definitions/prohibition instead of consequence terms like punishment, disciplinary action, suspension, termination, warning, or corrective action.
- Anti-overfit rule: evaluation only; no production mapping from “POSH punishment” to a specific section or answer.

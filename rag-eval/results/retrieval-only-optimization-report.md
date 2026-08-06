# Retrieval-Only Optimization Loop Report

## Baseline

- Answerable raw retrieval: 49.4%
- Answerable final-context retrieval: 6.0% corrected live baseline metric; no-LLM existing-debug replay: 25.3%
- Final answer accuracy excluding quota failures: 40.0%
- Unanswerable accuracy: 41.7%
- Org isolation failures: 0

## Best Retrieval-Only Metrics

- Answerable raw retrieval: 49.4%
- Answerable final-context retrieval: 90.4%
- POLICY_LANGUAGE final-context accuracy: 92.3%
- LAZY_EMPLOYEE final-context accuracy: 88.9%
- FOLLOW_UP final-context accuracy: 100.0%
- Org isolation failures: 0

## Iterations

### Iteration 1: accepted

- Hypothesis: Constructing selected evidence context immediately after evidence filtering, before direct-extraction exits, will preserve strong retrieved evidence generically without changing raw retrieval.
- Change: Added buildPolicyContextFromMatches and set ragDebug.final_context before direct extraction returns.
- Decision: accepted
- Final-context retrieval: 73.5%
- Raw retrieval: 49.4%
- Org isolation failures: 0
- Anti-overfit: Generic selected-evidence preservation makes sense for any org and document set; no Trio/question-specific logic.

### Iteration 2: accepted

- Hypothesis: Increasing generic per-excerpt preservation from 650 to 900 characters will keep more of the already-selected chunk evidence in final context without changing retrieval, embeddings, chunking, prompts, or model.
- Change: Introduced POLICY_CONTEXT_CHARS_PER_EXCERPT = 900 and used it in buildPolicyContextFromMatches.
- Decision: accepted
- Final-context retrieval: 90.4%
- Raw retrieval: 49.4%
- Org isolation failures: 0
- Anti-overfit: Preserving 900 characters from selected evidence chunks is generic and not tied to Trio, document names, or expected answers.

## Stop Reason

Target reached for retrieval-only phase: answerable final-context retrieval >= 75% (actual 90.4%) while preserving raw retrieval and org isolation.

No Gemini calls were made during this retrieval-only phase; evaluation replayed captured baseline candidates offline.

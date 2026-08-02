# Corrected Trio Infra Baseline Metrics

Original baseline preserved: `rag-eval/results/baseline-2026-08-01T11-57-58-974Z.json`

## Metric Definition Bug

Overall raw_query_retrieval_accuracy used raw_query_retrieval_pass, but per-style retrieval_accuracy used retrieval_pass, which equals raw retrieval plus final-context/ranking success. These are different denominators/definitions, so 55.8% could not reconcile with per-style retrieval percentages.

## Corrected Metrics

- answerable_retrieval_accuracy: 49.4%
- answerable_final_context_retrieval_accuracy: 6.0%
- policy_language_retrieval_accuracy: 61.5%
- lazy_employee_retrieval_accuracy: 42.6%
- follow_up_retrieval_accuracy: 66.7%
- unanswerable_answer_accuracy: 41.7%
- hallucination_on_unanswerable_count: 7
- answer_accuracy_all_cases: 37.9%
- answer_accuracy_excluding_quota_failures: 40.0%
- number_of_quota_failed_cases: 5

## Query Style Retrieval (Answerable Only)

- POLICY_LANGUAGE: raw retrieval 61.5%, final-context retrieval 3.8%, answer 23.1%
- LAZY_EMPLOYEE: raw retrieval 42.6%, final-context retrieval 5.6%, answer 44.4%
- FOLLOW_UP: raw retrieval 66.7%, final-context retrieval 33.3%, answer 33.3%

Quota failed case ids:
- trio-leave-006-lazy-2
- trio-unanswerable-002-lazy-1
- trio-unanswerable-004
- trio-unanswerable-004-lazy-1
- trio-unanswerable-004-lazy-2

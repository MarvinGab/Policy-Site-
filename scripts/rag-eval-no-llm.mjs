import fs from "fs";
import path from "path";

const BASELINE_FILE = process.env.RAG_EVAL_BASELINE || "rag-eval/results/baseline-2026-08-01T11-57-58-974Z.json";
const OUT_DIR = process.env.RAG_EVAL_OUT_DIR || "rag-eval/results";
const STRATEGY = process.env.RAG_EVAL_SELECTION_STRATEGY || "selected_top6";
const CHARS_PER_EXCERPT = Number(process.env.RAG_EVAL_CONTEXT_CHARS || 900);

const normalize = (value = "") => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
const includesAny = (haystack, needles = []) => {
  const text = normalize(haystack);
  return needles.some((needle) => needle && text.includes(normalize(needle)));
};
const assertionGroupsPass = (haystack, groups = []) =>
  !Array.isArray(groups) || !groups.length
    ? Boolean(String(haystack || "").trim())
    : groups.every((group) => includesAny(haystack, Array.isArray(group) ? group : [group]));

const selectedContextFor = (row) => {
  if (STRATEGY === "existing_debug") return row.debug?.final_context || "";
  if (STRATEGY === "selected_top6") {
    return (row.retrieved_chunks || [])
      .slice(0, 6)
      .map((chunk, index) =>
        `Policy excerpt ${index + 1}\nPolicy: ${chunk.policy_name || "Unknown policy"}\nContent:\n${String(chunk.chunk_text || "").slice(0, CHARS_PER_EXCERPT)}`
      )
      .join("\n\n");
  }
  throw new Error(`Unknown RAG_EVAL_SELECTION_STRATEGY: ${STRATEGY}`);
};

const fraction = (rows, predicate) => rows.length ? rows.filter(predicate).length / rows.length : null;
const summarizeStyle = (rows, style) => {
  const scoped = rows.filter((row) => row.query_style === style);
  return {
    total: scoped.length,
    raw_retrieval_accuracy: fraction(scoped, (row) => row.raw_query_retrieval_pass),
    final_context_retrieval_accuracy: fraction(scoped, (row) => row.no_llm_final_context_pass),
  };
};

const report = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
const results = report.results.map((row) => {
  const context = selectedContextFor(row);
  const noLlmFinalContextPass = row.should_answer === false
    ? true
    : assertionGroupsPass(context, row.required_fact_groups || []);
  return {
    id: row.id,
    canonical_id: row.canonical_id,
    query_style: row.query_style,
    question: row.question,
    should_answer: row.should_answer,
    raw_query_retrieval_pass: row.raw_query_retrieval_pass,
    no_llm_final_context_pass: noLlmFinalContextPass,
    selected_context: context,
    selected_chunk_ids: (row.retrieved_chunks || []).slice(0, 6).map((chunk) => chunk.chunk_id),
  };
});
const answerable = results.filter((row) => row.should_answer !== false);
const metadataFailures = report.results.filter((row) => row.failure_category === "METADATA_FILTER_FAILURE").length;
const summary = {
  source_baseline_file: BASELINE_FILE,
  selection_strategy: STRATEGY,
  chars_per_excerpt: CHARS_PER_EXCERPT,
  answerable_cases: answerable.length,
  answerable_raw_retrieval_accuracy: fraction(answerable, (row) => row.raw_query_retrieval_pass),
  answerable_final_context_retrieval_accuracy: fraction(answerable, (row) => row.no_llm_final_context_pass),
  policy_language_final_context_accuracy: summarizeStyle(answerable, "POLICY_LANGUAGE").final_context_retrieval_accuracy,
  lazy_employee_final_context_accuracy: summarizeStyle(answerable, "LAZY_EMPLOYEE").final_context_retrieval_accuracy,
  follow_up_final_context_accuracy: summarizeStyle(answerable, "FOLLOW_UP").final_context_retrieval_accuracy,
  organization_isolation_failures: metadataFailures,
  by_query_style: {
    POLICY_LANGUAGE: summarizeStyle(answerable, "POLICY_LANGUAGE"),
    LAZY_EMPLOYEE: summarizeStyle(answerable, "LAZY_EMPLOYEE"),
    FOLLOW_UP: summarizeStyle(answerable, "FOLLOW_UP"),
  },
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(OUT_DIR, `no-llm-${STRATEGY}-${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({ generated_at: new Date().toISOString(), summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote ${outFile}`);

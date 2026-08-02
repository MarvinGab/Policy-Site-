import fs from "fs";
import path from "path";

const BASE_URL = process.env.RAG_EVAL_BASE_URL || "http://127.0.0.1:5173";
const RAW_BASE_URL = process.env.RAG_EVAL_RAW_BASE_URL || BASE_URL;
const REWRITE_BASE_URL = process.env.RAG_EVAL_REWRITE_BASE_URL || "";
const COOKIE = process.env.RAG_EVAL_COOKIE || "";
const HOST_HEADER = process.env.RAG_EVAL_HOST_HEADER || "";
const CSRF_TOKEN = process.env.RAG_EVAL_CSRF_TOKEN || "";
const DELAY_MS = Number(process.env.RAG_EVAL_DELAY_MS || 0);
const QUESTIONS_FILE = process.env.RAG_EVAL_QUESTIONS || "rag-eval/questions.json";
const OUT_DIR = process.env.RAG_EVAL_OUT_DIR || "rag-eval/results";
const ALLOWED_DOCUMENTS = new Set([
  "POSH_Policy_TRIO.pdf",
  "Code_of_Conduct_Trio.docx",
  "Holiday List.pdf",
  "Trio_Leave & Attendance_Policy.pdf",
]);

const FAILURE_CATEGORIES = {
  DOCUMENT_EXTRACTION_FAILURE: "DOCUMENT_EXTRACTION_FAILURE",
  CHUNKING_FAILURE: "CHUNKING_FAILURE",
  RETRIEVAL_FAILURE: "RETRIEVAL_FAILURE",
  METADATA_FILTER_FAILURE: "METADATA_FILTER_FAILURE",
  RANKING_FAILURE: "RANKING_FAILURE",
  PROMPT_FAILURE: "PROMPT_FAILURE",
  HALLUCINATION: "HALLUCINATION",
  AMBIGUOUS_QUESTION: "AMBIGUOUS_QUESTION",
  INFORMATION_NOT_PRESENT: "INFORMATION_NOT_PRESENT",
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const normalize = (value = "") => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
const notFoundPattern = /not in the uploaded policies|not found|not present|isn't in|is not in|does not mention|doesn't mention|not available|check with hr|could not find|don't have enough information|do not have enough information/i;

const includesAny = (haystack, needles = []) => {
  const text = normalize(haystack);
  return needles.some((needle) => needle && text.includes(normalize(needle)));
};

const groupPasses = (haystack, group = []) => includesAny(haystack, Array.isArray(group) ? group : [group]);

const assertionGroupsPass = (haystack, groups = []) => {
  if (!Array.isArray(groups) || !groups.length) return Boolean(String(haystack || "").trim());
  return groups.every((group) => groupPasses(haystack, group));
};

const hasForbiddenTerms = (haystack, terms = []) => Array.isArray(terms) && terms.length ? includesAny(haystack, terms) : false;

const expectedDocMatches = (retrievedDocuments, expectedDocument = "") => {
  if (!expectedDocument) return true;
  const expected = normalize(expectedDocument);
  return retrievedDocuments.some((doc) => normalize(doc).includes(expected) || expected.includes(normalize(doc)));
};

const chunkHasCorrectEvidence = (chunk, item) =>
  assertionGroupsPass(chunk?.chunk_text || "", item.required_fact_groups || []);

const classifyFailure = ({ item, response, retrievalPass, answerPass, finalContextPass, anyCandidatePass, metadataFilterFailure }) => {
  const answer = response.answer || "";
  const chunks = response.debug?.retrieved_chunks || [];
  if (item.ambiguous === true) return FAILURE_CATEGORIES.AMBIGUOUS_QUESTION;
  if (item.should_answer === false || item.information_present === false) {
    return answerPass ? "" : FAILURE_CATEGORIES.HALLUCINATION;
  }
  if (!chunks.length) return FAILURE_CATEGORIES.RETRIEVAL_FAILURE;
  if (metadataFilterFailure) return FAILURE_CATEGORIES.METADATA_FILTER_FAILURE;
  if (!anyCandidatePass) return FAILURE_CATEGORIES.RETRIEVAL_FAILURE;
  if (!retrievalPass) return FAILURE_CATEGORIES.RANKING_FAILURE;
  if (/not in the uploaded policies|check with hr|could not find/i.test(answer)) return FAILURE_CATEGORIES.PROMPT_FAILURE;
  if (!answerPass && finalContextPass) return FAILURE_CATEGORIES.PROMPT_FAILURE;
  if (!answerPass) return FAILURE_CATEGORIES.HALLUCINATION;
  return "";
};

const askGenie = async ({ item, baseUrl }) => {
  const rawQuestion = Object.prototype.hasOwnProperty.call(item, "raw_question") ? item.raw_question : item.question;
  const response = await fetch(`${baseUrl}/api/chat?debug=rag`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-rag-debug": "true",
      ...(HOST_HEADER ? { host: HOST_HEADER } : {}),
      ...(CSRF_TOKEN ? { "x-csrf-token": CSRF_TOKEN } : {}),
      ...(COOKIE ? { cookie: COOKIE } : {}),
    },
    body: JSON.stringify({ question: rawQuestion, history: Array.isArray(item.history) ? item.history : [] }),
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { answer: text, http_status: response.status };
  }
};

const evaluatePayload = ({ item, payload }) => {
  const chunks = payload.debug?.retrieved_chunks || payload.sources || [];
  const retrievedDocuments = chunks
    .map((chunk) => chunk.document_filename || chunk.file_path || chunk.document_id || "")
    .filter(Boolean);
  const isUnanswerable = item.should_answer === false || item.information_present === false;
  const answerPass = isUnanswerable
    ? notFoundPattern.test(payload.answer || "") && !hasForbiddenTerms(payload.answer || "", item.forbidden_answer_terms || [])
    : assertionGroupsPass(payload.answer || "", item.required_fact_groups || []) &&
      !hasForbiddenTerms(payload.answer || "", item.forbidden_answer_terms || []);
  const metadataFilterFailure = retrievedDocuments.some((doc) => {
    const normalizedDoc = normalize(doc);
    return normalizedDoc && !Array.from(ALLOWED_DOCUMENTS).some((allowed) => normalizedDoc.includes(normalize(allowed)));
  });
  const candidateChunks = chunks;
  const finalContext = payload.debug?.final_context || "";
  const anyCandidatePass = isUnanswerable ? true : candidateChunks.some((chunk) => chunkHasCorrectEvidence(chunk, item));
  const finalContextPass = isUnanswerable ? true : assertionGroupsPass(finalContext, item.required_fact_groups || []);
  const finalContextChunkIds = new Set(
    candidateChunks.filter((chunk) => finalContext && finalContext.includes(chunk.chunk_text?.slice(0, 80) || "__none__")).map((chunk) => chunk.chunk_id || chunk.id)
  );
  const retrievalPass = isUnanswerable
    ? true
    : expectedDocMatches(retrievedDocuments, item.expected_document) && anyCandidatePass;
  const rankingPass = isUnanswerable ? true : finalContextPass;
  const failureCategory = (retrievalPass && rankingPass && answerPass)
    ? ""
    : classifyFailure({
        item,
        response: payload,
        retrievalPass: rankingPass,
        answerPass,
        finalContextPass,
        anyCandidatePass,
        metadataFilterFailure,
      });

  return {
    id: item.id || "",
    canonical_id: item.canonical_id || item.id || "",
    query_style: item.query_style || "",
    question: Object.prototype.hasOwnProperty.call(item, "raw_question") ? item.raw_question : item.question,
    history: Array.isArray(item.history) ? item.history : [],
    expected_document: item.expected_document || "",
    expected_section_or_fact: item.expected_fact || item.expected_section_or_fact || "",
    required_fact_groups: item.required_fact_groups || [],
    should_answer: item.should_answer !== false,
    retrieved_documents: retrievedDocuments,
    retrieved_chunks: chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id || chunk.id,
      document_id: chunk.document_id || null,
      document_filename: chunk.document_filename || null,
      policy_id: chunk.policy_id || null,
      policy_name: chunk.policy_name || null,
      section_heading: chunk.section_heading || null,
      page_number: chunk.page_number || null,
      chunk_text: chunk.chunk_text || "",
    })),
    retrieval_scores: chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id || chunk.id,
      similarity: chunk.similarity_score ?? chunk.similarity ?? null,
      hybrid_score: chunk.hybrid_score ?? null,
      evidence_score: chunk.evidence_score ?? null,
    })),
    generated_answer: payload.answer || "",
    raw_retrieval_candidate_pass: retrievalPass,
    final_context_pass: rankingPass,
    retrieval_pass: retrievalPass && rankingPass,
    answer_pass: answerPass,
    failure_category: failureCategory,
    notes: item.notes || "",
    debug: payload.debug || null,
  };
};

const runQuestion = async (item) => {
  const rawPayload = await askGenie({ item, baseUrl: RAW_BASE_URL });
  const rawResult = evaluatePayload({ item, payload: rawPayload });
  let rewriteResult = null;
  if (REWRITE_BASE_URL) {
    const rewritePayload = await askGenie({ item, baseUrl: REWRITE_BASE_URL });
    rewriteResult = evaluatePayload({ item, payload: rewritePayload });
  }
  return {
    ...rawResult,
    raw_query_retrieval_pass: rawResult.raw_retrieval_candidate_pass,
    rewritten_query_retrieval_pass: rewriteResult ? rewriteResult.raw_retrieval_candidate_pass : null,
    final_answer_correct: rawResult.answer_pass,
    rewritten_query_result: rewriteResult,
  };
};

const summarize = (results) => {
  const total = results.length || 1;
  const failures = results.filter((row) => !row.retrieval_pass || !row.answer_pass);
  const answerable = results.filter((row) => row.should_answer !== false);
  const unanswerable = results.filter((row) => row.should_answer === false);
  const quotaFailures = results.filter(isQuotaFailure);
  const nonQuota = results.filter((row) => !isQuotaFailure(row));
  const categoryCounts = failures.reduce((acc, row) => {
    const key = row.failure_category || "UNCLASSIFIED";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    total_questions: results.length,
    answerable_questions: answerable.length,
    unanswerable_questions: unanswerable.length,
    raw_query_retrieval_accuracy: results.filter((row) => row.raw_query_retrieval_pass).length / total,
    answerable_retrieval_accuracy: fraction(answerable, (row) => row.raw_query_retrieval_pass),
    answerable_final_context_retrieval_accuracy: fraction(answerable, (row) => row.retrieval_pass),
    policy_language_retrieval_accuracy: fraction(answerable.filter((row) => row.query_style === "POLICY_LANGUAGE"), (row) => row.raw_query_retrieval_pass),
    lazy_employee_retrieval_accuracy: fraction(answerable.filter((row) => row.query_style === "LAZY_EMPLOYEE"), (row) => row.raw_query_retrieval_pass),
    follow_up_retrieval_accuracy: fraction(answerable.filter((row) => row.query_style === "FOLLOW_UP"), (row) => row.raw_query_retrieval_pass),
    rewritten_query_retrieval_accuracy: results.some((row) => row.rewritten_query_retrieval_pass !== null)
      ? results.filter((row) => row.rewritten_query_retrieval_pass).length / total
      : null,
    retrieval_accuracy: results.filter((row) => row.retrieval_pass).length / total,
    answer_accuracy: results.filter((row) => row.answer_pass).length / total,
    final_answer_accuracy: results.filter((row) => row.final_answer_correct).length / total,
    answer_accuracy_all_cases: results.filter((row) => row.answer_pass).length / total,
    answer_accuracy_excluding_quota_failures: fraction(nonQuota, (row) => row.answer_pass),
    number_of_quota_failed_cases: quotaFailures.length,
    unanswerable_accuracy: unanswerable.length
      ? unanswerable.filter((row) => row.answer_pass).length / unanswerable.length
      : null,
    unanswerable_answer_accuracy: fraction(unanswerable, (row) => row.answer_pass),
    hallucination_on_unanswerable_count: unanswerable.filter((row) => row.failure_category === FAILURE_CATEGORIES.HALLUCINATION).length,
    hallucination_count: failures.filter((row) => row.failure_category === FAILURE_CATEGORIES.HALLUCINATION).length,
    unanswered_questions: results.filter((row) => /not in the uploaded policies|check with hr|could not find/i.test(row.generated_answer)).length,
    wrong_document_retrievals: failures.filter((row) => row.failure_category === FAILURE_CATEGORIES.METADATA_FILTER_FAILURE).length,
    top_recurring_failure_categories: Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count })),
    accuracy_by_query_style: summarizeBy(results, "query_style"),
    accuracy_by_canonical_id: summarizeBy(results, "canonical_id"),
  };
};

const fraction = (rows, predicate) => rows.length ? rows.filter(predicate).length / rows.length : null;

const isQuotaFailure = (row) =>
  /chat service is busy|rate_limited|quota|busy right now/i.test(row?.generated_answer || "") ||
  /chat service is busy|rate_limited|quota|busy right now/i.test(row?.debug?.final_answer || "");

const summarizeBy = (results, key) =>
  Object.fromEntries(
    Object.entries(
      results.reduce((acc, row) => {
        const value = row[key] || "(none)";
        const bucket = acc[value] || { total: 0, raw_query_retrieval_pass: 0, final_context_retrieval_pass: 0, final_answer_correct: 0 };
        bucket.total += 1;
        if (row.raw_query_retrieval_pass) bucket.raw_query_retrieval_pass += 1;
        if (row.retrieval_pass) bucket.final_context_retrieval_pass += 1;
        if (row.final_answer_correct) bucket.final_answer_correct += 1;
        acc[value] = bucket;
        return acc;
      }, {})
    ).map(([value, bucket]) => [
      value,
      {
        total: bucket.total,
        raw_query_retrieval_accuracy: bucket.raw_query_retrieval_pass / bucket.total,
        final_context_retrieval_accuracy: bucket.final_context_retrieval_pass / bucket.total,
        answer_accuracy: bucket.final_answer_correct / bucket.total,
      },
    ])
  );

if (!fs.existsSync(QUESTIONS_FILE)) {
  console.error(`Missing ${QUESTIONS_FILE}. Copy rag-eval/questions.sample.json to ${QUESTIONS_FILE} and fill in fixed expectations.`);
  process.exit(1);
}
if (!COOKIE) {
  console.error("Missing RAG_EVAL_COOKIE. Sign in, then pass the zarohr.sid cookie so the script uses the same authenticated Genie endpoint.");
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const questions = readJson(QUESTIONS_FILE);
const results = [];
for (let i = 0; i < questions.length; i += 1) {
  const item = questions[i];
  results.push(await runQuestion(item));
  if (DELAY_MS > 0 && i < questions.length - 1) {
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
}

const report = {
  generated_at: new Date().toISOString(),
  base_url: BASE_URL,
  raw_base_url: RAW_BASE_URL,
  rewrite_base_url: REWRITE_BASE_URL || null,
  delay_ms: DELAY_MS,
  questions_file: QUESTIONS_FILE,
  summary: summarize(results),
  results,
};
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(OUT_DIR, `baseline-${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Wrote ${outFile}`);

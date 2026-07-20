import "dotenv/config";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const rootUrl = `http://${process.env.ROOT_HOST || "localhost"}:${process.env.PORT || 5183}`;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const runId = Date.now().toString(36);
const employeeCode = `E2E${runId}`.toUpperCase();
const employeeEmail = `e2e-${runId}@example.invalid`;
const temporaryPassword = `Tmp-${runId}-A9!`;
const permanentPassword = `Prod-${runId}-B8!`;
const results = [];
let testPersonId = null;
let testTemplateId = null;
let originalDefaultTemplateId = null;
let testCompanyId = null;
let expectedUploadedPolicies = 0;
let generatedEmployeeLoginUrl = "";

const check = (condition, name, detail = "") => {
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
  results.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` (${detail})` : ""}`);
};

const waitForApp = async (page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => document.body?.dataset?.page);
};

const waitForPolicyRail = async (page) => {
  await page.waitForFunction(() => {
    if (document.querySelector(".policy-module-card")) return true;
    const status = document.querySelector(".policy-rail-loading")?.textContent || "";
    return status && !/^Loading/.test(status);
  }, null, { timeout: 15_000 });
};

const browser = await chromium.launch({ headless: true });

try {
  const { data: companies, error: companyError } = await supabase
    .from("companies")
    .select("id, name, slug, access_mode")
    .eq("access_mode", "standalone");
  if (companyError) throw companyError;

  let company = null;
  for (const candidate of companies || []) {
    const { count } = await supabase
      .from("policy_documents")
      .select("id", { count: "exact", head: true })
      .eq("company_id", candidate.id);
    if ((count || 0) > 0) {
      company = candidate;
      break;
    }
  }
  check(Boolean(company), "Standalone organization with uploaded policies exists");
  testCompanyId = company.id;
  const { data: uploadedRows, error: uploadedError } = await supabase
    .from("policy_documents")
    .select("policy_id")
    .eq("company_id", company.id);
  if (uploadedError) throw uploadedError;
  expectedUploadedPolicies = new Set((uploadedRows || []).map((row) => row.policy_id).filter(Boolean)).size;

  const { data: person, error: personError } = await supabase
    .from("org_people")
    .insert({
      company_id: company.id,
      employee_code: employeeCode,
      email: employeeEmail,
      name: "Chromium Test Employee",
      role: "employee",
      status: "active",
      password_hash: await bcrypt.hash(temporaryPassword, 10),
      must_reset_password: true,
      password_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (personError) throw personError;
  testPersonId = person.id;

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const adminPage = await adminContext.newPage();
  const adminErrors = [];
  const adminHttpErrors = [];
  adminPage.on("console", (message) => {
    if (message.type() === "error") adminErrors.push(message.text());
  });
  adminPage.on("pageerror", (error) => adminErrors.push(error.message));
  adminPage.on("response", (response) => {
    if (response.status() >= 400) adminHttpErrors.push(`${response.status()} ${response.url()}`);
  });

  await adminPage.goto(`${rootUrl}/index.html#login`);
  await waitForApp(adminPage);
  await adminPage.locator("[data-email]").fill(process.env.ADMIN_EMAIL);
  await adminPage.locator("[data-password]").fill(process.env.ADMIN_PASSWORD);
  await adminPage.locator("#login-form").evaluate((form) => form.requestSubmit());
  await adminPage.waitForURL(/orgs\.html/, { timeout: 15_000 });
  await adminPage.waitForSelector(".org-card");
  check(await adminPage.locator(".org-card").count() > 0, "Super-admin login and organization list");

  const targetCard = adminPage.locator(`.org-card[data-org-slug="${company.slug}"]`);
  check(await targetCard.count() === 1, "Target organization appears in admin portal", company.name);
  await targetCard.click();
  await adminPage.waitForURL(/policies\.html/, { timeout: 15_000 });
  await waitForPolicyRail(adminPage);
  check(await adminPage.locator(".policy-module-card").count() > 0, "Admin can open organization policies");
  await adminPage.waitForLoadState("networkidle");
  const orgSettings = await adminPage.evaluate(() =>
    fetch("/api/org/settings").then((response) => response.json())
  );
  generatedEmployeeLoginUrl = orgSettings.login_url;
  check(
    generatedEmployeeLoginUrl === `${rootUrl.replace("://", `://${company.slug}.`)}/index.html#login`,
    "Organization login link is absolute and org-scoped",
    generatedEmployeeLoginUrl
  );

  await adminPage.goto(`${rootUrl}/policy-admin.html#communication`);
  await adminPage.waitForSelector('[data-admin-section="communication"].is-active');
  await adminPage.waitForSelector(".template-list-item");
  check(await adminPage.locator("[data-people-list]:visible").count() === 0, "Communication does not show employee rows");
  const originalTemplates = await adminPage.evaluate(() =>
    fetch("/api/org/email-templates").then((response) => response.json())
  );
  const originalDefaultId = originalTemplates.find((template) => template.is_default)?.id;
  originalDefaultTemplateId = originalDefaultId || null;
  const templateCountBefore = originalTemplates.length;
  await adminPage.locator("[data-action='template-create']").click();
  await adminPage.waitForFunction(
    (count) => document.querySelectorAll(".template-list-item").length === count + 1,
    templateCountBefore
  );
  testTemplateId = await adminPage.locator(".template-list-item.is-selected").getAttribute("data-template-id");
  await adminPage.locator("[data-template-form] input[name='name']").fill(`Chromium template ${runId}`);
  await adminPage.locator("[data-template-form] input[name='subject']").fill("Test {{org_name}} invitation");
  await adminPage.locator("[data-template-form] textarea[name='body']").fill("Hi {{name}}, use {{login_url}}.");
  await adminPage.locator("[data-template-form] input[name='is_default']").check();
  await adminPage.locator("[data-template-form]").evaluate((form) => form.requestSubmit());
  await adminPage.waitForFunction(
    (name) => [...document.querySelectorAll(".template-list-item")].some((item) => item.textContent.includes(name) && item.textContent.includes("Active")),
    `Chromium template ${runId}`
  );
  check(
    await adminPage.locator(".template-list-item").count() === templateCountBefore + 1,
    "Communication template can be created, saved, and activated"
  );
  await adminPage.screenshot({ path: "test-results/chromium-communication.png", fullPage: true });
  if (originalDefaultId) {
    await adminPage.evaluate((id) =>
      fetch(`/api/org/email-templates/${id}/default`, { method: "POST" }).then((response) => {
        if (!response.ok) throw new Error("Could not restore active template");
      }), originalDefaultId);
  }
  await adminPage.evaluate((id) =>
    fetch(`/api/org/email-templates/${id}`, { method: "DELETE" }).then((response) => {
      if (!response.ok) throw new Error("Could not clean up test template");
    }), testTemplateId);
  testTemplateId = null;

  const adminSession = await adminPage.evaluate(() => fetch("/api/session").then((response) => response.json()));
  const unexpectedAdminErrors = adminHttpErrors.filter((entry) => !entry.includes("/api/session"));
  check(
    adminErrors.length === 0 || (adminErrors.length === 1 && adminHttpErrors.some((entry) => entry.includes("/api/session"))),
    "Admin pages have no unexplained browser errors",
    [...adminErrors, ...unexpectedAdminErrors].join(" | ")
  );
  check(unexpectedAdminErrors.length === 0, "Admin workflow has no unexpected HTTP errors", unexpectedAdminErrors.join(" | "));
  adminErrors.length = 0;
  const csrfStatus = await adminContext.request.post(`${rootUrl}/api/logout`, {
    headers: { Origin: rootUrl },
  });
  check(csrfStatus.status() === 403, "Authenticated mutation without CSRF token is rejected");
  check(Boolean(adminSession.csrfToken), "Authenticated session issues CSRF token");
  await adminContext.close();

  const orgUrl = `http://${company.slug}.${process.env.ROOT_HOST || "localhost"}:${process.env.PORT || 5183}`;
  const employeeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const employeePage = await employeeContext.newPage();
  const employeeErrors = [];
  const employeeHttpErrors = [];
  const failedRequests = [];
  employeePage.on("console", (message) => {
    if (message.type() === "error") employeeErrors.push(message.text());
  });
  employeePage.on("pageerror", (error) => employeeErrors.push(error.message));
  employeePage.on("response", (response) => {
    if (response.status() >= 400) employeeHttpErrors.push(`${response.status()} ${response.url()}`);
  });
  employeePage.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`));

  await employeePage.goto(`${orgUrl}/policies.html`);
  await employeePage.waitForURL(/index\.html#login/, { timeout: 15_000 });
  check(true, "Unauthenticated employee is redirected to login");
  employeeErrors.length = 0;

  await employeePage.goto(generatedEmployeeLoginUrl);
  await employeePage.waitForSelector('#login[data-login-mode="standalone"]');
  check(employeePage.url() === generatedEmployeeLoginUrl, "Generated employee link opens the organization login");
  await employeePage.locator("[data-email]").fill(employeeCode);
  await employeePage.locator("[data-password]").fill(temporaryPassword);
  await employeePage.locator("#login-form").evaluate((form) => form.requestSubmit());
  await employeePage.waitForSelector("[data-first-login]");
  check(true, "Temporary password triggers mandatory password replacement");

  await employeePage.locator("[data-first-login] input[name='password']").fill(permanentPassword);
  await employeePage.locator("[data-first-login] input[name='confirm']").fill(permanentPassword);
  await employeePage.locator("[data-first-login]").evaluate((form) => form.requestSubmit());
  await employeePage.waitForURL(/policies\.html/, { timeout: 15_000 });
  await waitForPolicyRail(employeePage);
  check(await employeePage.locator(".policy-module-card").count() > 0, "Employee can load organization policies");
  const policyCounter = await employeePage.locator("[data-policy-total]").innerText();
  check(
    policyCounter.includes(`${expectedUploadedPolicies} ${expectedUploadedPolicies === 1 ? "policy" : "policies"}`),
    "Header counts only policies with uploaded documents",
    policyCounter
  );
  check(await employeePage.locator("[data-super-admin-only]").count() === 0, "Employee cannot see super-admin controls");
  check(await employeePage.locator(".add-policy-btn").count() === 0, "Employee dashboard has no management buttons");
  const employeeAdminStatus = await employeePage.evaluate(() =>
    fetch("/api/org/people").then((response) => response.status)
  );
  check(employeeAdminStatus === 403, "Employee is rejected by admin API");

  await employeePage.locator(".chatbot-toggle").click();
  const botCountBefore = await employeePage.locator(".chatbot-message.bot").count();
  await employeePage.locator(".chatbot-input").fill("Which policy documents are uploaded?");
  await employeePage.locator(".chatbot-form").evaluate((form) => form.requestSubmit());
  await employeePage.waitForFunction((previousCount) => {
    const messages = [...document.querySelectorAll(".chatbot-message.bot")];
    const last = messages.at(-1);
    return messages.length > previousCount && last && !last.classList.contains("is-pending") && !/^Thinking/.test(last.textContent || "");
  }, botCountBefore, { timeout: 30_000 });
  const botAnswer = await employeePage.locator(".chatbot-message.bot").last().innerText();
  check(!/failed|try again|too long/i.test(botAnswer), "Chatbot returns a policy-backed response", botAnswer.slice(0, 100));

  await employeePage.getByRole("button", { name: "Logout" }).click();
  await employeePage.waitForURL(/index\.html/, { timeout: 15_000 });
  await employeePage.waitForFunction(async () => {
    const response = await fetch("/api/session");
    return response.status === 401;
  }, null, { timeout: 10_000 });
  const loggedOutStatus = await employeePage.evaluate(() => fetch("/api/session").then((response) => response.status));
  check(loggedOutStatus === 401, "Logout destroys employee session");
  employeeErrors.length = 0;

  await employeePage.waitForSelector('#login[data-login-mode="standalone"]');
  await employeePage.locator("[data-email]").fill(employeeCode);
  await employeePage.locator("[data-password]").fill(permanentPassword);
  await employeePage.locator("#login-form").evaluate((form) => form.requestSubmit());
  await employeePage.waitForURL(/policies\.html/, { timeout: 15_000 });
  check(true, "Employee can sign in with replacement password");

  const unexpectedEmployeeHttpErrors = employeeHttpErrors.filter(
    (entry) =>
      !(
        (entry.startsWith("401 ") && (entry.includes("/api/session") || entry.includes("/api/org/access")))
        || (entry.startsWith("403 ") && entry.includes("/api/org/people"))
      )
  );
  check(
    employeeErrors.every((entry) => /status of 401/.test(entry)),
    "Employee pages have no unexplained browser errors",
    employeeErrors.join(" | ")
  );
  check(
    unexpectedEmployeeHttpErrors.length === 0,
    "Employee workflow has no unexpected HTTP errors",
    unexpectedEmployeeHttpErrors.join(" | ")
  );
  check(failedRequests.length === 0, "Employee workflow has no failed network requests", failedRequests.join(" | "));

  await employeePage.setViewportSize({ width: 390, height: 844 });
  await employeePage.reload();
  await waitForPolicyRail(employeePage);
  await employeePage.screenshot({ path: "test-results/chromium-mobile.png", fullPage: true });
  const overflow = await employeePage.evaluate(() => {
    const viewport = window.innerWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].map((name) => `.${name}`).join("")}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.right > viewport + 1 || item.left < -1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 8);
    return {
      hasOverflow: document.documentElement.scrollWidth > viewport + 1,
      viewport,
      scrollWidth: document.documentElement.scrollWidth,
      offenders,
    };
  });
  check(
    !overflow.hasOverflow,
    "Policy portal has no horizontal overflow on mobile",
    JSON.stringify(overflow)
  );
  await employeeContext.close();

  console.log(`\n${results.length} Chromium checks passed.`);
} finally {
  if (testTemplateId) {
    await supabase.from("org_email_templates").delete().eq("id", testTemplateId);
  }
  if (originalDefaultTemplateId) {
    await supabase
      .from("org_email_templates")
      .update({ is_default: false })
      .eq("company_id", testCompanyId)
      .neq("id", originalDefaultTemplateId);
    await supabase.from("org_email_templates").update({ is_default: true }).eq("id", originalDefaultTemplateId);
  }
  if (testPersonId) {
    await supabase.from("org_people").delete().eq("id", testPersonId);
  }
  await browser.close();
}

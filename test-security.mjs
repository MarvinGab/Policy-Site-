import { chromium } from "playwright";
import fs from "fs";
import crypto from "crypto";
const env = Object.fromEntries(
  fs.readFileSync("/Users/marvin/Desktop/PolicySite/.env", "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const BASE = `http://localhost:${env.PORT || 5183}`;
const SESSIONS_DIR = "/Users/marvin/Desktop/PolicySite/.sessions";
const log = (...a) => console.log("[sec]", ...a);
const fails = [];

const browser = await chromium.launch({ headless: true });
const superCtx = await browser.newContext();
const superPage = await superCtx.newPage();
await superPage.goto(`${BASE}/index.html#login`);
await superPage.fill('input[data-email]', env.ADMIN_EMAIL);
await superPage.fill('input[data-password]', env.ADMIN_PASSWORD);
await superPage.click('button[data-submit]');
await superPage.waitForURL(/orgs\.html/);
await superPage.waitForSelector("[data-org-id]");
const orgId = await superPage.$eval("[data-org-id]", (el) => el.dataset.orgId);
const orgSlug = await superPage.$eval(`[data-org-id="${orgId}"]`, (el) => el.dataset.orgSlug);
await superPage.click(`[data-org-id="${orgId}"]`);
await superPage.waitForURL(/policies\.html|policy-admin\.html/);
await superPage.goto(`${BASE}/policy-admin.html#people`, { waitUntil: "networkidle" });
await superPage.waitForSelector('[data-register-toggle="add-employee"]');

const stamp = crypto.randomBytes(3).toString("hex");
const email = `sec+${stamp}@ex.test`;
const code = `SEC${stamp.toUpperCase()}`;

await superPage.click('[data-register-toggle="add-employee"]');
await superPage.waitForSelector('[data-register-panel="add-employee"]:not([hidden])');
await superPage.fill('[data-people-form] input[name="employee_code"]', code);
await superPage.fill('[data-people-form] input[name="name"]', "Sec User");
await superPage.fill('[data-people-form] input[name="email"]', email);
const [addResp] = await Promise.all([
  superPage.waitForResponse((r) => r.url().endsWith("/api/org/people") && r.request().method() === "POST"),
  superPage.click('[data-people-form] button[type="submit"]'),
]);
const addBody = await addResp.json();
const first = Array.isArray(addBody) ? addBody[0] : addBody;
const tempPassword = first?.temporary_password;
log(`created ${email} pw_present=${Boolean(tempPassword)} email_error=${first?.email_error || "none"}`);
if (!tempPassword) { fails.push("No temp password returned from add-employee"); }

const subOrigin = `http://${orgSlug}.${env.ROOT_HOST || "localhost"}:${env.PORT || 5183}`;

// -------- Test A: temp password login works, then must_reset gate blocks --------
log("--- A: must_reset gate ---");
const loginResp = await fetch(`${subOrigin}/api/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userid: email, password: tempPassword }),
});
const loginJson = await loginResp.json().catch(() => ({}));
log(`login → ${loginResp.status} must_reset_password=${loginJson.must_reset_password}`);
if (loginResp.status !== 200) fails.push(`Login failed (${loginResp.status})`);
if (!loginJson.must_reset_password) fails.push("must_reset_password not signalled in login response");

const setCookie = loginResp.headers.get("set-cookie") || "";
const cookie = setCookie.split(",").map((s) => s.split(";")[0]).join("; ");

const protectedResp = await fetch(`${subOrigin}/api/org/dashboard`, { headers: { Cookie: cookie } });
const protectedText = await protectedResp.text();
log(`protected /api/org/dashboard → ${protectedResp.status}`);
if (protectedResp.status !== 403) fails.push(`Protected route allowed while must_reset (${protectedResp.status}: ${protectedText.slice(0, 80)})`);
if (!protectedText.includes("must_reset_password")) fails.push("Gate response missing must_reset_password code");

const sessionResp = await fetch(`${subOrigin}/api/session`, { headers: { Cookie: cookie } });
log(`allowed /api/session → ${sessionResp.status}`);
if (sessionResp.status !== 200) fails.push(`/api/session refused while must_reset (${sessionResp.status})`);

const changeResp = await fetch(`${subOrigin}/api/password/change`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ password: "newpassword123" }),
});
log(`allowed /api/password/change → ${changeResp.status}`);
if (changeResp.status !== 200) fails.push(`Password change refused while must_reset (${changeResp.status})`);

// After change, must_reset gate should be lifted → protected routes allowed.
const afterProtected = await fetch(`${subOrigin}/api/org/dashboard`, { headers: { Cookie: cookie } });
log(`after change: protected → ${afterProtected.status}`);
if (afterProtected.status === 403) {
  const body = await afterProtected.text();
  if (body.includes("must_reset_password")) fails.push("must_reset gate not lifted after password change");
}

// -------- Test B: session-file nuke on delete-many --------
log("--- B: session nuke on delete ---");
const filesBefore = fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json")).length : 0;
log(`session files before delete: ${filesBefore}`);

await superPage.reload();
await superPage.click('[data-select-mode="delete"]');
await superPage.waitForTimeout(120);
const cb = await superPage.$(`.person-row:has-text("${email}") input[data-person-checkbox]`);
if (!cb) fails.push("Could not find row to delete");
else {
  await cb.check();
  const [delResp] = await Promise.all([
    superPage.waitForResponse((r) => r.url().endsWith("/delete-many")),
    (async () => {
      await superPage.click("[data-selection-confirm]");
      await superPage.waitForTimeout(150);
      const btn = await superPage.$('.confirm-dialog-backdrop [data-dialog="confirm"]');
      if (btn) await btn.click();
    })(),
  ]);
  const body = await delResp.json();
  log(`delete-many: ${JSON.stringify(body)}`);
  if (body.deleted !== 1) fails.push(`deleted=${body.deleted}, expected 1`);
  if (typeof body.sessions_invalidated !== "number") fails.push("sessions_invalidated missing from response");
  if (body.sessions_invalidated < 1) fails.push(`sessions_invalidated=${body.sessions_invalidated}, expected ≥1`);
}

const filesAfter = fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json")).length : 0;
log(`session files after delete: ${filesAfter}`);

// -------- Test C: temp password TTL flag on issuance --------
log("--- C: temp password TTL ---");
// Add a fresh employee and verify a temp password expiry timestamp exists in DB.
// (We can't hit the DB directly here — but we can verify the row was created
// without an "email_error" mentioning the column, and login should show
// must_reset_password=true from a fresh temp password.)
const stamp2 = crypto.randomBytes(3).toString("hex");
const email2 = `ttl+${stamp2}@ex.test`;
const code2 = `TTL${stamp2.toUpperCase()}`;
await superPage.reload();
await superPage.waitForSelector('[data-register-toggle="add-employee"]');
await superPage.click('[data-register-toggle="add-employee"]');
await superPage.waitForSelector('[data-register-panel="add-employee"]:not([hidden])');
await superPage.fill('[data-people-form] input[name="employee_code"]', code2);
await superPage.fill('[data-people-form] input[name="email"]', email2);
const [addResp2] = await Promise.all([
  superPage.waitForResponse((r) => r.url().endsWith("/api/org/people") && r.request().method() === "POST"),
  superPage.click('[data-people-form] button[type="submit"]'),
]);
const body2 = await addResp2.json();
const first2 = Array.isArray(body2) ? body2[0] : body2;
log(`TTL issuance: id=${first2?.id ? "ok" : "missing"} error=${first2?.email_error || "none"}`);
if (first2?.email_error?.includes("password_expires_at")) fails.push("password_expires_at column still missing in DB");

// Cleanup: delete TTL user too
await superPage.reload();
await superPage.click('[data-select-mode="delete"]');
await superPage.waitForTimeout(120);
const cb2 = await superPage.$(`.person-row:has-text("${email2}") input[data-person-checkbox]`);
if (cb2) {
  await cb2.check();
  await superPage.click("[data-selection-confirm]");
  await superPage.waitForTimeout(150);
  const btn = await superPage.$('.confirm-dialog-backdrop [data-dialog="confirm"]');
  if (btn) await btn.click();
  await superPage.waitForTimeout(400);
}

await browser.close();

if (fails.length) {
  console.error("\n=== FAILURES ===");
  fails.forEach((f) => console.error(" -", f));
  process.exit(2);
}
console.log("\n=== PASS — security hardening verified ===");

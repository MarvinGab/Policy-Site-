import "dotenv/config";
import crypto from "crypto";
import express from "express";
import session from "express-session";
import sessionFileStore from "session-file-store";
import multer from "multer";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { ORG_TEMPLATE } from "./org-template.js";

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? null : "dev-session-secret");
const PORT = Number(process.env.PORT || 5173);
// The "root" hostname. Anything under "*.<ROOT_HOST>" is treated as a per-org subdomain.
// Dev default is "localhost"; prod will be e.g. "policies.zarohr.com".
const ROOT_HOST = (process.env.ROOT_HOST || "localhost").toLowerCase();
if (IS_PRODUCTION && (ROOT_HOST === "localhost" || ROOT_HOST.endsWith(".localhost"))) {
  throw new Error("ROOT_HOST must be the production parent domain when NODE_ENV=production.");
}
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash-lite";
const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
const CHAT_CACHE_VERSION = "v2";
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 18000);
const CHAT_ENABLE_QUERY_REWRITE = process.env.CHAT_ENABLE_QUERY_REWRITE === "true";
const CHAT_DAILY_CAP_PER_ORG = Number(process.env.CHAT_DAILY_CAP_PER_ORG || 200);
const CHAT_CACHE_TTL_MS = Number(process.env.CHAT_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const SESSION_STORE = (process.env.SESSION_STORE || (IS_PRODUCTION ? "supabase" : "file")).toLowerCase();
const HRMS_LAUNCH_SECRET = process.env.HRMS_LAUNCH_SECRET || (IS_PRODUCTION ? "" : SESSION_SECRET);
// Comma-separated parent origins permitted to iframe this app — e.g.
// "https://hrms.acme.com,https://app.workday.com". When set, the session
// cookie is issued as SameSite=None (required for cross-site iframes) and a
// matching Content-Security-Policy frame-ancestors header is sent.
const HRMS_EMBED_ORIGINS = (process.env.HRMS_EMBED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const HRMS_EMBED_MODE = HRMS_EMBED_ORIGINS.length > 0;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
// Last-resort fallback used only when the password_hash column is missing
// from org_people. Real employees get a unique random token issued via
// generateAccessToken() and emailed on creation.
const SMTP_ENCRYPTION_KEY = process.env.SMTP_ENCRYPTION_KEY || (IS_PRODUCTION ? "" : SESSION_SECRET);
// Per-user daily chat cap. With 50 active users × 20 = 1000, this stays inside
// the Gemini free-tier 1000 requests/day ceiling. Super-admin is exempt.
const CHAT_DAILY_CAP_PER_USER = Number(process.env.CHAT_DAILY_CAP_PER_USER || 20);
const GLOBAL_SMTP = {
  host: process.env.SMTP_HOST || "",
  port: Number(process.env.SMTP_PORT || 0) || 587,
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
  from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  fromName: process.env.FROM_NAME || "ZaroHR",
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

if (!SESSION_SECRET) {
  console.error("Missing SESSION_SECRET in environment (required in production).");
  process.exit(1);
}

if (!ADMIN_EMAIL || (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH)) {
  console.error("Missing ADMIN_EMAIL and ADMIN_PASSWORD/ADMIN_PASSWORD_HASH in environment.");
  process.exit(1);
}

if (IS_PRODUCTION && !SMTP_ENCRYPTION_KEY) {
  console.error("Missing SMTP_ENCRYPTION_KEY in environment (required in production).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

class SupabaseSessionStore extends session.Store {
  async get(sid, callback) {
    try {
      const { data, error } = await supabase
        .from("app_sessions")
        .select("sess, expire")
        .eq("sid", sid)
        .maybeSingle();
      if (error) return callback(error);
      if (!data || new Date(data.expire).getTime() <= Date.now()) return callback(null, null);
      return callback(null, data.sess);
    } catch (error) {
      return callback(error);
    }
  }

  async set(sid, sess, callback) {
    try {
      const maxAge = sess?.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000;
      const expire = new Date(Date.now() + maxAge).toISOString();
      const { error } = await supabase
        .from("app_sessions")
        .upsert({ sid, sess, expire }, { onConflict: "sid" });
      return callback(error || null);
    } catch (error) {
      return callback(error);
    }
  }

  async destroy(sid, callback) {
    try {
      const { error } = await supabase.from("app_sessions").delete().eq("sid", sid);
      return callback(error || null);
    } catch (error) {
      return callback(error);
    }
  }

  async touch(sid, sess, callback) {
    return this.set(sid, sess, callback);
  }
}

const app = express();
app.disable("x-powered-by");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// 12mb covers base64-encoded tile images (a 9mb PNG balloons to ~12mb in base64).
// Multer-handled multipart uploads aren't gated by this — they have their own
// limit set at upload() construction time.
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (IS_PRODUCTION) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
});

const getOriginHeader = (req) => req.get("origin") || "";

const isAllowedRequestOrigin = (req, originValue) => {
  if (!originValue) return true;
  try {
    const origin = new URL(originValue);
    const host = req.hostname.toLowerCase();
    const originHost = origin.hostname.toLowerCase();
    return originHost === host;
  } catch {
    return false;
  }
};

const requireSameOriginMutation = (req, res, next) => {
  if (!["POST", "PATCH", "DELETE", "PUT"].includes(req.method)) return next();
  const origin = getOriginHeader(req);
  const referer = req.get("referer") || "";
  let refererOrigin = "";
  try {
    refererOrigin = referer ? new URL(referer).origin : "";
  } catch {
    refererOrigin = "invalid";
  }
  if (!isAllowedRequestOrigin(req, origin || refererOrigin)) {
    return res.status(403).send("Cross-site request blocked.");
  }
  return next();
};

app.use(requireSameOriginMutation);
if (IS_PRODUCTION) {
  app.set("trust proxy", 1);
}

// Sessions persist to ./sessions/*.json on disk so they survive nodemon restarts
// (no more "logged out every time I save a file"). 30-day cookie lifetime
// matches the Amazon-style "remember me" we agreed on.
const FileStore = sessionFileStore(session);
const sessionStore = SESSION_STORE === "supabase"
  ? new SupabaseSessionStore()
  : new FileStore({
      path: path.resolve(fileURLToPath(import.meta.url), "..", "..", ".sessions"),
      ttl: 60 * 60 * 24 * 30, // 30 days, in seconds
      reapInterval: 60 * 60, // clean expired sessions hourly
      retries: 0,
    });
app.use(
  session({
    name: "zarohr.sid",
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true, // refresh the cookie on every request
    cookie: {
      httpOnly: true,
      // SameSite=None is required for the cookie to be sent inside a
      // cross-origin iframe (HRMS embed). It only works alongside Secure=true,
      // which the IS_PRODUCTION gate enforces. In dev mode we keep Lax so
      // local testing isn't blocked by missing HTTPS.
      sameSite: IS_PRODUCTION ? "none" : "lax",
      secure: IS_PRODUCTION,
      domain: IS_PRODUCTION ? `.${ROOT_HOST}` : undefined,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

// Rotate the session identifier whenever authentication succeeds. This prevents
// a pre-authentication session cookie from being reused after login.
const establishAuthenticatedSession = async (req, user) => {
  await new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
  req.session.user = user;
};

const ensureCsrfToken = (req) => {
  if (!req.session) return "";
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString("base64url");
  return req.session.csrfToken;
};

const CSRF_EXEMPT_PATHS = new Set([
  "/api/login",
  "/api/password/forgot",
  "/api/password/verify-otp",
  "/api/password/reset",
  "/api/hrms/test",
]);

const requireCsrfToken = (req, res, next) => {
  if (!["POST", "PATCH", "DELETE", "PUT"].includes(req.method)) return next();
  if (!req.session?.user) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
  const expected = ensureCsrfToken(req);
  const received = req.get("x-csrf-token") || "";
  if (!received || received !== expected) {
    return res.status(403).send("Security token missing or expired. Refresh the page and try again.");
  }
  return next();
};

app.use(requireCsrfToken);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// Subdomain middleware: looks at the hostname, pulls out the leading label
// (e.g. "trio" from "trio.localhost"), and resolves it to a company row.
// Attaches `req.company` for downstream handlers. Null on the root domain.
const getSubdomainSlug = (hostname) => {
  if (!hostname) return null;
  const host = hostname.toLowerCase();
  if (host === ROOT_HOST) return null;
  if (host.endsWith(`.${ROOT_HOST}`)) {
    const rawSlug = host.slice(0, -(ROOT_HOST.length + 1)) || null;
    return rawSlug?.split(".")[0] || null;
  }
  return null;
};

app.use(async (req, res, next) => {
  const slug = getSubdomainSlug(req.hostname);
  req.companySlug = slug;
  req.company = null;
  if (slug) {
    try {
      const { data } = await supabase
        .from("companies")
        .select("id, name, slug, access_mode, theme_id, logo_url, portal_name, login_background_color, login_background_image_url")
        .eq("slug", slug)
        .maybeSingle();
      if (data) req.company = data;
    } catch (error) {
      console.error("Subdomain lookup failed:", error);
    }
  }
  next();
});

app.use(async (req, res, next) => {
  if (req.path === "/api/hrms/launch") return next();
  const companyId = req.company?.id || req.session?.user?.companyId || null;
  let allowedOrigin = "";
  if (companyId) {
    try {
      const settings = await getOrgHrmsSettings(companyId);
      if (settings?.enabled) allowedOrigin = normalizeOrigin(settings.allowed_origin || "");
    } catch (error) {
      console.error("HRMS frame settings lookup failed:", error);
    }
  }
  const fallbackOrigins = HRMS_EMBED_ORIGINS.map(normalizeOrigin).filter(Boolean);
  const ancestors = Array.from(new Set(["'self'", allowedOrigin, ...fallbackOrigins].filter(Boolean)));
  if (ancestors.length > 1) {
    res.setHeader("Content-Security-Policy", `frame-ancestors ${ancestors.join(" ")}`);
  } else {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
  }
  next();
});

// Root path is context-sensitive:
//   policies.zarohr.com/        -> marketing landing (index.html)
//   trio.policies.zarohr.com/   -> rail dashboard (policies.html, populated by JS)
//   unknown.policies.zarohr.com/ -> 404
app.get("/", (req, res, next) => {
  if (req.companySlug && !req.company) {
    return res
      .status(404)
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>Organization not found</title>
         <body style="font-family:system-ui;padding:48px;max-width:520px;margin:auto">
         <h1>Organization not found</h1>
         <p>The address <code>${escapeHtml(req.hostname)}</code> doesn't match any organization.</p>
         <p><a href="http://${escapeHtml(ROOT_HOST)}:${PORT}/">Back to main site</a></p>
         </body>`
      );
  }
  if (req.company) {
    return res.sendFile(path.join(rootDir, "policies.html"));
  }
  return res.sendFile(path.join(rootDir, "index.html"));
});

// On any org subdomain, /index.html is the login-only page (no marketing
// hero, no "how it works"). Root domain still gets the full landing.
app.get("/index.html", (req, res, next) => {
  if (req.company) return res.sendFile(path.join(rootDir, "login.html"));
  return next();
});

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const staticOptions = {
  dotfiles: "deny",
  fallthrough: false,
  setHeaders: (res) => {
    if (!IS_PRODUCTION) res.setHeader("Cache-Control", "no-store");
  },
};

// Only browser assets are public. Never expose the repository root: doing so
// makes server source, SQL, tests, package metadata, and .git reachable.
app.use("/app", express.static(path.join(rootDir, "app"), staticOptions));
app.use("/Images", express.static(path.join(rootDir, "Images"), staticOptions));

const PUBLIC_PAGES = new Set([
  "index.html",
  "login.html",
  "orgs.html",
  "policies.html",
  "policy-admin.html",
]);
app.get("/:page", (req, res, next) => {
  if (!PUBLIC_PAGES.has(req.params.page)) return next();
  return res.sendFile(path.join(rootDir, req.params.page));
});

// Endpoints that a must_reset_password session is allowed to hit. Everything
// else is 403'd — the temp password buys you a session, and the ONLY thing
// that session can do is choose a real password (or log out).
const RESET_ALLOWED_PATHS = new Set([
  "/api/password/change",
  "/api/logout",
  "/api/session",
  "/api/auth/context",
]);

const requirePasswordFresh = (req, res, next) => {
  if (!req.session?.user?.mustResetPassword) return next();
  if (RESET_ALLOWED_PATHS.has(req.path)) return next();
  return res.status(403).json({
    error: "must_reset_password",
    message: "Set a new password before continuing.",
  });
};

// Global gate: apply the reset lock BEFORE any auth guard runs. Cheap check;
// no-op when there's no session or the flag is off.
app.use(requirePasswordFresh);

const requireAuth = (req, res, next) => {
  if (!req.session?.user) {
    return res.status(401).send("Not authenticated.");
  }
  return next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session?.user) {
    return res.status(401).send("Not authenticated.");
  }
  if (req.session.user.role !== "admin") {
    return res.status(403).send("Admin access required.");
  }
  return next();
};

const sanitizeFilename = (name = "") => name.replace(/[^a-zA-Z0-9._-]/g, "_");
const sanitizeText = (value = "") => String(value).replace(/\s+/g, " ").trim();
const sanitizeEmail = (value = "") => sanitizeText(value).toLowerCase();
const sanitizeEmployeeCode = (value = "") => sanitizeText(value).toUpperCase();
const sanitizeLoginIdentifier = (value = "") => sanitizeText(value).trim();
const BRANDING_LIMITS = { logo: 1024 * 1024, background: 3 * 1024 * 1024 };
const validateBrandingImage = (value, limit, label) => {
  if (value == null || value === "") return "";
  const raw = String(value);
  const match = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error(`${label} must be a PNG, JPG, or WebP image.`);
  const bytes = Math.floor((match[2].length * 3) / 4);
  if (bytes > limit) throw new Error(`${label} exceeds the ${Math.round(limit / 1024 / 1024)} MB limit.`);
  return raw;
};
const isUuid = (value = "") =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const POLICY_FILE_TYPES = new Map([
  [".pdf", new Set(["application/pdf"])],
  [".docx", new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"])],
  [".doc", new Set(["application/msword", "application/octet-stream"])],
  [".txt", new Set(["text/plain"])],
]);

const validatePolicyUpload = (file) => {
  if (!file?.originalname) return "Missing file.";
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimes = POLICY_FILE_TYPES.get(ext);
  if (!allowedMimes) return "Only PDF, DOC, DOCX, and TXT policy files are allowed.";
  const mime = String(file.mimetype || "").toLowerCase();
  if (!allowedMimes.has(mime)) {
    return `File type mismatch. ${ext} files cannot be uploaded as ${mime || "unknown content type"}.`;
  }
  const buffer = file.buffer || Buffer.alloc(0);
  const isPdf = ext === ".pdf" && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  const isZipDocx = ext === ".docx" && buffer.subarray(0, 4).toString("hex") === "504b0304";
  const isOldDoc = ext === ".doc" && buffer.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1";
  const isText = ext === ".txt" && !buffer.subarray(0, Math.min(buffer.length, 1024)).includes(0);
  if (!isPdf && !isZipDocx && !isOldDoc && !isText) {
    return "File content does not match the selected file type.";
  }
  return "";
};

const isSuperAdminPasswordValid = async (password) => {
  if (!password) return false;
  if (ADMIN_PASSWORD_HASH) return bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  return password === ADMIN_PASSWORD;
};

const chunkText = (text, { chunkSize = 180, overlap = 24 } = {}) => {
  const cleaned = sanitizeText(text);
  if (!cleaned) return [];
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = [];
  let currentWords = 0;

  const pushChunk = () => {
    if (!current.length) return;
    chunks.push(current.join(" "));
    if (overlap > 0) {
      const overlapWords = current.join(" ").split(/\s+/).slice(-overlap);
      current = overlapWords.length ? [overlapWords.join(" ")] : [];
      currentWords = overlapWords.length;
    } else {
      current = [];
      currentWords = 0;
    }
  };

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    if (currentWords + words.length > chunkSize && currentWords > 0) {
      pushChunk();
    }
    current.push(sentence);
    currentWords += words.length;
  }
  pushChunk();
  return chunks;
};

// Gemini call with a single 2-second backoff on rate-limit (429) or server
// (5xx) errors. On the free tier, brief bursts can trip the 15-RPM limit;
// a silent retry covers that without surfacing an error to the user.
const fetchGemini = async (path, payload, { maxRetries = 1 } = {}) => {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY in environment.");
  }
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${path}?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        }
      );
    } catch (error) {
      lastError = new Error(error?.name === "AbortError" ? "Gemini request timed out." : "Gemini request failed.");
      lastError.status = error?.name === "AbortError" ? 504 : 502;
      lastError.cause = error;
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
    if (response.ok) return response.json();

    const message = await response.text();
    lastError = new Error(message || "Gemini request failed.");
    lastError.status = response.status;

    // Retry only on 429 (rate limit) and 5xx (transient server errors).
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === maxRetries) throw lastError;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw lastError;
};

// Tiny in-memory LRU for embedding results. Same query string → same vector,
// so repeated questions (or rewrites that converge to the same phrasing)
// skip the Gemini round-trip entirely. Cleared on server restart by design.
const EMBED_CACHE_MAX = 500;
const embedCache = new Map();
const embedCacheGet = (key) => {
  if (!embedCache.has(key)) return null;
  const value = embedCache.get(key);
  embedCache.delete(key);
  embedCache.set(key, value);
  return value;
};
const embedCacheSet = (key, value) => {
  if (embedCache.has(key)) embedCache.delete(key);
  embedCache.set(key, value);
  if (embedCache.size > EMBED_CACHE_MAX) {
    embedCache.delete(embedCache.keys().next().value);
  }
};

const embedText = async (text) => {
  const key = String(text || "").trim();
  if (!key) return [];
  const cached = embedCacheGet(key);
  if (cached) return cached;
  const result = await fetchGemini(`${GEMINI_EMBED_MODEL}:embedContent`, {
    content: { parts: [{ text }] },
  });
  const vector = result?.embedding?.values || [];
  if (vector.length) embedCacheSet(key, vector);
  return vector;
};

// Per-user daily chat counter, backed by the chat_usage table. The atomic
// insert/update via Postgres avoids races when the same user fires two
// requests at once. Returns { count, remaining } so the caller can both
// gate the call and surface remaining quota to the UI.
const recordChatUsage = async (userId) => {
  if (!userId) return { count: 0, remaining: CHAT_DAILY_CAP_PER_USER };
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const { data, error } = await supabase.rpc("increment_chat_usage", {
    p_user_id: String(userId),
    p_day: today,
  });
  if (error) {
    // Fallback: select + upsert. Slower, slight race, but keeps things
    // running if the RPC isn't created yet.
    const { data: existing } = await supabase
      .from("chat_usage")
      .select("count")
      .eq("user_id", String(userId))
      .eq("day", today)
      .maybeSingle();
    const next = (existing?.count || 0) + 1;
    await supabase
      .from("chat_usage")
      .upsert({ user_id: String(userId), day: today, count: next }, { onConflict: "user_id,day" });
    return { count: next, remaining: Math.max(0, CHAT_DAILY_CAP_PER_USER - next) };
  }
  const count = Number(data) || 0;
  return { count, remaining: Math.max(0, CHAT_DAILY_CAP_PER_USER - count) };
};

const recordOrgChatUsage = async (companyId) => {
  if (!companyId) return { count: 0, remaining: CHAT_DAILY_CAP_PER_ORG };
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("increment_org_chat_usage", {
    p_company_id: companyId,
    p_day: today,
  });
  if (error) {
    const { data: existing } = await supabase
      .from("org_chat_usage")
      .select("count")
      .eq("company_id", companyId)
      .eq("day", today)
      .maybeSingle();
    const next = (existing?.count || 0) + 1;
    await supabase
      .from("org_chat_usage")
      .upsert({ company_id: companyId, day: today, count: next }, { onConflict: "company_id,day" });
    return { count: next, remaining: Math.max(0, CHAT_DAILY_CAP_PER_ORG - next) };
  }
  const count = Number(data) || 0;
  return { count, remaining: Math.max(0, CHAT_DAILY_CAP_PER_ORG - count) };
};

const peekChatUsage = async (userId) => {
  if (!userId) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("chat_usage")
    .select("count")
    .eq("user_id", String(userId))
    .eq("day", today)
    .maybeSingle();
  return data?.count || 0;
};

const peekOrgChatUsage = async (companyId) => {
  if (!companyId) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("org_chat_usage")
    .select("count")
    .eq("company_id", companyId)
    .eq("day", today)
    .maybeSingle();
  return data?.count || 0;
};

const hashValue = (value = "") => crypto.createHash("sha256").update(String(value)).digest("hex");

const encryptSecret = (value = "") => {
  if (!value) return "";
  if (!SMTP_ENCRYPTION_KEY) throw new Error("SMTP credential encryption is not configured.");
  const key = crypto.createHash("sha256").update(SMTP_ENCRYPTION_KEY).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
};

const decryptSecret = (value = "") => {
  if (!value || !String(value).startsWith("enc:v1:")) return String(value || "");
  if (!SMTP_ENCRYPTION_KEY) throw new Error("SMTP credential encryption is not configured.");
  const [, , ivPart, tagPart, encryptedPart] = String(value).split(":");
  const key = crypto.createHash("sha256").update(SMTP_ENCRYPTION_KEY).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

const getPolicyIndexVersion = async (companyId) => {
  const [{ count: docCount }, { count: chunkCount }, { data: latestDoc }, { data: latestChunk }] = await Promise.all([
    supabase.from("policy_documents").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    supabase.from("policy_chunks").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    supabase.from("policy_documents").select("created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(1),
    supabase.from("policy_chunks").select("created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(1),
  ]);
  return hashValue(JSON.stringify({
    docCount: docCount || 0,
    chunkCount: chunkCount || 0,
    latestDoc: latestDoc?.[0]?.created_at || "",
    latestChunk: latestChunk?.[0]?.created_at || "",
  }));
};

const getCachedAnswer = async ({ companyId, questionHash, indexVersion }) => {
  const { data, error } = await supabase
    .from("chat_answer_cache")
    .select("answer, sources, created_at")
    .eq("company_id", companyId)
    .eq("question_hash", questionHash)
    .eq("index_version", indexVersion)
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.created_at).getTime() + CHAT_CACHE_TTL_MS < Date.now()) return null;
  return data;
};

const setCachedAnswer = async ({ companyId, questionHash, indexVersion, answer, sources }) => {
  await supabase.from("chat_answer_cache").upsert({
    company_id: companyId,
    question_hash: questionHash,
    index_version: indexVersion,
    answer,
    sources: sources || [],
    created_at: new Date().toISOString(),
  }, { onConflict: "company_id,question_hash,index_version" });
};

const chatWithGemini = async (prompt) => {
  const result = await fetchGemini(`${GEMINI_CHAT_MODEL}:generateContent`, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.25,
      topP: 0.9,
      maxOutputTokens: 300,
    },
  });
  return result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
};

const isIncompleteAiAnswer = (answer = "") => {
  const text = String(answer || "").trim();
  if (!text) return true;
  if (/^source\s+\d+\b/i.test(text)) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 5) return true;
  if (/[,:;]$/.test(text)) return true;
  if (/\b(is|are|to|for|with|and|or|of|in|the|a|an)$/i.test(text)) return true;
  if (/\b(entitled to|equal to|up to|at least|maximum of|minimum of)\s+\d+$/i.test(text)) return true;
  return false;
};

// Rewrites a vague user question into a single retrieval-optimized phrase
// using the company's actual policy titles as vocabulary. Only called on
// weak initial retrieval (see /api/chat). Returns "" on failure so the
// caller silently keeps the original results.
const rewriteQueryForRetrieval = async (question, modules) => {
  const moduleList = (modules || [])
    .map((m) => {
      const policyNames = (m.policies || []).map((p) => p.name).filter(Boolean).join(", ");
      return `- ${m.name}${policyNames ? `: ${policyNames}` : ""}`;
    })
    .join("\n");
  const prompt =
    "You rewrite vague HR questions into ONE retrieval query for a vector search over policy documents.\n\n" +
    "Rules:\n" +
    "- Output ONE sentence. No preamble, no quotes, no bullets, no explanation.\n" +
    "- Use formal HR vocabulary that matches policy titles (e.g. \"leave\" not \"days off\", \"reimbursement\" not \"money back\").\n" +
    "- Do not invent policies that aren't in the list below.\n" +
    "- If the question is already specific, output it unchanged.\n\n" +
    `Available policy areas:\n${moduleList || "(none)"}\n\n` +
    `User question:\n${question}\n\n` +
    "Rewritten retrieval query:";
  try {
    const result = await fetchGemini(`${GEMINI_CHAT_MODEL}:generateContent`, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        topP: 0.9,
        maxOutputTokens: 80,
      },
    });
    return (result?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  } catch (error) {
    console.warn("Query rewrite failed, keeping original:", error?.message || error);
    return "";
  }
};

const slugify = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "org";

// Subdomain slugs that would collide with system paths/subdomains if assigned
// to an org. e.g. an org named "API" would get slug "api", which then makes
// `api.<root>/api/*` ambiguous with the real API routes.
const RESERVED_SLUGS = new Set([
  "www",
  "api",
  "admin",
  "app",
  "mail",
  "smtp",
  "root",
  "support",
  "docs",
  "status",
  "orgs",
  "policies",
  "policy-admin",
  "dashboard",
  "login",
  "signup",
  "billing",
  "settings",
  "hrms",
  "auth",
  "public",
  "static",
  "assets",
  "uploads",
]);

const isReservedSlug = (slug) => RESERVED_SLUGS.has(String(slug || "").toLowerCase());

const generateAccessToken = () => crypto.randomBytes(18).toString("base64url");
// Absolute path to the session-file-store directory. Used by the delete
// flow to invalidate any live server-side session belonging to a user we
// just removed. Kept in sync with the FileStore config above.
const SESSIONS_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..", ".sessions");

// Delete every persisted session file whose user.id matches one of the
// supplied ids. Best-effort: parse errors and unrelated files are ignored.
const nukeSessionsForUsers = async (userIds) => {
  const targets = new Set((userIds || []).filter(Boolean).map(String));
  if (!targets.size) return 0;
  let removed = 0;
  let files;
  try {
    files = await fs.promises.readdir(SESSIONS_DIR);
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    console.warn("Session dir read failed:", err.message);
    return 0;
  }
  await Promise.all(
    files
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const full = path.join(SESSIONS_DIR, name);
        try {
          const raw = await fs.promises.readFile(full, "utf8");
          const data = JSON.parse(raw);
          const sessionUserId = String(data?.user?.id || "");
          if (sessionUserId && targets.has(sessionUserId)) {
            await fs.promises.unlink(full);
            removed += 1;
          }
        } catch { /* corrupt/partial session file — ignore */ }
      })
  );
  return removed;
};

const generateTemporaryPassword = () => crypto.randomBytes(9).toString("base64url");

// Temp passwords issued at invite time live for a week. After that the
// employee must ask for a fresh invite / password reset. Long enough to
// survive vacation, short enough that dormant credentials in inboxes rot.
const TEMP_PASSWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const tempPasswordExpiryIso = () => new Date(Date.now() + TEMP_PASSWORD_TTL_MS).toISOString();
const generateOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
const hashOtp = (otp) => crypto.createHash("sha256").update(String(otp)).digest("hex");

const getAppProtocol = (req) => (IS_PRODUCTION ? "https" : req.protocol);
const getRootBaseUrl = (req) => `${getAppProtocol(req)}://${ROOT_HOST}${IS_PRODUCTION ? "" : `:${PORT}`}`;

// Canonical string signed by both sides of the HRMS handoff. Each field is
// URL-encoded before joining so that a value can't inject a delimiter or a
// key=value pair to shift boundaries (e.g. `name = "Bob\nrole=admin"`).
// Order is fixed and every field appears exactly once.
const buildHrmsCanonicalPayload = ({ org, email, exp, name = "", role = "employee", externalId = "" }) => {
  const safeRole = role === "admin" ? "admin" : "employee";
  return [
    `org=${encodeURIComponent(slugify(org))}`,
    `email=${encodeURIComponent(sanitizeEmail(email))}`,
    `exp=${encodeURIComponent(String(exp || ""))}`,
    `name=${encodeURIComponent(sanitizeText(name || ""))}`,
    `role=${encodeURIComponent(safeRole)}`,
    `external_id=${encodeURIComponent(sanitizeText(externalId || ""))}`,
  ].join("\n");
};

// Coerce a query-string field to a single scalar. If Express handed us an
// array (attacker sent `role=employee&role=admin`), refuse — we can't tell
// which value the signer intended.
const singleQueryParam = (value) => {
  if (Array.isArray(value)) return null;
  if (value == null) return "";
  return String(value);
};

const signHrmsLaunch = (payload, secret = HRMS_LAUNCH_SECRET) =>
  crypto.createHmac("sha256", secret).update(payload).digest("hex");

const safeEqualHex = (left = "", right = "") => {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
};

const normalizeOrigin = (value = "") => {
  const raw = sanitizeText(value || "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && !IS_PRODUCTION)) return "";
    return url.origin;
  } catch {
    return "";
  }
};

const generateHrmsSecret = () => crypto.randomBytes(32).toString("base64url");

const getOrgHrmsSettings = async (companyId) => {
  if (!companyId) return null;
  const { data, error } = await supabase
    .from("org_hrms_settings")
    .select("company_id, enabled, allowed_origin, launch_secret, last_rotated_at, updated_at")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error && error.code !== "42P01") throw error;
  return data || null;
};

const getHrmsSecretForCompany = async (companyId) => {
  const settings = await getOrgHrmsSettings(companyId);
  return settings?.launch_secret || HRMS_LAUNCH_SECRET || "";
};

const buildHrmsLaunchTemplate = ({ req, company, secret }) => {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const canonical = buildHrmsCanonicalPayload({
    org: company.slug,
    email: "employee@example.com",
    name: "Employee Name",
    role: "employee",
    exp,
    externalId: "EMP001",
  });
  const sig = secret ? signHrmsLaunch(canonical, secret) : "CONFIGURE_LAUNCH_SECRET";
  const params = new URLSearchParams({
    org: company.slug,
    email: "employee@example.com",
    name: "Employee Name",
    role: "employee",
    exp: String(exp),
    external_id: "EMP001",
    sig,
  });
  return `${getRootBaseUrl(req)}/api/hrms/launch?${params.toString()}`;
};

const isGlobalSmtpConfigured = () =>
  Boolean(GLOBAL_SMTP.host && GLOBAL_SMTP.user && GLOBAL_SMTP.pass && GLOBAL_SMTP.from);

const sendOrgAdminInvite = async ({ to, name, orgName, orgSlug, password, req }) => {
  if (!isGlobalSmtpConfigured()) {
    throw new Error("ZaroHR SMTP is not configured.");
  }
  const transporter = nodemailer.createTransport({
    host: GLOBAL_SMTP.host,
    port: GLOBAL_SMTP.port,
    secure: GLOBAL_SMTP.port === 465,
    auth: {
      user: GLOBAL_SMTP.user,
      pass: GLOBAL_SMTP.pass,
    },
  });
  const loginUrl = `${getAppProtocol(req)}://${orgSlug}.${ROOT_HOST}${IS_PRODUCTION ? "" : `:${PORT}`}/index.html#login`;
  const displayName = name || to;
  await transporter.sendMail({
    from: `"${GLOBAL_SMTP.fromName}" <${GLOBAL_SMTP.from}>`,
    to,
    subject: `${orgName} is ready on policies.zarohr`,
    text:
      `Hi ${displayName},\n\n` +
      `${orgName} has been initialized on policies.zarohr.\n\n` +
      `Login URL: ${loginUrl}\n` +
      `Email: ${to}\n` +
      `Temporary password: ${password}\n\n` +
      `You will be asked to set a new password on first sign-in.\n\n` +
      `ZaroHR`,
  });
};

// Build a nodemailer transport for an org. Prefers the org's own SMTP settings
// (configured in the admin Email tab) and falls back to the global ZaroHR
// SMTP if the org hasn't set theirs up yet. Returns { transporter, from } or
// throws when neither side is configured.
const buildOrgTransport = async ({ companyId, orgName }) => {
  const { data: orgSmtp } = await supabase
    .from("org_smtp_settings")
    .select("host, port, username, password, from_email, from_name")
    .eq("company_id", companyId)
    .maybeSingle();

  const smtpPassword = orgSmtp?.password ? decryptSecret(orgSmtp.password) : "";
  const useOrgSmtp =
    orgSmtp && orgSmtp.host && orgSmtp.username && smtpPassword && (orgSmtp.from_email || orgSmtp.username);

  if (useOrgSmtp) {
    const transporter = nodemailer.createTransport({
      host: orgSmtp.host,
      port: Number(orgSmtp.port) || 587,
      secure: Number(orgSmtp.port) === 465,
      auth: { user: orgSmtp.username, pass: smtpPassword },
    });
    const fromName = orgSmtp.from_name || orgName;
    return { transporter, from: `"${fromName}" <${orgSmtp.from_email || orgSmtp.username}>` };
  }
  if (isGlobalSmtpConfigured()) {
    const transporter = nodemailer.createTransport({
      host: GLOBAL_SMTP.host,
      port: GLOBAL_SMTP.port,
      secure: GLOBAL_SMTP.port === 465,
      auth: { user: GLOBAL_SMTP.user, pass: GLOBAL_SMTP.pass },
    });
    return { transporter, from: `"${GLOBAL_SMTP.fromName}" <${GLOBAL_SMTP.from}>` };
  }
  throw new Error("No SMTP is configured for this organization.");
};

// Magic-link sign-in. Generates a one-time, browser-bound token, persists it,
// and emails the corresponding link. The browser_id is the random value from
// the `pending_login` cookie set on the same request — clicking the link from
// any other browser is rejected because that browser won't have the cookie.
const TOKEN_EXPIRY_MS = {
  invite: 7 * 24 * 60 * 60 * 1000, // 7 days for admin-issued onboarding
  recovery: 15 * 60 * 1000,         // 15 minutes for user-requested re-auth
};

const generateBrowserId = () => crypto.randomBytes(18).toString("base64url");

// Returns the existing browser_id cookie or sets a new one. Idempotent so
// repeat requests from the same browser keep using the same id.
const ensurePendingLoginCookie = (req, res) => {
  let id = req.cookies?.pending_login || null;
  if (!id) {
    id = generateBrowserId();
    res.cookie("pending_login", id, {
      httpOnly: true,
      sameSite: IS_PRODUCTION ? "none" : "lax",
      secure: IS_PRODUCTION,
      domain: IS_PRODUCTION ? `.${ROOT_HOST}` : undefined,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
  return id;
};

const buildOrgLoginUrl = (req, orgSlug, path = "") => {
  return `${getAppProtocol(req)}://${orgSlug}.${ROOT_HOST}${IS_PRODUCTION ? "" : `:${PORT}`}/${path}`.replace(/(?<!:)\/+/g, "/");
};

const sendMagicLink = async ({ companyId, orgName, orgSlug, to, name, kind, req, res }) => {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashValue(token);
  const browserId = ensurePendingLoginCookie(req, res);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS[kind]).toISOString();

  const { error: insertError } = await supabase.from("magic_tokens").insert({
    token: tokenHash,
    company_id: companyId,
    email: String(to).trim().toLowerCase(),
    kind,
    browser_id: browserId,
    expires_at: expiresAt,
  });
  if (insertError) throw insertError;

  const linkUrl = buildOrgLoginUrl(req, orgSlug, `auth/link?token=${encodeURIComponent(token)}`);
  const { transporter, from } = await buildOrgTransport({ companyId, orgName });
  const displayName = name || to;
  const expiryNote = kind === "invite" ? "This link is valid for 7 days." : "This link is valid for the next 15 minutes.";
  await transporter.sendMail({
    from,
    to,
    subject: kind === "invite" ? `Welcome to ${orgName} — your policy portal access` : `Sign in to ${orgName}`,
    text:
      `Hi ${displayName},\n\n` +
      (kind === "invite"
        ? `You've been added to the ${orgName} policy portal.\n\n`
        : `Here's the sign-in link you requested.\n\n`) +
      `Click to sign in:\n${linkUrl}\n\n` +
      `${expiryNote} For your security, open it on the same device you'll use the portal from.\n\n` +
      `${orgName}`,
  });
  return { token, linkUrl };
};

// Fill {{placeholders}} in the HR-editable invite draft. Unknown tokens are
// left as-is so a typo doesn't silently drop content.
const applyEmailDraftPlaceholders = (template, vars) =>
  String(template || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? "") : match
  );

const DEFAULT_INVITE_SUBJECT = "Your {{org_name}} policy portal access";
const DEFAULT_INVITE_BODY =
  "Hi {{name}},\n\n" +
  "You've been added to the {{org_name}} policy portal.\n\n" +
  "Login URL: {{login_url}}\n" +
  "Employee code: {{employee_code}}\n" +
  "Temporary password: {{password}}\n\n" +
  "If you did not expect this email, contact your HR team.\n\n" +
  "{{org_name}}";

const sendEmployeeCredentials = async ({ companyId, orgName, orgSlug, to, name, employeeCode, password, req }) => {
  const { transporter, from } = await buildOrgTransport({ companyId, orgName });
  const loginUrl = buildOrgLoginUrl(req, orgSlug, "index.html#login");
  const displayName = name || to;
  // Prefer the active reusable template. Keep the legacy draft as a
  // compatibility fallback for organizations created before templates.
  const [{ data: templateRow }, { data: legacyDraft }] = await Promise.all([
    supabase
      .from("org_email_templates")
      .select("subject, body")
      .eq("company_id", companyId)
      .eq("is_default", true)
      .maybeSingle(),
    supabase
      .from("org_email_drafts")
      .select("subject, body")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);
  const emailRow = templateRow || legacyDraft;
  const draftSubject = emailRow?.subject?.trim() || DEFAULT_INVITE_SUBJECT;
  const draftBody = emailRow?.body?.trim() || DEFAULT_INVITE_BODY;
  const vars = {
    name: displayName,
    employee_code: employeeCode,
    password,
    login_url: loginUrl,
    org_name: orgName,
  };
  await transporter.sendMail({
    from,
    to,
    subject: applyEmailDraftPlaceholders(draftSubject, vars),
    text: applyEmailDraftPlaceholders(draftBody, vars),
  });
};

const sendPasswordResetOtp = async ({ companyId, orgName, to, name, otp }) => {
  const { transporter, from } = await buildOrgTransport({ companyId, orgName });
  const displayName = name || to;
  await transporter.sendMail({
    from,
    to,
    subject: `Reset your ${orgName} policy portal password`,
    text:
      `Hi ${displayName},\n\n` +
      `Your password reset OTP is ${otp}.\n\n` +
      `This OTP is valid for 10 minutes. If you did not request it, ignore this email.\n\n` +
      `${orgName}`,
  });
};

const resolveLoginCompany = async ({ organization, company, email }) => {
  // 1. Subdomain wins (set by the org-resolver middleware).
  if (company?.id) return company;

  // 2. Explicit org typed in the form (kept for super-admin convenience and
  //    forwards-compat when a slug arrives as a query param).
  const orgValue = sanitizeText(organization || "");
  if (orgValue) {
    const slug = slugify(orgValue);
    const { data: slugMatch, error: slugError } = await supabase
      .from("companies")
      .select("id, name, slug, access_mode")
      .eq("slug", slug)
      .maybeSingle();
    if (slugError) throw slugError;
    if (slugMatch) return slugMatch;
    const { data: nameMatch, error: nameError } = await supabase
      .from("companies")
      .select("id, name, slug, access_mode")
      .ilike("name", orgValue)
      .maybeSingle();
    if (nameError) throw nameError;
    if (nameMatch) return nameMatch;
  }

  // 3. Fall back to email lookup. If the email exists in exactly one org's
  //    people list, we use that org. Ambiguous (multi-org emails) returns
  //    null so the caller can ask for an explicit org.
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return null;
  const { data: peopleRows, error: peopleError } = await supabase
    .from("org_people")
    .select("company_id, status")
    .eq("email", cleanEmail);
  if (peopleError) throw peopleError;
  const activeOrgIds = Array.from(
    new Set(
      (peopleRows || [])
        .filter((row) => row.status !== "disabled")
        .map((row) => row.company_id)
    )
  );
  if (activeOrgIds.length !== 1) return null;
  const { data: companyRow, error: companyError } = await supabase
    .from("companies")
    .select("id, name, slug, access_mode")
    .eq("id", activeOrgIds[0])
    .maybeSingle();
  if (companyError) throw companyError;
  return companyRow || null;
};

const isMissingColumnError = (error) =>
  error?.code === "42703" || error?.code === "PGRST204" || /column .* does not exist|schema cache/i.test(error?.message || "");

const extractTextFromFile = async (file) => {
  if (!file) return "";
  const mime = file.mimetype || "";
  if (mime === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: file.buffer });
    try {
      const result = await parser.getText();
      return result.text || "";
    } finally {
      await parser.destroy();
    }
  }
  if (mime.includes("word") || mime.includes("officedocument")) {
    const { default: mammoth } = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value || "";
  }
  if (mime.startsWith("text/")) {
    return file.buffer.toString("utf-8");
  }
  return "";
};

const inferMimeFromPath = (filePath = "") => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".txt") || lower.endsWith(".csv") || lower.endsWith(".md")) return "text/plain";
  return "application/octet-stream";
};

const indexPolicyDocument = async ({ policyId, companyId, documentId, file }) => {
  const extracted = sanitizeText(await extractTextFromFile(file));
  if (!extracted) return { chunks: 0, reason: "No readable text found." };

  const chunks = chunkText(extracted);
  if (!chunks.length) return { chunks: 0, reason: "No chunks created." };

  const EMBED_CONCURRENCY = 5;
  const embeddings = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i += EMBED_CONCURRENCY) {
    const batch = chunks.slice(i, i + EMBED_CONCURRENCY);
    const results = await Promise.all(batch.map((chunk) => embedText(chunk)));
    results.forEach((embedding, j) => {
      embeddings[i + j] = { chunk: batch[j], embedding };
    });
  }

  await supabase.from("policy_chunks").delete().eq("document_id", documentId);
  const payload = embeddings.map(({ chunk, embedding }) => ({
    policy_id: policyId,
    company_id: companyId,
    document_id: documentId,
    chunk_text: chunk,
    embedding,
  }));
  const { error: chunkError } = await supabase.from("policy_chunks").insert(payload);
  if (chunkError) throw chunkError;
  return { chunks: payload.length };
};

// Rate limiters. Keyed by IP. Numbers are deliberately generous for normal
// users but tight enough to choke credential-stuffing, LLM-cost abuse, and
// upload spam. `standardHeaders: true` advertises remaining quota in
// RateLimit-* headers; `trust proxy` (set above for production) makes
// req.ip reflect the real client through a load balancer.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts. Try again in a few minutes.",
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many chat requests. Please slow down.",
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many uploads in a short time. Please slow down.",
});

// Unified login.
//   1. Root: super-admin email + password, or org-admin email + password.
//   2. Org standalone subdomain: employee code/email + password.
//   3. Org HRMS mode: disabled here; the HRMS signed launch owns auth.
app.post("/api/login", loginLimiter, async (req, res) => {
  const { email, userid, password, remember, organization } = req.body || {};
  const rawIdentifier = sanitizeLoginIdentifier(email || userid || "");
  const identifier = rawIdentifier.toLowerCase();
  if (!identifier) {
    return res.status(400).send("Employee code or email is required.");
  }

  // --- Subdomain path (org context resolved via Host header) ---
  // Employee/admin standalone login: email/code + password against org_people.
  if (req.company?.id) {
    if ((req.company.access_mode || "standalone") === "hrms_link") {
      return res
        .status(403)
        .send("This organization signs in through your HRMS. Open the policy portal from there.");
    }
    if (!password) return res.status(400).send("Password is required.");
    const code = sanitizeEmployeeCode(rawIdentifier);
    const { data: rows, error: lookupError } = await supabase
      .from("org_people")
      .select("id, company_id, employee_code, email, name, role, status, password_hash, must_reset_password, password_expires_at, companies(id, name, slug)")
      .eq("company_id", req.company.id)
      .neq("status", "disabled");
    if (lookupError) {
      console.error("Employee auth lookup failed:", lookupError);
      return res.status(500).send("Sign-in failed.");
    }
    const personRow = (rows || []).find((row) =>
      row.email === identifier || sanitizeEmployeeCode(row.employee_code || "") === code
    );
    if (personRow && personRow.password_hash) {
      const ok = await bcrypt.compare(password, personRow.password_hash);
      if (ok) {
        if (
          personRow.must_reset_password &&
          personRow.password_expires_at &&
          new Date(personRow.password_expires_at).getTime() < Date.now()
        ) {
          return res.status(401).json({
            error: "temp_password_expired",
            message: "Your invite has expired. Ask your admin to re-send it.",
          });
        }
        const co = personRow.companies || req.company;
        await establishAuthenticatedSession(req, {
          id: personRow.id,
          email: personRow.email,
          employeeCode: personRow.employee_code || null,
          name: personRow.name || personRow.email,
          role: personRow.role === "admin" ? "admin" : "employee",
          companyId: personRow.company_id,
          selectedCompany: { id: co.id, name: co.name, slug: co.slug },
          authSource: "password",
          mustResetPassword: personRow.must_reset_password === true,
        });
        if (remember === false) {
          req.session.cookie.expires = false;
          req.session.cookie.maxAge = null;
        }
        const dest = personRow.must_reset_password
          ? "/index.html#reset-password"
          : personRow.role === "admin" ? "/policy-admin.html" : "/policies.html";
        return res.json({
          role: req.session.user.role,
          email: personRow.email,
          must_reset_password: personRow.must_reset_password === true,
          csrfToken: ensureCsrfToken(req),
          redirect: dest,
        });
      }
    }
    return res.status(401).send("Employee code/email or password is wrong.");
  }

  // --- Root-domain path ---
  // Super admin has an email + password login here. Anyone else is asked
  // for their organization and routed to that org's subdomain login. We
  // deliberately do NOT verify that the identifier belongs to the org at
  // this stage — that would leak "yes this email is on CompanyX's list",
  // a cross-org enumeration oracle.
  if (identifier === ADMIN_EMAIL) {
    if (!password) return res.status(400).send("Password is required.");
    if (!(await isSuperAdminPasswordValid(password))) {
      return res.status(401).send("Email or password is wrong.");
    }
    await establishAuthenticatedSession(req, { id: "admin", email: ADMIN_EMAIL, role: "super_admin", companyId: null });
    if (remember === false) {
      req.session.cookie.expires = false;
      req.session.cookie.maxAge = null;
    }
    const rootUrl = `${getAppProtocol(req)}://${ROOT_HOST}${IS_PRODUCTION ? "" : `:${PORT}`}/orgs.html`;
    return res.json({ role: "super_admin", email: ADMIN_EMAIL, csrfToken: ensureCsrfToken(req), redirect: rootUrl });
  }

  // Root-domain login: resolve the org and redirect to its subdomain login.
  // We deliberately do NOT verify that the identifier belongs to that org
  // here — doing so would turn this endpoint into a cross-org enumeration
  // oracle ("yes, alice@x.com works at CompanyY"). Any real "bad email/
  // password" verdict must happen ON the subdomain, uniformly, after the
  // user submits credentials there.
  const orgValue = sanitizeText(organization || "");
  if (!orgValue) {
    return res.status(400).json({ error: "org_required", message: "Enter your organization name." });
  }

  const company = await resolveLoginCompany({ organization: orgValue, company: null, email: null });
  if (!company) {
    return res.status(404).send("Organization not found. Check the name with your admin.");
  }
  if ((company.access_mode || "standalone") === "hrms_link") {
    return res
      .status(403)
      .send("This organization signs in through your HRMS. Open the policy portal from there.");
  }

  const subdomainBase = `${getAppProtocol(req)}://${company.slug}.${ROOT_HOST}${IS_PRODUCTION ? "" : `:${PORT}`}`;
  const redirect = `${subdomainBase}/index.html#login?identifier=${encodeURIComponent(rawIdentifier)}`;
  return res.json({ org: { name: company.name, slug: company.slug }, redirect });
});

const findOrgPersonByIdentifier = async ({ companyId, identifier }) => {
  const raw = sanitizeLoginIdentifier(identifier || "");
  const email = raw.toLowerCase();
  const code = sanitizeEmployeeCode(raw);
  const { data, error } = await supabase
    .from("org_people")
    .select("id, company_id, employee_code, email, name, role, status, password_hash")
    .eq("company_id", companyId)
    .neq("status", "disabled");
  if (error) throw error;
  return (data || []).find((row) => row.email === email || sanitizeEmployeeCode(row.employee_code || "") === code) || null;
};

const maskEmail = (email = "") => {
  const [local, domain] = String(email).split("@");
  if (!local || !domain) return email;
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(2, local.length - 2))}@${domain}`;
};

app.post("/api/password/forgot", loginLimiter, async (req, res) => {
  if (!req.company?.id) return res.status(400).send("Open your organization's login page to reset a password.");
  if ((req.company.access_mode || "standalone") === "hrms_link") {
    return res.status(403).send("This organization signs in through your HRMS.");
  }
  const identifier = sanitizeLoginIdentifier(req.body?.identifier || req.body?.email || req.body?.userid || "");
  if (!identifier) return res.status(400).send("Employee code or email is required.");

  try {
    const person = await findOrgPersonByIdentifier({ companyId: req.company.id, identifier });
    if (!person) {
      return res.json({ ok: true, message: "If this account exists, an OTP has been sent." });
    }
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error } = await supabase.from("password_reset_otps").insert({
      company_id: req.company.id,
      person_id: person.id,
      otp_hash: hashOtp(otp),
      expires_at: expiresAt,
    });
    if (error) throw error;
    await sendPasswordResetOtp({
      companyId: req.company.id,
      orgName: req.company.name,
      to: person.email,
      name: person.name,
      otp,
    });
    return res.json({ ok: true, sent_to: maskEmail(person.email) });
  } catch (error) {
    console.error("Password reset OTP failed:", error);
    return res.json({ ok: true, message: "If this account exists, an OTP has been sent." });
  }
});

app.post("/api/password/verify-otp", loginLimiter, async (req, res) => {
  if (!req.company?.id) return res.status(400).send("Open your organization's login page to reset a password.");
  const identifier = sanitizeLoginIdentifier(req.body?.identifier || req.body?.email || req.body?.userid || "");
  const otp = sanitizeText(req.body?.otp || "");
  if (!identifier || !/^\d{6}$/.test(otp)) return res.status(400).send("Enter the 6-digit OTP.");

  try {
    const person = await findOrgPersonByIdentifier({ companyId: req.company.id, identifier });
    if (!person) return res.status(401).send("OTP is invalid or expired.");
    const { data: otps, error } = await supabase
      .from("password_reset_otps")
      .select("id, otp_hash, expires_at, used_at, created_at")
      .eq("company_id", req.company.id)
      .eq("person_id", person.id)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = otps?.[0];
    if (!row || new Date(row.expires_at).getTime() < Date.now() || row.otp_hash !== hashOtp(otp)) {
      return res.status(401).send("OTP is invalid or expired.");
    }
    const usedAt = new Date().toISOString();
    const { data: consumedRows, error: burnError } = await supabase
      .from("password_reset_otps")
      .update({ used_at: usedAt })
      .eq("id", row.id)
      .is("used_at", null)
      .select("id");
    if (burnError) throw burnError;
    if (!consumedRows?.length) return res.status(401).send("OTP is invalid or expired.");

    const resetToken = crypto.randomBytes(32).toString("base64url");
    req.session.passwordResetGrant = {
      companyId: req.company.id,
      personId: person.id,
      tokenHash: hashValue(resetToken),
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    return res.json({ ok: true, reset_token: resetToken });
  } catch (error) {
    console.error("OTP verification failed:", error);
    return res.status(500).send("Could not verify OTP.");
  }
});

app.post("/api/password/reset", loginLimiter, async (req, res) => {
  if (!req.company?.id) return res.status(400).send("Open your organization's login page to reset a password.");
  const resetToken = String(req.body?.reset_token || "");
  const nextPassword = String(req.body?.password || "");
  if (!resetToken || !nextPassword) return res.status(400).send("Verify your OTP before setting a new password.");
  if (nextPassword.length < 8) return res.status(400).send("Password must be at least 8 characters.");

  const grant = req.session?.passwordResetGrant;
  const validGrant = grant
    && grant.companyId === req.company.id
    && grant.expiresAt > Date.now()
    && grant.tokenHash === hashValue(resetToken);
  if (!validGrant) {
    if (req.session) delete req.session.passwordResetGrant;
    return res.status(401).send("OTP verification has expired. Request a new OTP.");
  }

  try {
    const passwordHash = await bcrypt.hash(nextPassword, 10);
    const { error: updateError } = await supabase
      .from("org_people")
      .update({ password_hash: passwordHash, must_reset_password: false, password_expires_at: null, status: "active" })
      .eq("id", grant.personId)
      .eq("company_id", req.company.id);
    if (updateError) throw updateError;
    delete req.session.passwordResetGrant;
    return res.json({ ok: true });
  } catch (error) {
    console.error("Password reset failed:", error);
    return res.status(500).send(error.message || "Could not reset password.");
  }
});

// Click endpoint for magic links. Validates the token: exists, unused, not
// expired, browser_id matches the pending_login cookie. On success starts a
// session and redirects to /policies.html on the org's subdomain.
app.get("/auth/link", async (req, res) => {
  // On any failure, send the user back to the org subdomain login page with
  // an error code so the page can show a banner + the "request a new link"
  // form. The error codes match what auth.js displays.
  const failTo = (slug, errorCode) => {
    const base = !IS_PRODUCTION && req.hostname === ROOT_HOST
      ? "/index.html"
      : `${getAppProtocol(req)}://${slug || req.hostname}${IS_PRODUCTION ? "" : `:${PORT}`}/index.html`;
    return res.redirect(303, `${base}?login_error=${errorCode}#login`);
  };

  const token = String(req.query.token || "");
  if (!token) return failTo(null, "missing");

  const tokenHash = hashValue(token);
  let { data: row, error } = await supabase
    .from("magic_tokens")
    .select("token, company_id, email, kind, browser_id, expires_at, used_at")
    .eq("token", tokenHash)
    .maybeSingle();
  // Temporary compatibility for links issued before tokens were hashed.
  if (!error && !row) {
    const legacy = await supabase
      .from("magic_tokens")
      .select("token, company_id, email, kind, browser_id, expires_at, used_at")
      .eq("token", token)
      .maybeSingle();
    row = legacy.data;
    error = legacy.error;
  }
  if (error) {
    console.error("Magic token lookup failed:", error);
    if (/magic_tokens/.test(error.message || "")) {
      return res
        .status(500)
        .send("magic_tokens table missing. Run server/schema.sql in Supabase, then request a fresh link.");
    }
    return failTo(null, "missing");
  }
  if (!row) return failTo(null, "missing");

  // Look up the company up front so we can redirect failures to the right
  // subdomain.
  const { data: company } = await supabase
    .from("companies")
    .select("id, name, slug")
    .eq("id", row.company_id)
    .maybeSingle();
  const slug = company?.slug || null;

  if (row.used_at) return failTo(slug, "used");
  if (new Date(row.expires_at).getTime() < Date.now()) return failTo(slug, "expired");
  if (req.cookies?.pending_login !== row.browser_id) return failTo(slug, "device");

  if (!company) return failTo(null, "missing");

  const { data: person } = await supabase
    .from("org_people")
    .select("id, email, name, role, status")
    .eq("company_id", company.id)
    .eq("email", row.email)
    .maybeSingle();
  if (!person || person.status === "disabled") return failTo(slug, "missing");

  // Burn the token so the link can't be reused.
  await supabase
    .from("magic_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token);

  await establishAuthenticatedSession(req, {
    id: person.id,
    email: person.email,
    name: person.name || person.email,
    role: person.role === "admin" ? "admin" : "employee",
    companyId: company.id,
    selectedCompany: company,
    authSource: "magic_link",
  });

  const redirectPath = person.role === "admin" ? "/policy-admin.html" : "/policies.html";
  // Always land on the org subdomain for the dashboard.
  const dest = !IS_PRODUCTION && req.hostname === ROOT_HOST
    ? redirectPath
    : `${getAppProtocol(req)}://${company.slug}.${ROOT_HOST}${IS_PRODUCTION ? "" : `:${PORT}`}${redirectPath}`;
  return res.redirect(303, dest);
});

// --- Super admin: organization management ---

const requireSuperAdmin = (req, res, next) => {
  if (!req.session?.user) return res.status(401).send("Not authenticated.");
  if (req.session.user.role !== "super_admin") return res.status(403).send("Super admin only.");
  return next();
};

const resolveRequestCompanyId = (req) => req.company?.id || req.session?.user?.companyId || null;

const requireOrgManager = (req, res, next) => {
  if (!req.session?.user) return res.status(401).send("Not authenticated.");
  const companyId = resolveRequestCompanyId(req);
  if (!companyId) return res.status(400).send("Organization context is required.");
  if (req.session.user.role === "super_admin") {
    req.orgCompanyId = companyId;
    return next();
  }
  if (req.session.user.role === "admin" && req.session.user.companyId === companyId) {
    req.orgCompanyId = companyId;
    return next();
  }
  return res.status(403).send("Admin access required.");
};

const requireStandaloneEmployeeAccess = async (req, res, next) => {
  const { data, error } = await supabase
    .from("companies")
    .select("access_mode")
    .eq("id", req.orgCompanyId)
    .maybeSingle();
  if (error && !isMissingColumnError(error)) {
    console.error("Employee access mode lookup failed:", error);
    return res.status(500).send("Failed to verify employee access mode.");
  }
  if ((data?.access_mode || "standalone") === "hrms_link") {
    return res.status(403).send("People are managed by the HRMS in HRMS Tile mode.");
  }
  return next();
};

const requireOrgAccess = (req, res, next) => {
  if (!req.session?.user) return res.status(401).send("Not authenticated.");
  const companyId = resolveRequestCompanyId(req);
  if (!companyId) return res.status(400).send("Organization context is required.");
  if (req.session.user.role === "super_admin" || req.session.user.companyId === companyId) {
    req.orgCompanyId = companyId;
    return next();
  }
  return res.status(403).send("Organization access required.");
};

app.get("/api/admin/config", requireSuperAdmin, async (req, res) => {
  const templateModules = ORG_TEMPLATE.length;
  const templatePolicies = ORG_TEMPLATE.reduce((sum, m) => sum + m.policies.length, 0);
  return res.json({
    root_host: ROOT_HOST,
    is_production: IS_PRODUCTION,
    template_modules: templateModules,
    template_policies: templatePolicies,
  });
});

app.get("/api/admin/orgs", requireSuperAdmin, async (req, res) => {
  // Fetch orgs + per-org counts in parallel. Employees/admins come from
  // org_people (the real source now that magic-link auth is the standard).
  const [orgsResp, peopleResp, policiesResp, documentsResp] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, slug, access_token, access_mode, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("org_people").select("company_id, role").neq("status", "disabled"),
    supabase.from("org_policies").select("id, company_id"),
    supabase.from("policy_documents").select("policy_id, company_id"),
  ]);

  if (orgsResp.error) {
    console.error("List orgs failed:", orgsResp.error);
    return res.status(500).send("Failed to load organizations.");
  }

  const employeeCounts = new Map();
  const adminCounts = new Map();
  for (const row of peopleResp.data || []) {
    if (!row.company_id) continue;
    const map = row.role === "admin" ? adminCounts : employeeCounts;
    map.set(row.company_id, (map.get(row.company_id) || 0) + 1);
  }
  // Per-company total policy count.
  // Per-company total + per-company set of policy IDs with at least one
  // uploaded document (deduped so multi-version policies count once).
  const total = new Map(), uploaded = new Map();
  for (const r of policiesResp.data || []) total.set(r.company_id, (total.get(r.company_id) || 0) + 1);
  for (const r of documentsResp.data || []) {
    if (!uploaded.has(r.company_id)) uploaded.set(r.company_id, new Set());
    uploaded.get(r.company_id).add(r.policy_id);
  }

  const enriched = (orgsResp.data || []).map((o) => ({
    ...o,
    employee_count: employeeCounts.get(o.id) || 0,
    admin_count: adminCounts.get(o.id) || 0,
    policy_count: total.get(o.id) || 0,
    policy_uploaded_count: uploaded.get(o.id)?.size || 0,
  }));
  return res.json(enriched);
});

app.post("/api/admin/orgs/:id/select", requireSuperAdmin, async (req, res) => {
  const orgId = req.params.id;
  const { data: company, error } = await supabase
    .from("companies")
    .select("id, name, slug, access_mode, theme_id, logo_url, portal_name, login_background_color, login_background_image_url")
    .eq("id", orgId)
    .maybeSingle();
  if (error) {
    console.error("Select org failed:", error);
    return res.status(500).send("Failed to select organization.");
  }
  if (!company) return res.status(404).send("Organization not found.");
  req.session.user.companyId = company.id;
  req.session.user.selectedCompany = company;
  return res.json({ org: company, redirect: "/policies.html" });
});

app.post("/api/admin/orgs", requireSuperAdmin, async (req, res) => {
  const name = sanitizeText(req.body?.name || "");
  if (!name) return res.status(400).send("Organization name is required.");

  // Reserved-slug guard: reject names whose slug would collide with a system
  // subdomain or path. Better to fail loudly here than silently break
  // subdomain routing later.
  const baseSlug = slugify(name);
  if (isReservedSlug(baseSlug)) {
    return res
      .status(400)
      .send(`"${baseSlug}" is reserved for system use. Please pick a different organization name.`);
  }

  // Ensure slug is unique. The uniqueness suffix also re-checks reserved
  // (extremely unlikely to suffix into a reserved slug, but cheap to verify).
  let slug = baseSlug;
  let suffix = 1;
  while (true) {
    const { data: existing } = await supabase
      .from("companies")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!existing && !isReservedSlug(slug)) break;
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  const { data, error } = await supabase
    .from("companies")
    .insert({ name, slug, access_token: generateAccessToken() })
    .select("id, name, slug, access_token, created_at")
    .single();
  if (error) {
    console.error("Create org failed:", error);
    return res.status(500).send(error.message || "Failed to create organization.");
  }

  // Seed default template (7 modules, 27 policies) so the new org's dashboard
  // isn't empty. Logged but non-fatal if it fails.
  try {
    await seedTemplate(data.id);
  } catch (seedError) {
    console.error("Org seed failed (org still created):", seedError);
  }

  return res.status(201).json(data);
});

const seedTemplate = async (companyId) => {
  const moduleRows = ORG_TEMPLATE.map((m, i) => ({
    company_id: companyId,
    name: m.name,
  }));
  const { data: modules, error: moduleError } = await supabase
    .from("org_modules")
    .insert(moduleRows)
    .select("id, name");
  if (moduleError) throw moduleError;

  const policyRows = [];
  for (const moduleRow of modules || []) {
    const tpl = ORG_TEMPLATE.find((m) => m.name === moduleRow.name);
    if (!tpl) continue;
    tpl.policies.forEach((policyName, idx) => {
      policyRows.push({
        company_id: companyId,
        module_id: moduleRow.id,
        name: policyName,
      });
    });
  }
  if (policyRows.length) {
    const { error: policyError } = await supabase.from("org_policies").insert(policyRows);
    if (policyError) throw policyError;
  }
};

// Fetch the full module → policies tree for one organization. Used by the rail dashboard.
// Build the modules + policies tree for one company.
const fetchOrgDashboard = async (companyId, { ensureTemplate = false, includeHidden = false } = {}) => {
  let moduleQuery = supabase
    .from("org_modules")
    .select("id, name, description, image_url, is_hidden")
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (!includeHidden) moduleQuery = moduleQuery.eq("is_hidden", false);

  let policyQuery = supabase
    .from("org_policies")
    .select("id, module_id, name, is_hidden")
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (!includeHidden) policyQuery = policyQuery.eq("is_hidden", false);

  let [{ data: modules, error: moduleFetchError }, { data: policies, error: policyFetchError }] = await Promise.all([
    moduleQuery,
    policyQuery,
  ]);
  if (policyFetchError && isMissingColumnError(policyFetchError)) {
    // is_hidden column not yet migrated on org_policies — fall back to
    // selecting without it. Treat all policies as visible.
    const fallback = await supabase
      .from("org_policies")
      .select("id, module_id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    policies = (fallback.data || []).map((p) => ({ ...p, is_hidden: false }));
    policyFetchError = fallback.error;
  }
  if (moduleFetchError && isMissingColumnError(moduleFetchError)) {
    const fallback = await supabase
      .from("org_modules")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    modules = (fallback.data || []).map((module) => ({
      ...module,
      description: "",
      image_url: "",
      is_hidden: false,
    }));
    moduleFetchError = fallback.error;
  }
  if (moduleFetchError) throw moduleFetchError;
  if (policyFetchError) throw policyFetchError;
  if (ensureTemplate && !(modules || []).length) {
    await seedTemplate(companyId);
    return fetchOrgDashboard(companyId, { includeHidden });
  }
  return (modules || []).map((m) => ({
    id: m.id,
    name: m.name,
    slug: slugify(m.name),
    description: m.description || "",
    image_url: m.image_url || "",
    is_hidden: m.is_hidden === true,
    policies: (policies || [])
      .filter((p) => p.module_id === m.id)
      .map((p) => ({ id: p.id, name: p.name, is_hidden: p.is_hidden === true })),
  }));
};

const normalizeLookup = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const baseLookupTokens = (value = "") => {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "all",
    "are",
    "can",
    "do",
    "does",
    "find",
    "for",
    "from",
    "has",
    "have",
    "i",
    "in",
    "is",
    "it",
    "me",
    "of",
    "on",
    "policy",
    "policies",
    "show",
    "any",
    "the",
    "there",
    "this",
    "tile",
    "to",
    "what",
    "where",
    "which",
    "with",
  ]);
  return normalizeLookup(value)
    .split(/\s+/)
    .map((token) => token.replace(/ies$/, "y").replace(/s$/, ""))
    .filter((token) => (token.length > 2 || ["pl", "sl", "cl", "el", "pf"].includes(token)) && !stopWords.has(token));
};

const lookupTokens = (value = "") => {
  return baseLookupTokens(expandHrTerms(normalizeLookup(value)));
};

const expandHrTerms = (value = "") => {
  const expansions = [
    [/\bpl\b|privilege leave|annual leave|earned leave|paid leave/g, " privilege leave pl annual leave entitlement time away"],
    [/\bsl\b|sick|illness|ill|medical leave|casual leave/g, " sick leave casual leave medical leave entitlement time away"],
    [/\bleave|absent|absence|attendance|holiday|vacation\b/g, " leave attendance holiday time away"],
    [/work from home|wfh|remote work|remote|hybrid/g, " attendance employment work arrangement"],
    [/fire|safety|accident|hazard|emergency/g, " safety health fire accident"],
    [/salary|pay|wage|compensation|bonus|benefit|loan|gratuity|lta|pension/g, " pay compensation benefits salary"],
    [/training|learning|performance|appraisal|review/g, " learning performance training"],
    [/recruit|onboard|joining|intern|trainee|employment|contract/g, " life work employment onboarding"],
    [/posh|harassment|conduct|conflict|whistle|ethic|insider|relative|marriage|punish|punishment|penalty|penalties|sanction|violation|disciplinary/g, " conduct ethics posh conflict sanction violation disciplinary penalty"],
    [/internet|phone|telephone|fuel|car|book|periodical|reimburse|allowance/g, " tools allowance reimbursement"],
  ];
  return expansions.reduce((text, [pattern, replacement]) => text.replace(pattern, (match) => `${match} ${replacement}`), value);
};

const formatModulePolicies = (module) => {
  const policies = module.policies || [];
  if (!policies.length) return `${module.name}: no policies are listed yet.`;
  return `${module.name}: ${policies.map((policy) => policy.name).join(", ")}`;
};

const getPolicyStats = async ({ companyId, modules }) => {
  const policyIds = modules.flatMap((module) => (module.policies || []).map((policy) => policy.id)).filter(Boolean);
  if (!policyIds.length) return { total: 0, uploaded: 0, pending: 0 };
  const { data, error } = await supabase
    .from("policy_documents")
    .select("policy_id")
    .eq("company_id", companyId)
    .in("policy_id", policyIds);
  if (error) {
    console.error("Policy stats lookup failed:", error);
    return { total: policyIds.length, uploaded: 0, pending: policyIds.length };
  }
  const uploaded = new Set((data || []).map((row) => row.policy_id).filter(Boolean)).size;
  return { total: policyIds.length, uploaded, pending: Math.max(policyIds.length - uploaded, 0) };
};

// Source-of-truth listing of which policies have an uploaded document and
// which don't. Used by the chat handler when the user asks "what policies are
// uploaded / pending" — answered from the DB, not from RAG, so it can't
// hallucinate or miss entries.
const getUploadedPolicyLists = async ({ companyId, modules }) => {
  const policies = modules.flatMap((module) =>
    (module.policies || []).map((policy) => ({ id: policy.id, name: policy.name, module: module.name }))
  );
  const policyIds = policies.map((p) => p.id).filter(Boolean);
  if (!policyIds.length) return { uploaded: [], pending: [] };
  const { data, error } = await supabase
    .from("policy_documents")
    .select("policy_id")
    .eq("company_id", companyId)
    .in("policy_id", policyIds);
  if (error) {
    console.error("Uploaded-list lookup failed:", error);
    return { uploaded: [], pending: policies };
  }
  const uploadedIds = new Set((data || []).map((row) => row.policy_id).filter(Boolean));
  return {
    uploaded: policies.filter((p) => uploadedIds.has(p.id)),
    pending: policies.filter((p) => !uploadedIds.has(p.id)),
  };
};

const classifyQuestionContext = (question = "") => {
  const normalized = normalizeLookup(question);
  const checks = [
    { intent: "navigation", pattern: /\b(where|find|located|open|go to|which tile|which module)\b/ },
    { intent: "policy_count", pattern: /\b(how many|count|number of).*\b(policy|policies|uploaded|pending)\b|\b(policy|policies|uploaded|pending).*\b(how many|count|number of)\b/ },
    { intent: "policy_listing", pattern: /\b(list|which|what|show|all).*\b(policy|policies|module|modules|tile|tiles)\b|\b(policy|policies|module|modules|tile|tiles).*\b(list|which|what|show|all)\b/ },
    { intent: "entitlement", pattern: /\b(eligible|eligibility|entitled|entitlement|get|allowed|available|any|have|benefit|leave)\b/ },
    { intent: "procedure", pattern: /\b(how|process|steps|apply|request|submit|approve|approval|claim|do i|what should)\b/ },
    { intent: "reimbursement", pattern: /\b(reimburse|reimbursement|claim|allowance|bill|expense|internet|phone|telephone|fuel|car|book|periodical)\b/ },
    { intent: "conduct_compliance", pattern: /\b(posh|harassment|conduct|conflict|whistle|insider|ethic|compliance|relative|marriage)\b/ },
    { intent: "definition", pattern: /\b(what is|meaning|define|definition)\b/ },
  ];
  return checks.find((check) => check.pattern.test(normalized))?.intent || "unknown";
};

const contextHintForIntent = (intent) => {
  const hints = {
    entitlement: "Look for eligibility, limits, entitlement, conditions, and exceptions. Do not treat nearby leave types as proof of the requested leave type unless it is explicitly mentioned.",
    procedure: "Look for process steps, approval flow, required documents, timelines, and who the employee must contact.",
    reimbursement: "Look for allowance, reimbursement, claim limits, required bills, eligibility, and submission process.",
    conduct_compliance: "Look for rules, prohibited behavior, reporting path, investigation process, and disciplinary consequences.",
    definition: "Look for definitions or terms explained in the policy text.",
    navigation: "Answer using dashboard/module/policy location only.",
    policy_listing: "Answer using the module and policy list only.",
    unknown: "Answer from policy text when available. If unclear, state what was checked and ask HR to confirm.",
  };
  return hints[intent] || hints.unknown;
};

const findClosestPolicyArea = (question, modules = []) => {
  const rawTokens = baseLookupTokens(question);
  const expandedTokens = lookupTokens(question);
  if (!expandedTokens.length) return null;

  return modules
    .flatMap((module) =>
      (module.policies || []).map((policy) => {
        const haystackTokens = lookupTokens(`${module.name} ${module.description || ""} ${policy.name}`);
        const haystack = haystackTokens.join(" ");
        const rawScore = rawTokens.reduce((sum, token) => {
          if (haystackTokens.includes(token)) return sum + 4;
          if (haystack.includes(token)) return sum + 2;
          return sum;
        }, 0);
        const hintScore = expandedTokens.reduce((sum, token) => {
          if (rawTokens.includes(token)) return sum;
          if (haystackTokens.includes(token)) return sum + 1;
          if (haystack.includes(token)) return sum + 0.5;
          return sum;
        }, 0);
        return { module, policy, score: rawScore + hintScore, rawScore, hintScore };
      })
    )
    .sort((a, b) => b.score - a.score)[0] || null;
};

const findClosestPolicyAreas = (question, modules = [], limit = 3) => {
  const rawTokens = baseLookupTokens(question);
  const expandedTokens = lookupTokens(question);
  if (!expandedTokens.length) return [];

  return modules
    .flatMap((module) =>
      (module.policies || []).map((policy) => {
        const haystackTokens = lookupTokens(`${module.name} ${module.description || ""} ${policy.name}`);
        const haystack = haystackTokens.join(" ");
        const rawScore = rawTokens.reduce((sum, token) => {
          if (haystackTokens.includes(token)) return sum + 4;
          if (haystack.includes(token)) return sum + 2;
          return sum;
        }, 0);
        const hintScore = expandedTokens.reduce((sum, token) => {
          if (rawTokens.includes(token)) return sum;
          if (haystackTokens.includes(token)) return sum + 1;
          if (haystack.includes(token)) return sum + 0.5;
          return sum;
        }, 0);
        return { module, policy, score: rawScore + hintScore, rawScore, hintScore };
      })
    )
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

const findPolicyForMatch = (modules, policyId) =>
  modules
    .flatMap((module) => (module.policies || []).map((policy) => ({ module, policy })))
    .find((entry) => entry.policy.id === policyId) || null;

const summarizeMatchedPolicyAreas = (matches = [], modules = []) => {
  const counts = new Map();
  matches.slice(0, 8).forEach((match) => {
    const entry = findPolicyForMatch(modules, match.policy_id);
    if (!entry) return;
    const key = `${entry.module.name} > ${entry.policy.name}`;
    const current = counts.get(key) || { path: key, count: 0, best: 0 };
    current.count += 1;
    current.best = Math.max(current.best, Number(match.similarity || 0));
    counts.set(key, current);
  });
  return Array.from(counts.values())
    .sort((a, b) => b.best - a.best || b.count - a.count)
    .slice(0, 3)
    .map((item) => `${item.path} (${item.count} match${item.count === 1 ? "" : "es"})`)
    .join("\n");
};

const scorePolicyChunkForQuestion = (chunkText = "", question = "") => {
  const questionTokens = lookupTokens(question);
  if (!questionTokens.length) return 0;
  const chunkTokens = lookupTokens(chunkText);
  const chunkTokenSet = new Set(chunkTokens);
  const chunkLookup = chunkTokens.join(" ");
  return questionTokens.reduce((score, token) => {
    if (chunkTokenSet.has(token)) return score + 4;
    if (chunkLookup.includes(token)) return score + 1;
    return score;
  }, 0);
};

const fetchFocusedPolicyChunks = async ({ companyId, policyAreas = [], question, limit = 4 }) => {
  const policyIds = Array.from(
    new Set(
      policyAreas
        .filter((entry) => entry?.score > 0 && entry?.policy?.id)
        .map((entry) => entry.policy.id)
    )
  ).slice(0, 3);
  if (!policyIds.length) return [];

  const { data, error } = await supabase
    .from("policy_chunks")
    .select("id, policy_id, chunk_text")
    .eq("company_id", companyId)
    .in("policy_id", policyIds)
    .limit(60);
  if (error) {
    console.error("Focused policy chunk lookup failed:", error);
    return [];
  }

  return (data || [])
    .map((row) => ({
      ...row,
      similarity: 0.5,
      focused: true,
      focus_score: scorePolicyChunkForQuestion(row.chunk_text, question),
    }))
    .filter((row) => row.focus_score > 0)
    .sort((a, b) => b.focus_score - a.focus_score)
    .slice(0, limit);
};

const mergeMatchesById = (...groups) => {
  const merged = new Map();
  groups.flat().forEach((row) => {
    if (!row?.id || merged.has(row.id)) return;
    merged.set(row.id, row);
  });
  return Array.from(merged.values());
};

const splitPolicySentences = (text = "") =>
  String(text || "")
    .replace(/\s*•\s*/g, ". ")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().replace(/^\d+(\.\d+)*\s*/, ""))
    .filter(Boolean);

const cleanExtractedAnswer = (answer = "") =>
  String(answer || "")
    .replace(/\s+/g, " ")
    .replace(/\.([A-Z])/g, ". $1")
    .replace(/\.{2,}/g, ".")
    .replace(/^([A-Z][A-Za-z/& -]{2,40})\s+\1\b/i, "$1")
    .trim();

const entitlementTargetForQuestion = (question = "") => {
  const q = normalizeLookup(question);
  if (/\b(pl|privilege leave|annual leave|earned leave)\b/.test(q)) {
    return {
      type: "standard",
      patterns: [/\bprivilege leave\b/i, /\bpl\b/i],
    };
  }
  if (/\b(sl|sick|casual sick|casual leave|medical)\b/.test(q)) {
    return {
      type: "standard",
      patterns: [/\bsick leave\b/i, /\bcasual\s*\/?\s*sick leave\b/i, /\bsl\b/i],
    };
  }
  if (/\bpaternity\b/.test(q)) {
    return { type: "standard", patterns: [/\bpaternity leave\b/i] };
  }
  if (/\bmaternity\b/.test(q)) {
    return { type: "standard", patterns: [/\bmaternity leave\b/i] };
  }
  if (/\bholiday|holidays\b/.test(q)) {
    return { type: "holiday", patterns: [/\bpublic holidays?\b/i, /\boptional holidays?\b/i, /\bholiday list\b/i] };
  }
  return null;
};

const expectedPolicyNamePatternsForQuestion = (question = "") => {
  const q = normalizeLookup(question);
  if (/\b(sl|sick|casual sick|casual leave|medical|leave|attendance)\b/.test(q)) {
    return [/holidays?,?\s+leave\s+&?\s+attendance/i, /\bleave\s+&?\s+attendance/i];
  }
  if (/\bholiday|holidays\b/.test(q)) {
    return [/\bholiday list\b/i, /holidays?,?\s+leave\s+&?\s+attendance/i];
  }
  if (/\bmaternity\b/.test(q)) return [/\bmaternity\b/i];
  if (/\bpaternity\b/.test(q)) return [/\bpaternity\b/i];
  return [];
};

const findExpectedPolicyAreas = (question, modules = []) => {
  const patterns = expectedPolicyNamePatternsForQuestion(question);
  if (!patterns.length) return [];
  return modules
    .flatMap((module) => (module.policies || []).map((policy) => ({ module, policy })))
    .filter(({ policy }) => patterns.some((pattern) => pattern.test(policy.name)));
};

const answerSimpleEntitlementFromMatches = ({ question, matches = [] }) => {
  const asksAmount = /\b(how many|count|number of|allowed|entitled|eligible|available|avail|get)\b/i.test(question);
  if (!asksAmount) return "";
  const target = entitlementTargetForQuestion(question);
  if (!target) return "";

  const sentences = matches
    .slice(0, 10)
    .flatMap((row) => splitPolicySentences(row.chunk_text))
    .filter((sentence, index, all) => all.indexOf(sentence) === index);

  if (target.type === "holiday") {
    const publicHoliday = sentences.find((sentence) =>
      /\bemployees are entitled\b/i.test(sentence) &&
      /\b(company-declared|statutory|public holidays?|holiday list)\b/i.test(sentence)
    );
    const optionalHoliday = sentences.find((sentence) =>
      /\b(up to|entitled|avail)\b/i.test(sentence) && /\boptional holidays?\b/i.test(sentence)
    );
    if (publicHoliday && optionalHoliday) return cleanExtractedAnswer(`${publicHoliday} ${optionalHoliday}`);
    if (publicHoliday) return cleanExtractedAnswer(publicHoliday);
  }

  const answer =
    sentences.find((sentence) => {
      const hasTarget = target.patterns.some((pattern) => pattern.test(sentence));
      const hasEmployeeSubject = /\bemployees?\b/i.test(sentence);
      const hasEntitlement = /\b(entitled|eligible|up to|working days?|weeks?|paid leave|calendar year|may avail)\b/i.test(sentence);
      const hasNumber = /\b\d+\b|\(\d+\)|\b(one|two|three|four|five|six|twelve|twenty|twenty-six)\b/i.test(sentence);
      return hasEmployeeSubject && hasTarget && hasEntitlement && hasNumber;
    }) || "";
  return cleanExtractedAnswer(answer);
};

const answerSimpleSanctionFromMatches = ({ question, matches = [] }) => {
  if (!/\b(punish|punishment|penalty|penalties|sanction|violation|disciplinary|consequence|action)\b/i.test(question)) {
    return "";
  }
  const sentences = matches
    .slice(0, 10)
    .flatMap((row) => splitPolicySentences(row.chunk_text))
    .filter((sentence, index, all) => all.indexOf(sentence) === index);

  const sanctionIndex = sentences.findIndex((sentence) =>
    /\b(non-compliance|violation|violations|insider trading)\b/i.test(sentence) &&
    /\b(disciplinary|wage freeze|suspension|clawback|disgorgement|penalties|prosecution|sebi action)\b/i.test(sentence)
  );
  if (sanctionIndex < 0) return "";

  const answerParts = [sentences[sanctionIndex]];
  const next = sentences[sanctionIndex + 1] || "";
  if (/\b(insider trading|sebi act|section|penalties|prosecution)\b/i.test(next)) {
    answerParts.push(next);
  }
  return cleanExtractedAnswer(answerParts.join(" "));
};

const isLikelyTableOfContentsLine = (sentence = "") => {
  const text = String(sentence || "");
  const numberedHeadings = (text.match(/\b\d+(\.\d+)?\s+[A-Z][A-Za-z/& -]{2,}/g) || []).length;
  const digitCount = (text.match(/\d/g) || []).length;
  return numberedHeadings >= 4 || (digitCount > 14 && text.length < 260);
};

const isUsefulPolicySentence = (sentence = "") => {
  const text = cleanExtractedAnswer(sentence);
  if (text.length < 35 || text.length > 520) return false;
  if (isLikelyTableOfContentsLine(text)) return false;
  return /\b(shall|will|must|may|can|cannot|should|required|entitled|eligible|applicable|prohibited|include|includes|including|responsible|approval|report|submit|contact|disciplinary|penalty|penalties|leave|holiday|allowance|reimbursement|training|review|disclosure|compliance)\b/i.test(text);
};

const sentenceScoreForQuestion = (sentence = "", question = "") => {
  const rawQuestionTokens = baseLookupTokens(question);
  const expandedQuestionTokens = lookupTokens(question);
  const sentenceTokens = lookupTokens(sentence);
  const sentenceTokenSet = new Set(sentenceTokens);
  const sentenceLookup = sentenceTokens.join(" ");
  const rawOverlap = rawQuestionTokens.reduce((sum, token) => {
    if (sentenceTokenSet.has(token)) return sum + 5;
    if (sentenceLookup.includes(token)) return sum + 2;
    return sum;
  }, 0);
  const expandedOverlap = expandedQuestionTokens.reduce((sum, token) => {
    if (rawQuestionTokens.includes(token)) return sum;
    if (sentenceTokenSet.has(token)) return sum + 1;
    return sum;
  }, 0);
  const actionBoost = /\b(how|what|when|where|who|which|can|do|does|eligible|allowed|punish|penalty|process|apply|contact|report)\b/i.test(question) &&
    /\b(shall|will|must|may|can|required|entitled|eligible|prohibited|report|submit|contact|approval|disciplinary|penalty|process)\b/i.test(sentence)
    ? 3
    : 0;
  return rawOverlap + expandedOverlap + actionBoost;
};

const sentenceMatchesQuestionIntent = ({ sentence, question, intent }) => {
  if (/\b(how|process|steps|apply|request|submit|approve|approval|claim|do i|what should)\b/i.test(question) || intent === "procedure") {
    return /\b(apply|applied|request|requests|submitted|submit|approval|approved|through|system|required|must|process|inform|report|contact)\b/i.test(sentence);
  }
  if (/\b(who|whom|person|officer|contact|member|chairperson|committee)\b/i.test(question)) {
    return /\b(officer|contact|member|committee|chairperson|manager|hr|compliance|secretary|department|team)\b/i.test(sentence);
  }
  if (/\b(what is|meaning|define|definition)\b/i.test(question) || intent === "definition") {
    return /\b(is|are|means|mean|refers to|defined as|includes|include)\b/i.test(sentence);
  }
  return true;
};

const answerFromPolicySentences = ({ question, matches = [], minScore = 10, intent = "unknown" }) => {
  const candidates = matches
    .slice(0, 12)
    .flatMap((row) =>
      splitPolicySentences(row.chunk_text).map((sentence, index) => ({
        sentence: cleanExtractedAnswer(sentence),
        index,
        policyId: row.policy_id,
        score: sentenceScoreForQuestion(sentence, question) + Math.min(Number(row.focus_score || 0), 20) / 5,
      }))
    )
    .filter((item, index, all) =>
      isUsefulPolicySentence(item.sentence) &&
      sentenceMatchesQuestionIntent({ sentence: item.sentence, question, intent }) &&
      all.findIndex((other) => other.sentence === item.sentence) === index
    )
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < minScore) return "";
  return cleanExtractedAnswer(best.sentence);
};

const getPolicyDocumentStatus = async ({ companyId, policyId }) => {
  if (!policyId) return "unknown";
  const { data, error } = await supabase
    .from("policy_documents")
    .select("id")
    .eq("company_id", companyId)
    .eq("policy_id", policyId)
    .limit(1);
  if (error) {
    console.error("Policy document status lookup failed:", error);
    return "unknown";
  }
  return data?.length ? "uploaded" : "missing";
};

const getOrgPolicySearchStatus = async (companyId) => {
  const [{ data: documents, error: documentError }, { data: chunks, error: chunkError }] = await Promise.all([
    supabase.from("policy_documents").select("id").eq("company_id", companyId).limit(1),
    supabase.from("policy_chunks").select("id").eq("company_id", companyId).limit(1),
  ]);
  if (documentError || chunkError) {
    console.error("Policy search status lookup failed:", documentError || chunkError);
    return "unknown";
  }
  if (!documents?.length) return "no_uploaded_documents";
  if (!chunks?.length) return "no_indexed_chunks";
  return "searchable";
};

const buildClosestPolicyFallback = async ({ companyId, question, modules }) => {
  const searchStatus = await getOrgPolicySearchStatus(companyId);
  if (searchStatus === "no_uploaded_documents") {
    return "No uploaded policy documents are available for this org yet. Upload policy documents before using Ask Genie.";
  }
  if (searchStatus === "no_indexed_chunks") {
    return "Uploaded policy documents are not searchable yet. Re-upload them or check indexing.";
  }

  const closest = findClosestPolicyArea(question, modules);
  if (!closest || closest.score <= 0) {
    return "Not in the uploaded policies. Check with HR.";
  }

  const documentStatus = await getPolicyDocumentStatus({ companyId, policyId: closest.policy.id });
  if (documentStatus === "missing") {
    return `Try "${closest.policy.name}" in ${closest.module.name}. Document not uploaded yet.`;
  }
  return `Try "${closest.policy.name}" in ${closest.module.name}. Check with HR.`;
};

const answerLooksMissing = (answer = "") =>
  /\b(no mention|not mention|does not mention|do not mention|cannot answer|could not find|not included|not specify|not clear|unclear)\b/i.test(answer);

const appendClosestPolicyContext = ({ answer, closestPolicyAreas = [] }) => {
  if (!answerLooksMissing(answer) || !closestPolicyAreas.length) return answer;
  const alreadyNamesClosest = closestPolicyAreas.some((entry) => answer.includes(entry.policy.name) || answer.includes(entry.module.name));
  if (alreadyNamesClosest) return answer;
  // Single short pointer instead of a multi-area dump.
  const first = closestPolicyAreas[0];
  return `${answer} (Try "${first.policy.name}" in ${first.module.name}.)`;
};

const answerSiteMapQuestion = (question, modules = []) => {
  const normalized = normalizeLookup(question);
  const tokens = lookupTokens(question);
  if (!normalized) return "";

  if (/^(hi|hello|hey|help)$/.test(normalized)) {
    return "Hi. You can ask me about a policy, where to find a policy, or which policies are inside a tile.";
  }

  const asksForModules = /\b(module|modules|tile|tiles)\b/.test(normalized);
  const asksForPolicies = /\b(policy|policies)\b/.test(normalized);
  const asksForList = /\b(all|list|which|what|show)\b/.test(normalized);
  const asksWhere = /\b(where|find|located|which tile|which module)\b/.test(normalized);

  if (asksForModules && asksForList && !tokens.length) {
    return `The dashboard has these tiles: ${modules.map((module) => module.name).join(", ")}.`;
  }

  const moduleMatch = modules
    .map((module) => {
      const name = normalizeLookup(module.name);
      const score = tokens.reduce((sum, token) => sum + (name.includes(token) ? 1 : 0), 0);
      return { module, score };
    })
    .sort((a, b) => b.score - a.score)[0];

  if (asksForPolicies && asksForList && !tokens.length) {
    return modules.map(formatModulePolicies).join("\n");
  }

  if (asksForPolicies && moduleMatch?.score > 0 && (asksForModules || asksForList)) {
    return formatModulePolicies(moduleMatch.module);
  }

  const policyMatch = modules
    .flatMap((module) =>
      (module.policies || []).map((policy) => {
        const name = normalizeLookup(policy.name);
        const score = tokens.reduce((sum, token) => sum + (name.includes(token) ? 1 : 0), 0);
        return { module, policy, score };
      })
    )
    .sort((a, b) => b.score - a.score)[0];

  if (asksWhere && policyMatch?.score > 0) {
    return `You can find "${policyMatch.policy.name}" inside the "${policyMatch.module.name}" tile. Open Dashboard > ${policyMatch.module.name} > ${policyMatch.policy.name}.`;
  }

  if (asksForPolicies && asksForList && tokens.length && policyMatch?.score > 0) {
    return `"${policyMatch.policy.name}" is listed inside the "${policyMatch.module.name}" tile.`;
  }

  return "";
};

const answerPolicyCountQuestion = async ({ companyId, question, modules }) => {
  const normalized = normalizeLookup(question);
  const stats = await getPolicyStats({ companyId, modules });
  const label = (count) => `${count} ${count === 1 ? "policy" : "policies"}`;
  if (/\buploaded\b/.test(normalized)) return `${label(stats.uploaded)} uploaded.`;
  if (/\bpending\b/.test(normalized)) return `${label(stats.pending)} pending upload.`;
  return `${stats.total} policies are listed. ${stats.uploaded} uploaded, ${stats.pending} pending.`;
};

const clearPolicyArtifacts = async ({ policyIds, companyId }) => {
  if (!policyIds.length) return { ok: true };
  const { data: documents, error: docFetchError } = await supabase
    .from("policy_documents")
    .select("id, file_path")
    .in("policy_id", policyIds)
    .eq("company_id", companyId);
  if (docFetchError && docFetchError.code !== "42P01") {
    console.error("Policy document lookup failed:", docFetchError);
    return { ok: false, message: "Failed to delete policy documents." };
  }

  const documentIds = (documents || []).map((doc) => doc.id).filter(Boolean);
  const filePaths = (documents || []).map((doc) => doc.file_path).filter(Boolean);
  if (documentIds.length) {
    const { error: chunkDeleteError } = await supabase.from("policy_chunks").delete().in("document_id", documentIds);
    if (chunkDeleteError && chunkDeleteError.code !== "42P01") {
      console.error("Policy chunk cleanup failed:", chunkDeleteError);
      return { ok: false, message: "Failed to delete policy chunks." };
    }
  }
  if (filePaths.length) {
    const { error: storageError } = await supabase.storage.from("policy-files").remove(filePaths);
    if (storageError) {
      console.error("Policy file cleanup failed:", storageError);
      return { ok: false, message: "Failed to delete stored policy files." };
    }
  }
  const { error: docDeleteError } = await supabase
    .from("policy_documents")
    .delete()
    .in("policy_id", policyIds)
    .eq("company_id", companyId);
  if (docDeleteError && docDeleteError.code !== "42P01") {
    console.error("Policy document cleanup failed:", docDeleteError);
    return { ok: false, message: "Failed to delete policy documents." };
  }
  return { ok: true };
};

// Called by the rail dashboard on the subdomain. Uses req.company set by the
// subdomain middleware — no org id in the URL.
app.get("/api/org/policies", requireOrgAccess, async (req, res) => {
  try {
    let company = req.company || req.session.user.selectedCompany || null;
    if (!company || company.id !== req.orgCompanyId) {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, slug")
        .eq("id", req.orgCompanyId)
        .maybeSingle();
      if (error) throw error;
      company = data;
    }
    if (!company) return res.status(404).send("Organization not found.");
    const modules = await fetchOrgDashboard(req.orgCompanyId, {
      ensureTemplate: true,
      includeHidden: req.query.include_hidden === "1",
    });
    const stats = await getPolicyStats({ companyId: req.orgCompanyId, modules });
    return res.json({ org: company, modules, stats });
  } catch (error) {
    console.error("Fetch org dashboard failed:", error);
    return res.status(500).send(IS_PRODUCTION ? "Failed to load organization policies." : error.message || "Failed to load organization policies.");
  }
});

// Legacy super-admin path (still used by orgs.html preview etc. if we want it).
app.get("/api/admin/orgs/:id/policies", requireSuperAdmin, async (req, res) => {
  const orgId = req.params.id;
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name, slug")
    .eq("id", orgId)
    .maybeSingle();
  if (companyError || !company) return res.status(404).send("Organization not found.");
  const modules = await fetchOrgDashboard(orgId);
  return res.json({ org: company, modules });
});

app.post("/api/org/modules", requireOrgManager, async (req, res) => {
  const name = sanitizeText(req.body?.name || "");
  const description = sanitizeText(req.body?.description || "");
  const imageUrl = sanitizeText(req.body?.image_url || "");
  if (!name) return res.status(400).send("Module name is required.");

  const { data: existing } = await supabase
    .from("org_modules")
    .select("position")
    .eq("company_id", req.orgCompanyId)
    .order("position", { ascending: false })
    .limit(1);
  const position = Number(existing?.[0]?.position || 0) + 1;

  let { data, error } = await supabase
    .from("org_modules")
    .insert({
      company_id: req.orgCompanyId,
      name,
      slug: slugify(name),
      description,
      image_url: imageUrl || null,
      position,
    })
    .select("id, name, slug, description, image_url, position")
    .single();
  if (error && isMissingColumnError(error)) {
    const fallback = await supabase
      .from("org_modules")
      .insert({
        company_id: req.orgCompanyId,
        name,
        slug: slugify(name),
        position,
      })
      .select("id, name, slug, position")
      .single();
    data = fallback.data ? { ...fallback.data, description: "", image_url: "" } : fallback.data;
    error = fallback.error;
  }
  if (error) {
    console.error("Create module failed:", error);
    return res.status(500).send(error.message || "Failed to create module.");
  }
  return res.status(201).json(data);
});

app.patch("/api/org/modules/:id", requireOrgManager, async (req, res) => {
  const updates = {};
  if (req.body?.name !== undefined) {
    const name = sanitizeText(req.body.name);
    if (!name) return res.status(400).send("Module name is required.");
    updates.name = name;
    updates.slug = slugify(name);
  }
  if (req.body?.description !== undefined) updates.description = sanitizeText(req.body.description);
  if (req.body?.image_url !== undefined) updates.image_url = sanitizeText(req.body.image_url) || null;
  if (req.body?.is_hidden !== undefined) updates.is_hidden = req.body.is_hidden === true;
  if (!Object.keys(updates).length) return res.status(400).send("No module changes provided.");

  let { data, error } = await supabase
    .from("org_modules")
    .update(updates)
    .eq("id", req.params.id)
    .eq("company_id", req.orgCompanyId)
    .select("id, name, slug, description, image_url, position")
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error) && (updates.description !== undefined || updates.image_url !== undefined)) {
      delete updates.description;
      delete updates.image_url;
      if (!Object.keys(updates).length) return res.status(400).send("Module details columns are missing. Run server/schema.sql in Supabase first.");
      const fallback = await supabase
        .from("org_modules")
        .update(updates)
        .eq("id", req.params.id)
        .eq("company_id", req.orgCompanyId)
        .select("id, name, slug, position")
        .maybeSingle();
      data = fallback.data ? { ...fallback.data, description: "", image_url: "" } : fallback.data;
      error = fallback.error;
    }
    if (isMissingColumnError(error) && req.body?.is_hidden !== undefined) {
      return res.status(500).send("is_hidden column missing. Run server/schema.sql in Supabase first.");
    }
  }
  if (error) {
    console.error("Update module failed:", error);
    return res.status(500).send(error.message || "Failed to update module.");
  }
  if (!data) return res.status(404).send("Module not found.");
  return res.json(data);
});

app.delete("/api/org/modules/:id", requireOrgManager, async (req, res) => {
  const { data: policiesForModule, error: policyLookupError } = await supabase
    .from("org_policies")
    .select("id")
    .eq("module_id", req.params.id)
    .eq("company_id", req.orgCompanyId);
  if (policyLookupError) {
    console.error("Module policy lookup failed:", policyLookupError);
    return res.status(500).send("Failed to delete module.");
  }
  const policyIds = (policiesForModule || []).map((policy) => policy.id);
  if (policyIds.length) {
    const cleared = await clearPolicyArtifacts({ policyIds, companyId: req.orgCompanyId });
    if (!cleared.ok) return res.status(500).send(cleared.message);
  }

  const { error } = await supabase
    .from("org_modules")
    .delete()
    .eq("id", req.params.id)
    .eq("company_id", req.orgCompanyId);
  if (error) {
    console.error("Delete module failed:", error);
    return res.status(500).send(error.message || "Failed to delete module.");
  }
  return res.json({ ok: true });
});

app.post("/api/org/modules/:moduleId/policies", requireOrgManager, async (req, res) => {
  const name = sanitizeText(req.body?.name || "");
  if (!name) return res.status(400).send("Policy name is required.");

  const { data: moduleRow } = await supabase
    .from("org_modules")
    .select("id")
    .eq("id", req.params.moduleId)
    .eq("company_id", req.orgCompanyId)
    .maybeSingle();
  if (!moduleRow) return res.status(404).send("Module not found.");

  const { data: existing } = await supabase
    .from("org_policies")
    .select("position")
    .eq("module_id", req.params.moduleId)
    .order("position", { ascending: false })
    .limit(1);
  const position = Number(existing?.[0]?.position || 0) + 1;

  const { data, error } = await supabase
    .from("org_policies")
    .insert({ company_id: req.orgCompanyId, module_id: req.params.moduleId, name, position })
    .select("id, module_id, name, position")
    .single();
  if (error) {
    console.error("Create policy failed:", error);
    return res.status(500).send(error.message || "Failed to create policy.");
  }
  return res.status(201).json(data);
});

app.patch("/api/org/policies/:id", requireOrgManager, async (req, res) => {
  const updates = {};
  if (req.body?.name !== undefined) {
    const name = sanitizeText(req.body.name);
    if (!name) return res.status(400).send("Policy name is required.");
    updates.name = name;
  }
  if (req.body?.is_hidden !== undefined) {
    updates.is_hidden = req.body.is_hidden === true;
  }
  if (!Object.keys(updates).length) {
    return res.status(400).send("Nothing to update.");
  }
  const { data, error } = await supabase
    .from("org_policies")
    .update(updates)
    .eq("id", req.params.id)
    .eq("company_id", req.orgCompanyId)
    .select("id, module_id, name, position, is_hidden")
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error) && updates.is_hidden !== undefined) {
      return res
        .status(500)
        .send("is_hidden column missing on org_policies. Run server/schema.sql in Supabase first.");
    }
    console.error("Update policy failed:", error);
    return res.status(500).send(error.message || "Failed to update policy.");
  }
  if (!data) return res.status(404).send("Policy not found.");
  return res.json(data);
});

app.delete("/api/org/policies/:id", requireOrgManager, async (req, res) => {
  const cleared = await clearPolicyArtifacts({ policyIds: [req.params.id], companyId: req.orgCompanyId });
  if (!cleared.ok) return res.status(500).send(cleared.message);
  const { error } = await supabase
    .from("org_policies")
    .delete()
    .eq("id", req.params.id)
    .eq("company_id", req.orgCompanyId);
  if (error) {
    console.error("Delete policy failed:", error);
    return res.status(500).send(error.message || "Failed to delete policy.");
  }
  return res.json({ ok: true });
});

app.get("/api/org/people", requireOrgManager, requireStandaloneEmployeeAccess, async (req, res) => {
  const { data, error } = await supabase
    .from("org_people")
    .select("id, employee_code, email, name, role, status, invited_at, created_at")
    .eq("company_id", req.orgCompanyId)
    .eq("role", "employee")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Load people failed:", error);
    return res.status(500).send("Failed to load people.");
  }
  return res.json(data || []);
});

app.get("/api/org/admins", requireSuperAdmin, async (req, res) => {
  const companyId = resolveRequestCompanyId(req);
  if (!companyId) return res.status(400).send("Organization context is required.");
  const { data, error } = await supabase
    .from("org_people")
    .select("id, employee_code, email, name, role, status, invited_at, created_at")
    .eq("company_id", companyId)
    .eq("role", "admin")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Load org admins failed:", error);
    return res.status(500).send("Failed to load admins.");
  }
  return res.json(data || []);
});

app.post("/api/org/admins", requireSuperAdmin, async (req, res) => {
  const companyId = resolveRequestCompanyId(req);
  if (!companyId) return res.status(400).send("Organization context is required.");
  const email = sanitizeEmail(req.body?.email || "");
  const name = sanitizeText(req.body?.name || "");
  const sendEmail = req.body?.send_email === true;
  if (!email || !email.includes("@")) return res.status(400).send("Valid admin email is required.");

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name, slug")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) {
    console.error("Admin org lookup failed:", companyError);
    return res.status(500).send("Failed to load organization.");
  }
  if (!company) return res.status(404).send("Organization not found.");

  let temporaryPassword = generateAccessToken();
  const payload = {
    company_id: companyId,
    email,
    name,
    role: "admin",
    status: "active",
    password_hash: await bcrypt.hash(temporaryPassword, 10),
    invited_at: null,
  };

  let { data, error } = await supabase
    .from("org_people")
    .upsert(payload, { onConflict: "company_id,email" })
    .select("id, employee_code, email, name, role, status, invited_at, created_at")
    .single();
  if (isMissingColumnError(error)) {
    const { password_hash, ...fallbackPayload } = payload;
    return res.status(500).send("Password storage is not configured. Apply server/schema.sql before creating admins.");
  }
  if (error) {
    console.error("Save org admin failed:", error);
    return res.status(500).send(error.message || "Failed to save admin.");
  }

  let emailSent = false;
  if (sendEmail) {
    try {
      await sendOrgAdminInvite({
        to: email,
        name,
        orgName: company.name,
        orgSlug: company.slug,
        password: temporaryPassword,
        req,
      });
      emailSent = true;
      const sentAt = new Date().toISOString();
      await supabase.from("org_people").update({ invited_at: sentAt }).eq("id", data.id).eq("company_id", companyId);
      data.invited_at = sentAt;
    } catch (emailError) {
      console.error("Admin invite email failed:", emailError);
      return res.status(201).json({
        admin: data,
        temporary_password: temporaryPassword,
        email_sent: false,
        email_error: emailError.message || "Email failed.",
      });
    }
  }

  return res.status(201).json({
    admin: data,
    temporary_password: temporaryPassword,
    email_sent: emailSent,
  });
});

app.post("/api/org/admins/:id/send-invite", requireSuperAdmin, async (req, res) => {
  const companyId = resolveRequestCompanyId(req);
  if (!companyId) return res.status(400).send("Organization context is required.");
  const [{ data: company }, { data: admin, error: adminError }] = await Promise.all([
    supabase.from("companies").select("id, name, slug").eq("id", companyId).maybeSingle(),
    supabase
      .from("org_people")
      .select("id, email, name, role, status")
      .eq("id", req.params.id)
      .eq("company_id", companyId)
      .eq("role", "admin")
      .maybeSingle(),
  ]);
  if (adminError) return res.status(500).send("Failed to load admin.");
  if (!company || !admin) return res.status(404).send("Admin not found.");

  let temporaryPassword = generateAccessToken();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  const { error: passwordError } = await supabase
    .from("org_people")
    .update({ password_hash: passwordHash })
    .eq("id", admin.id)
    .eq("company_id", companyId);
  if (isMissingColumnError(passwordError)) {
    return res.status(500).send("Password storage is not configured. Apply server/schema.sql before sending invites.");
  } else if (passwordError) {
    return res.status(500).send("Failed to generate admin credentials.");
  }

  try {
    await sendOrgAdminInvite({
      to: admin.email,
      name: admin.name,
      orgName: company.name,
      orgSlug: company.slug,
      password: temporaryPassword,
      req,
    });
    await supabase
      .from("org_people")
      .update({ invited_at: new Date().toISOString(), status: "active" })
      .eq("id", admin.id)
      .eq("company_id", companyId);
    return res.json({ ok: true, email_sent: true });
  } catch (emailError) {
    console.error("Admin resend invite failed:", emailError);
    return res.status(503).json({ email_error: emailError.message || "Invite email failed." });
  }
});

app.patch("/api/org/admins/:id", requireSuperAdmin, async (req, res) => {
  const companyId = resolveRequestCompanyId(req);
  if (!companyId) return res.status(400).send("Organization context is required.");
  if (req.body?.status !== "active" && req.body?.status !== "disabled") {
    return res.status(400).send("Invalid admin status.");
  }
  const { data, error } = await supabase
    .from("org_people")
    .update({ status: req.body.status })
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .eq("role", "admin")
    .select("id, employee_code, email, name, role, status, invited_at, created_at")
    .maybeSingle();
  if (error) return res.status(500).send(error.message || "Failed to update admin.");
  if (!data) return res.status(404).send("Admin not found.");
  return res.json(data);
});

app.delete("/api/org/admins/:id", requireSuperAdmin, async (req, res) => {
  const companyId = resolveRequestCompanyId(req);
  if (!companyId) return res.status(400).send("Organization context is required.");
  const { error } = await supabase
    .from("org_people")
    .delete()
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .eq("role", "admin");
  if (error) return res.status(500).send(error.message || "Failed to delete admin.");
  return res.json({ ok: true });
});

app.post("/api/org/people", requireOrgManager, requireStandaloneEmployeeAccess, async (req, res) => {
  const rows = Array.isArray(req.body?.people) ? req.body.people : [req.body || {}];

  const { data: companyRow } = await supabase
    .from("companies")
    .select("id, name, slug, access_mode")
    .eq("id", req.orgCompanyId)
    .maybeSingle();
  const isHrmsMode = (companyRow?.access_mode || "standalone") === "hrms_link";

  const seenCodes = new Set();
  const seenEmails = new Set();
  const validationErrors = [];
  const normalizedRows = rows
    .map((row, index) => {
      const employeeCode = sanitizeEmployeeCode(row.employee_code || row.employeeCode || row.code || "");
      const email = sanitizeEmail(row.email || "");
      const status = row.status === "draft" || row.status === "invited" ? row.status : "active";
      if (!employeeCode) validationErrors.push(`Row ${index + 1}: employee_code is required.`);
      if (!email || !email.includes("@")) validationErrors.push(`Row ${index + 1}: valid email is required.`);
      if (employeeCode && seenCodes.has(employeeCode)) validationErrors.push(`Row ${index + 1}: duplicate employee_code ${employeeCode}.`);
      if (email && seenEmails.has(email)) validationErrors.push(`Row ${index + 1}: duplicate email ${email}.`);
      seenCodes.add(employeeCode);
      seenEmails.add(email);
      return {
        employee_code: employeeCode,
        email,
        name: sanitizeText(row.name || ""),
        role: "employee",
        status,
        invited_at: status === "invited" ? new Date().toISOString() : null,
      };
    })
    .filter((row) => row.employee_code && row.email && row.email.includes("@"));
  if (validationErrors.length) return res.status(400).json({ error: validationErrors.join(" ") });
  if (!normalizedRows.length) return res.status(400).send("At least one valid employee is required.");

  const { data: existingPeople, error: existingError } = await supabase
    .from("org_people")
    .select("id, employee_code, email")
    .eq("company_id", req.orgCompanyId)
    .eq("role", "employee");
  if (existingError) {
    console.error("Load existing people failed:", existingError);
    return res.status(500).send("Failed to load existing people.");
  }

  const byEmail = new Map((existingPeople || []).map((row) => [row.email, row]));
  const byCode = new Map((existingPeople || []).map((row) => [sanitizeEmployeeCode(row.employee_code || ""), row]).filter(([code]) => code));
  const responseRows = [];

  for (const row of normalizedRows) {
    const emailMatch = byEmail.get(row.email);
    const codeMatch = byCode.get(row.employee_code);
    if (emailMatch && codeMatch && emailMatch.id !== codeMatch.id) {
      responseRows.push({
        ...row,
        email_sent: false,
        email_error: `Employee code ${row.employee_code} and email ${row.email} belong to different existing employees.`,
      });
      continue;
    }

    const existing = emailMatch || codeMatch || null;
    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from("org_people")
        .update({
          employee_code: row.employee_code,
          email: row.email,
          name: row.name,
          status: row.status,
          invited_at: row.invited_at,
        })
        .eq("id", existing.id)
        .eq("company_id", req.orgCompanyId)
        .select("id, employee_code, email, name, role, status, invited_at, created_at")
        .single();
      if (updateError) {
        console.error("Update person failed:", updateError);
        responseRows.push({ ...row, email_sent: false, email_error: updateError.message || "Update failed." });
        continue;
      }
      responseRows.push({ ...updated, email_sent: false, password_unchanged: true });
      byEmail.set(updated.email, updated);
      byCode.set(sanitizeEmployeeCode(updated.employee_code || ""), updated);
      continue;
    }

    const temporaryPassword = generateTemporaryPassword();
    const { data: inserted, error: insertError } = await supabase
      .from("org_people")
      .insert({
        company_id: req.orgCompanyId,
        employee_code: row.employee_code,
        email: row.email,
        name: row.name,
        role: "employee",
        status: row.status,
        password_hash: await bcrypt.hash(temporaryPassword, 10),
        must_reset_password: true,
        password_expires_at: tempPasswordExpiryIso(),
        invited_at: row.invited_at,
      })
      .select("id, employee_code, email, name, role, status, invited_at, created_at")
      .single();
    if (insertError) {
      console.error("Insert person failed:", insertError);
      responseRows.push({ ...row, email_sent: false, email_error: insertError.message || "Insert failed." });
      continue;
    }

    responseRows.push({ ...inserted, temporary_password: temporaryPassword });
    byEmail.set(inserted.email, inserted);
    byCode.set(sanitizeEmployeeCode(inserted.employee_code || ""), inserted);
  }

  // Creating a person only saves the record. Sending credentials is an
  // explicit action (Invite / Resend invite) so admins can review the list
  // before any email leaves the portal.
  return res.status(201).json(responseRows.map((row) => ({ ...row, email_sent: false })));
});

app.patch("/api/org/people/:id", requireOrgManager, requireStandaloneEmployeeAccess, async (req, res) => {
  const updates = {};
  if (req.body?.name !== undefined) updates.name = sanitizeText(req.body.name);
  if (req.body?.email !== undefined) updates.email = sanitizeEmail(req.body.email);
  if (req.body?.employee_code !== undefined || req.body?.employeeCode !== undefined) {
    updates.employee_code = sanitizeEmployeeCode(req.body.employee_code || req.body.employeeCode || "");
    if (!updates.employee_code) return res.status(400).send("Employee code is required.");
  }
  if (req.body?.status !== undefined) {
    const allowed = new Set(["draft", "invited", "active", "disabled"]);
    if (!allowed.has(req.body.status)) return res.status(400).send("Invalid status.");
    updates.status = req.body.status;
    if (req.body.status === "invited") updates.invited_at = new Date().toISOString();
  }
  if (!Object.keys(updates).length) return res.status(400).send("No person changes provided.");

  const { data, error } = await supabase
    .from("org_people")
    .update(updates)
    .eq("id", req.params.id)
    .eq("company_id", req.orgCompanyId)
    .eq("role", "employee")
    .select("id, employee_code, email, name, role, status, invited_at, created_at")
    .maybeSingle();
  if (error) {
    console.error("Update person failed:", error);
    return res.status(500).send(error.message || "Failed to update person.");
  }
  if (!data) return res.status(404).send("Person not found.");
  return res.json(data);
});

app.delete("/api/org/people/:id", requireOrgManager, requireStandaloneEmployeeAccess, async (req, res) => {
  const { error } = await supabase
    .from("org_people")
    .delete()
    .eq("id", req.params.id)
    .eq("company_id", req.orgCompanyId)
    .eq("role", "employee");
  if (error) {
    console.error("Delete person failed:", error);
    return res.status(500).send(error.message || "Failed to delete person.");
  }
  return res.json({ ok: true });
});

// Reset and send fresh temporary credentials to a person. Standalone-mode only.
app.post("/api/org/people/:id/resend-invite", requireOrgManager, requireStandaloneEmployeeAccess, async (req, res) => {
  const [{ data: existing, error: lookupError }, { data: company }] = await Promise.all([
    supabase
      .from("org_people")
      .select("id, employee_code, email, name, role")
      .eq("id", req.params.id)
      .eq("company_id", req.orgCompanyId)
      .maybeSingle(),
    supabase.from("companies").select("id, name, slug").eq("id", req.orgCompanyId).maybeSingle(),
  ]);
  if (lookupError) {
    console.error("Resend lookup failed:", lookupError);
    return res.status(500).send("Failed to look up person.");
  }
  if (!existing) return res.status(404).send("Person not found.");

  try {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const { error: passwordError } = await supabase
      .from("org_people")
      .update({ password_hash: passwordHash, must_reset_password: true, password_expires_at: tempPasswordExpiryIso() })
      .eq("id", existing.id)
      .eq("company_id", req.orgCompanyId);
    if (passwordError) throw passwordError;
    // Nuke live sessions BEFORE the email attempt. The password on disk is
    // already rotated at this point, so a stale cookie must not survive
    // even if SMTP fails and we return an error.
    await nukeSessionsForUsers([existing.id]);
    await sendEmployeeCredentials({
      companyId: req.orgCompanyId,
      orgName: company?.name || "Your organization",
      orgSlug: company?.slug || "",
      to: existing.email,
      name: existing.name,
      employeeCode: existing.employee_code,
      password: temporaryPassword,
      req,
    });
    await supabase
      .from("org_people")
      .update({ invited_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("company_id", req.orgCompanyId);
    return res.json({
      ok: true,
      email: existing.email,
      email_sent: true,
      temporary_password: temporaryPassword,
    });
  } catch (err) {
    console.error("Credential resend failed:", err);
    return res.status(500).json({
      ok: false,
      email_sent: false,
      email_error: err.message || "Credentials email failed.",
    });
  }
});

// Session-authenticated password change. Used by the first-login flow when
// `must_reset_password` is true (temp password from an invite is still in
// use). No OTP required — the current session proves the temp password was
// just verified. Clears the reset flag so the redirect gate lifts.
app.post("/api/password/change", async (req, res) => {
  const user = req.session?.user;
  if (!user?.id || !user?.companyId) return res.status(401).send("Sign in first.");
  const nextPassword = String(req.body?.password || "");
  if (nextPassword.length < 8) return res.status(400).send("Password must be at least 8 characters.");
  try {
    const passwordHash = await bcrypt.hash(nextPassword, 10);
    const { error } = await supabase
      .from("org_people")
      .update({ password_hash: passwordHash, must_reset_password: false, password_expires_at: null })
      .eq("id", user.id)
      .eq("company_id", user.companyId);
    if (error) throw error;
    req.session.user.mustResetPassword = false;
    // Force a write to the session store before responding — otherwise
    // the next request can race the async save and read a stale copy
    // where mustResetPassword is still true, keeping the gate stuck on.
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Password change failed:", error);
    return res.status(500).send(error.message || "Could not change password.");
  }
});

// Bulk invite for a caller-supplied list of person ids. Same behaviour as
// invite-all (regenerates temp password → resends email → updates
// `invited_at`) but scoped to the selection.
app.post("/api/org/people/invite-many", requireOrgManager, requireStandaloneEmployeeAccess, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (!ids.length) return res.status(400).send("Select at least one person to invite.");
  const [{ data: people, error: peopleError }, { data: company }] = await Promise.all([
    supabase
      .from("org_people")
      .select("id, employee_code, email, name, role")
      .eq("company_id", req.orgCompanyId)
      .in("id", ids)
      .neq("role", "super_admin"),
    supabase.from("companies").select("id, name, slug").eq("id", req.orgCompanyId).maybeSingle(),
  ]);
  if (peopleError) {
    console.error("Invite-many lookup failed:", peopleError);
    return res.status(500).send("Failed to load selected people.");
  }
  const targets = (people || []).filter((p) => p.email);
  let sent = 0;
  let failed = 0;
  const skipped = ids.length - targets.length;
  const errors = [];
  for (const person of targets) {
    try {
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);
      const { error: passwordError } = await supabase
        .from("org_people")
        .update({ password_hash: passwordHash, must_reset_password: true, password_expires_at: tempPasswordExpiryIso() })
        .eq("id", person.id)
        .eq("company_id", req.orgCompanyId);
      if (passwordError) throw passwordError;
      // Nuke sessions right after the DB rotation, before the email send.
      // If SMTP fails downstream we still want the old cookie dead.
      await nukeSessionsForUsers([person.id]);
      await sendEmployeeCredentials({
        companyId: req.orgCompanyId,
        orgName: company?.name || "Your organization",
        orgSlug: company?.slug || "",
        to: person.email,
        name: person.name,
        employeeCode: person.employee_code,
        password: temporaryPassword,
        req,
      });
      await supabase
        .from("org_people")
        .update({ invited_at: new Date().toISOString() })
        .eq("id", person.id)
        .eq("company_id", req.orgCompanyId);
      sent += 1;
    } catch (err) {
      failed += 1;
      errors.push({ id: person.id, email: person.email, error: err?.message || String(err) });
      console.error(`Invite-many failed for ${person.email}:`, err);
    }
  }
  return res.json({ sent, failed, skipped, errors });
});

// Bulk delete with full cleanup: magic tokens, password-reset OTPs, chat
// usage, then the org_people row itself. Super admins and the caller
// themselves are always skipped.
app.post("/api/org/people/delete-many", requireOrgManager, requireStandaloneEmployeeAccess, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (!ids.length) return res.status(400).send("Select at least one person to delete.");
  const callerId = req.session?.user?.id;
  const { data: people, error: lookupError } = await supabase
    .from("org_people")
    .select("id, email, role")
    .eq("company_id", req.orgCompanyId)
    .in("id", ids);
  if (lookupError) {
    console.error("Delete-many lookup failed:", lookupError);
    return res.status(500).send("Failed to load selected people.");
  }
  const targets = (people || []).filter((p) => p.role !== "super_admin" && p.id !== callerId);
  const skipped = ids.length - targets.length;
  let deleted = 0;
  let failed = 0;
  const errors = [];
  const deletedIds = [];
  for (const person of targets) {
    try {
      // 1. Magic tokens — the invite/recovery links emailed to them.
      const { error: tokenErr } = await supabase
        .from("magic_tokens")
        .delete()
        .eq("company_id", req.orgCompanyId)
        .eq("email", person.email);
      if (tokenErr && tokenErr.code !== "42P01") throw tokenErr;

      // 2. Password reset OTPs.
      const { error: otpErr } = await supabase
        .from("password_reset_otps")
        .delete()
        .eq("person_id", person.id);
      if (otpErr && otpErr.code !== "42P01") throw otpErr;

      // 3. Chat usage rows.
      const { error: chatErr } = await supabase
        .from("chat_usage")
        .delete()
        .eq("user_id", String(person.id));
      if (chatErr && chatErr.code !== "42P01") throw chatErr;

      // 4. Finally, the person row (kills password_hash + invited_at).
      const { error: personErr } = await supabase
        .from("org_people")
        .delete()
        .eq("id", person.id)
        .eq("company_id", req.orgCompanyId);
      if (personErr) throw personErr;

      deleted += 1;
      deletedIds.push(person.id);
    } catch (err) {
      failed += 1;
      errors.push({ id: person.id, email: person.email, error: err?.message || String(err) });
      console.error(`Delete-many failed for ${person.email}:`, err);
    }
  }
  // Kill any live server-side session belonging to a deleted user so the
  // "cookie already in a browser" case can't stay logged in past deletion.
  const sessionsRemoved = await nukeSessionsForUsers(deletedIds);
  return res.json({ deleted, failed, skipped, errors, sessions_invalidated: sessionsRemoved });
});

// Bulk invite: reissues a temporary password and re-sends the credentials
// email to every non-super-admin person in this org. Super admins are
// skipped because they're the site owner, not an invitee.
app.post("/api/org/people/invite-all", requireOrgManager, requireStandaloneEmployeeAccess, async (req, res) => {
  const [{ data: people, error: peopleError }, { data: company }] = await Promise.all([
    supabase
      .from("org_people")
      .select("id, employee_code, email, name, role")
      .eq("company_id", req.orgCompanyId)
      .neq("role", "super_admin"),
    supabase.from("companies").select("id, name, slug").eq("id", req.orgCompanyId).maybeSingle(),
  ]);
  if (peopleError) {
    console.error("Invite-all lookup failed:", peopleError);
    return res.status(500).send("Failed to load people.");
  }
  const targets = (people || []).filter((p) => p.email);
  let sent = 0;
  let failed = 0;
  const skipped = (people || []).length - targets.length;
  const errors = [];
  for (const person of targets) {
    try {
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);
      const { error: passwordError } = await supabase
        .from("org_people")
        .update({ password_hash: passwordHash, must_reset_password: true, password_expires_at: tempPasswordExpiryIso() })
        .eq("id", person.id)
        .eq("company_id", req.orgCompanyId);
      if (passwordError) throw passwordError;
      // Session nuke happens BEFORE the email attempt so a downstream
      // SMTP failure can't leave a stale cookie authenticated against a
      // password_hash that's already been rotated on disk.
      await nukeSessionsForUsers([person.id]);
      await sendEmployeeCredentials({
        companyId: req.orgCompanyId,
        orgName: company?.name || "Your organization",
        orgSlug: company?.slug || "",
        to: person.email,
        name: person.name,
        employeeCode: person.employee_code,
        password: temporaryPassword,
        req,
      });
      await supabase
        .from("org_people")
        .update({ invited_at: new Date().toISOString() })
        .eq("id", person.id)
        .eq("company_id", req.orgCompanyId);
      sent += 1;
    } catch (err) {
      failed += 1;
      errors.push({ id: person.id, email: person.email, error: err?.message || String(err) });
      console.error(`Invite-all failed for ${person.email}:`, err);
    }
  }
  return res.json({ sent, failed, skipped, errors });
});

// Org-level settings (currently just access_mode). Falls back to 'standalone'
// if the access_mode column from schema.sql hasn't been applied yet.
const VALID_ACCESS_MODES = new Set(["standalone", "hrms_link"]);
const toBrandingPayload = (company = {}) => ({
  theme_id: company?.theme_id || "default",
  logo_url: company?.logo_url || "",
  portal_name: company?.portal_name || company?.name || "",
  login_background_color: company?.login_background_color || "",
  login_background_image_url: company?.login_background_image_url || "",
});

app.get("/api/org/settings", requireOrgManager, async (req, res) => {
  const { data, error } = await supabase
    .from("companies")
    .select("access_mode, slug, name, theme_id, logo_url, portal_name, login_background_color, login_background_image_url")
    .eq("id", req.orgCompanyId)
    .maybeSingle();
  if (error && !isMissingColumnError(error)) {
    console.error("Load settings failed:", error);
    return res.status(500).send("Failed to load settings.");
  }
  return res.json({
    access_mode: data?.access_mode || "standalone",
    login_url: data?.slug ? buildOrgLoginUrl(req, data.slug, "index.html#login") : null,
    branding: toBrandingPayload(data),
  });
});

app.patch("/api/org/settings", requireOrgManager, async (req, res) => {
  const mode = sanitizeText(req.body?.access_mode || "");
  if (!VALID_ACCESS_MODES.has(mode)) {
    return res.status(400).send("Invalid access_mode.");
  }
  const updates = { access_mode: mode };
  if (req.body?.theme_id !== undefined) {
    const allowedThemes = new Set(["default", "sky", "sand", "mint", "midnight", "carbon"]);
    if (!allowedThemes.has(req.body.theme_id)) return res.status(400).send("Invalid theme.");
    updates.theme_id = req.body.theme_id;
  }
  if (req.body?.portal_name !== undefined) updates.portal_name = sanitizeText(req.body.portal_name).slice(0, 80);
  if (req.body?.login_background_color !== undefined) {
    const color = sanitizeText(req.body.login_background_color);
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) return res.status(400).send("Invalid background color.");
    updates.login_background_color = color || null;
  }
  try {
    if (req.body?.logo_url !== undefined) updates.logo_url = validateBrandingImage(req.body.logo_url, BRANDING_LIMITS.logo, "Logo");
    if (req.body?.login_background_image_url !== undefined) updates.login_background_image_url = validateBrandingImage(req.body.login_background_image_url, BRANDING_LIMITS.background, "Background image");
  } catch (error) {
    return res.status(400).send(error.message);
  }
  const { data, error } = await supabase
    .from("companies")
    .update(updates)
    .eq("id", req.orgCompanyId)
    .select("access_mode, slug, name, theme_id, logo_url, portal_name, login_background_color, login_background_image_url")
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) {
      return res
        .status(500)
        .send("access_mode column missing. Run server/schema.sql in Supabase first.");
    }
    console.error("Update settings failed:", error);
    return res.status(500).send(error.message || "Failed to update settings.");
  }
  if (req.session?.user?.selectedCompany?.id === req.orgCompanyId && data) {
    req.session.user.selectedCompany = {
      ...req.session.user.selectedCompany,
      ...data,
    };
  }
  return res.json({
    access_mode: data?.access_mode || mode,
    login_url: data?.slug ? buildOrgLoginUrl(req, data.slug, "index.html#login") : null,
    branding: toBrandingPayload(data),
  });
});

app.get("/api/org/hrms-launch-config", requireOrgManager, async (req, res) => {
  const { data: company, error } = await supabase
    .from("companies")
    .select("id, name, slug, access_mode")
    .eq("id", req.orgCompanyId)
    .maybeSingle();
  if (error) {
    console.error("Load HRMS launch config failed:", error);
    return res.status(500).send("Failed to load HRMS launch config.");
  }
  if (!company) return res.status(404).send("Organization not found.");
  const settings = await getOrgHrmsSettings(company.id);
  const secret = settings?.launch_secret || HRMS_LAUNCH_SECRET || "";
  return res.json({
    org: { name: company.name, slug: company.slug, access_mode: company.access_mode || "standalone" },
    launch_path: "/api/hrms/launch",
    launch_url_template: buildHrmsLaunchTemplate({ req, company, secret }),
    secret_configured: Boolean(secret),
    enabled: settings?.enabled === true,
    allowed_origin: settings?.allowed_origin || "",
  });
});

app.get("/api/org/hrms-settings", requireSuperAdmin, async (req, res) => {
  const companyId = resolveRequestCompanyId(req);
  if (!companyId) return res.status(400).send("Organization context is required.");
  const { data: company, error } = await supabase
    .from("companies")
    .select("id, name, slug, access_mode")
    .eq("id", companyId)
    .maybeSingle();
  if (error) return res.status(500).send("Failed to load organization.");
  if (!company) return res.status(404).send("Organization not found.");
  const settings = await getOrgHrmsSettings(companyId);
  const secret = settings?.launch_secret || "";
  return res.json({
    org: company,
    enabled: settings?.enabled === true,
    allowed_origin: settings?.allowed_origin || "",
    launch_secret: secret,
    secret_present: Boolean(secret),
    last_rotated_at: settings?.last_rotated_at || null,
    updated_at: settings?.updated_at || null,
    launch_path: "/api/hrms/launch",
    launch_url_template: buildHrmsLaunchTemplate({ req, company, secret }),
  });
});

app.put("/api/org/hrms-settings", requireSuperAdmin, async (req, res) => {
  const companyId = resolveRequestCompanyId(req);
  if (!companyId) return res.status(400).send("Organization context is required.");
  const enabled = req.body?.enabled === true;
  const allowedOrigin = normalizeOrigin(req.body?.allowed_origin || "");
  if (enabled && !allowedOrigin) return res.status(400).send("A valid HRMS iframe origin is required.");

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name, slug, access_mode")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) return res.status(500).send("Failed to load organization.");
  if (!company) return res.status(404).send("Organization not found.");

  const existing = await getOrgHrmsSettings(companyId);
  const now = new Date().toISOString();
  const launchSecret = existing?.launch_secret || generateHrmsSecret();
  const [{ error: settingsError }, { error: companyUpdateError }] = await Promise.all([
    supabase.from("org_hrms_settings").upsert(
      {
        company_id: companyId,
        enabled,
        allowed_origin: allowedOrigin,
        launch_secret: launchSecret,
        last_rotated_at: existing?.last_rotated_at || now,
        updated_at: now,
      },
      { onConflict: "company_id" }
    ),
    supabase
      .from("companies")
      .update({ access_mode: enabled ? "hrms_link" : "standalone" })
      .eq("id", companyId),
  ]);
  if (settingsError || companyUpdateError) {
    console.error("Save HRMS settings failed:", settingsError || companyUpdateError);
    return res.status(500).send("Failed to save HRMS settings. Run server/schema.sql if this database is not migrated.");
  }
  company.access_mode = enabled ? "hrms_link" : "standalone";
  return res.json({
    org: company,
    enabled,
    allowed_origin: allowedOrigin,
    launch_secret: launchSecret,
    secret_present: true,
    last_rotated_at: existing?.last_rotated_at || now,
    updated_at: now,
    launch_path: "/api/hrms/launch",
    launch_url_template: buildHrmsLaunchTemplate({ req, company, secret: launchSecret }),
  });
});

app.post("/api/org/hrms-settings/rotate", requireSuperAdmin, async (req, res) => {
  const companyId = resolveRequestCompanyId(req);
  if (!companyId) return res.status(400).send("Organization context is required.");
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name, slug, access_mode")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) return res.status(500).send("Failed to load organization.");
  if (!company) return res.status(404).send("Organization not found.");
  const existing = await getOrgHrmsSettings(companyId);
  const now = new Date().toISOString();
  const launchSecret = generateHrmsSecret();
  const { error } = await supabase.from("org_hrms_settings").upsert(
    {
      company_id: companyId,
      enabled: existing?.enabled === true,
      allowed_origin: existing?.allowed_origin || "",
      launch_secret: launchSecret,
      last_rotated_at: now,
      updated_at: now,
    },
    { onConflict: "company_id" }
  );
  if (error) return res.status(500).send("Failed to rotate HRMS secret.");
  return res.json({
    org: company,
    enabled: existing?.enabled === true,
    allowed_origin: existing?.allowed_origin || "",
    launch_secret: launchSecret,
    secret_present: true,
    last_rotated_at: now,
    updated_at: now,
    launch_path: "/api/hrms/launch",
    launch_url_template: buildHrmsLaunchTemplate({ req, company, secret: launchSecret }),
  });
});

// Validator for the HRMS team: post the params + signature you generated, get
// back exactly which check failed. Does NOT create a session, does NOT redirect.
// Rate-limited (login limiter) so it can't be used for offline signature
// brute-force.
app.post("/api/hrms/test", loginLimiter, async (req, res) => {
  const reasons = [];

  const org = slugify(req.body?.org || "");
  const email = sanitizeEmail(req.body?.email || "");
  const name = sanitizeText(req.body?.name || "");
  const role = req.body?.role === "admin" ? "admin" : "employee";
  const externalId = sanitizeText(req.body?.external_id || "");
  const exp = Number(req.body?.exp || 0);
  const sig = String(req.body?.sig || "").trim();
  const now = Math.floor(Date.now() / 1000);

  if (!org) reasons.push("missing/invalid org");
  if (!email) reasons.push("missing/invalid email");
  if (!exp) reasons.push("missing exp");
  else if (exp < now) reasons.push(`exp is in the past (server time ${now}, exp ${exp})`);
  else if (exp > now + 60 * 15) reasons.push(`exp is more than 15 min from now (server time ${now}, exp ${exp})`);
  if (!sig) reasons.push("missing sig");

  let org_status = null;
  let secret = "";
  let expected = "";
  if (org) {
    const { data: company } = await supabase
      .from("companies")
      .select("id, name, slug, access_mode")
      .eq("slug", org)
      .maybeSingle();
    if (!company) {
      reasons.push(`org slug "${org}" does not exist`);
      org_status = "not_found";
    } else if ((company.access_mode || "standalone") !== "hrms_link") {
      reasons.push(`org "${org}" is not in hrms_link mode (current: ${company.access_mode || "standalone"})`);
      org_status = "wrong_mode";
    } else {
      const settings = await getOrgHrmsSettings(company.id);
      if (!settings?.enabled) reasons.push(`org "${org}" HRMS settings are not enabled`);
      secret = settings?.launch_secret || HRMS_LAUNCH_SECRET || "";
      if (!secret) reasons.push(`org "${org}" launch secret is not configured`);
      org_status = "ok";
    }
  }

  const canonical = buildHrmsCanonicalPayload({ org, email, name, role, exp, externalId });
  expected = secret ? signHrmsLaunch(canonical, secret) : "";
  if (sig && expected && !safeEqualHex(sig, expected)) {
    reasons.push("signature mismatch — check your secret and canonical string");
  }

  return res.json({
    ok: reasons.length === 0,
    server_time_unix: now,
    canonical_string: canonical,
    expected_signature: expected || "(secret not configured)",
    your_signature: sig,
    org_status,
    failures: reasons,
  });
});

app.get("/api/hrms/launch", async (req, res) => {
  // Every field must be a single scalar. If any arrives as an array (a
  // repeated query key from a param-pollution attempt) we abort — we
  // cannot know which value the HMAC signer intended.
  const orgRaw = singleQueryParam(req.query.org);
  const emailRaw = singleQueryParam(req.query.email);
  const nameRaw = singleQueryParam(req.query.name);
  const roleRaw = singleQueryParam(req.query.role);
  const externalIdRaw = singleQueryParam(req.query.external_id);
  const expRaw = singleQueryParam(req.query.exp);
  const sigRaw = singleQueryParam(req.query.sig);
  if ([orgRaw, emailRaw, nameRaw, roleRaw, externalIdRaw, expRaw, sigRaw].some((v) => v === null)) {
    return res.status(400).send("Duplicate HRMS launch parameters.");
  }

  const org = slugify(orgRaw || req.company?.slug || "");
  const email = sanitizeEmail(emailRaw);
  const name = sanitizeText(nameRaw);
  // Hard allowlist. HRMS never gets to assert super_admin — that would
  // let a compromised HRMS mint a god account on our platform.
  const role = roleRaw === "admin" ? "admin" : "employee";
  const externalId = sanitizeText(externalIdRaw);
  const exp = Number(expRaw || 0);
  const sig = sigRaw.trim();
  const now = Math.floor(Date.now() / 1000);

  if (!org || !email || !exp || !sig) {
    return res.status(400).send("Missing HRMS launch parameters.");
  }
  if (exp < now) {
    return res.status(401).send("HRMS launch link expired.");
  }
  if (exp > now + 60 * 15) {
    return res.status(400).send("HRMS launch expiry is too long.");
  }

  const { data: company, error } = await supabase
    .from("companies")
    .select("id, name, slug, access_mode")
    .eq("slug", org)
    .maybeSingle();
  if (error) {
    console.error("HRMS launch org lookup failed:", error);
    return res.status(500).send("Unable to verify organization.");
  }
  if (!company) return res.status(404).send("Organization not found.");
  if ((company.access_mode || "standalone") !== "hrms_link") {
    return res.status(403).send("HRMS launch is not enabled for this organization.");
  }

  const settings = await getOrgHrmsSettings(company.id);
  if (!settings?.enabled) return res.status(403).send("HRMS launch is not enabled for this organization.");
  const secret = settings.launch_secret || HRMS_LAUNCH_SECRET || "";
  if (!secret) return res.status(500).send("HRMS launch secret is not configured.");
  const allowedOrigin = normalizeOrigin(settings.allowed_origin || "");
  if (allowedOrigin) {
    res.setHeader("Content-Security-Policy", `frame-ancestors 'self' ${allowedOrigin}`);
  }

  const canonical = buildHrmsCanonicalPayload({ org, email, name, role, exp, externalId });
  const expected = signHrmsLaunch(canonical, secret);
  if (!safeEqualHex(sig, expected)) {
    return res.status(401).send("Invalid HRMS launch signature.");
  }

  await establishAuthenticatedSession(req, {
    id: `hrms:${company.id}:${externalId || email}`,
    email,
    name: name || email,
    role,
    companyId: company.id,
    authSource: "hrms",
    externalId: externalId || null,
    selectedCompany: company,
  });
  req.session.user.selectedCompany = company;

  return res.redirect(303, "/policies.html");
});

const ensureOrgEmailTemplates = async (companyId) => {
  const { data: existing, error: loadError } = await supabase
    .from("org_email_templates")
    .select("id, company_id, name, subject, body, is_default, created_at, updated_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  if (loadError) throw loadError;
  if (existing?.length) return existing;

  const { data: legacyDraft } = await supabase
    .from("org_email_drafts")
    .select("subject, body")
    .eq("company_id", companyId)
    .maybeSingle();
  const { data: created, error: createError } = await supabase
    .from("org_email_templates")
    .insert({
      company_id: companyId,
      name: "Employee invitation",
      subject: legacyDraft?.subject?.trim() || DEFAULT_INVITE_SUBJECT,
      body: legacyDraft?.body?.trim() || DEFAULT_INVITE_BODY,
      is_default: true,
    })
    .select("id, company_id, name, subject, body, is_default, created_at, updated_at")
    .single();
  if (createError) throw createError;
  return [created];
};

app.get("/api/org/email-templates", requireOrgManager, async (req, res) => {
  try {
    return res.json(await ensureOrgEmailTemplates(req.orgCompanyId));
  } catch (error) {
    console.error("Load communication templates failed:", error);
    return res.status(500).send("Failed to load communication templates.");
  }
});

app.post("/api/org/email-templates", requireOrgManager, async (req, res) => {
  const name = sanitizeText(req.body?.name || "").slice(0, 80);
  if (!name) return res.status(400).send("Template name is required.");
  const subject = sanitizeText(req.body?.subject || DEFAULT_INVITE_SUBJECT).slice(0, 200);
  const body = String(req.body?.body || DEFAULT_INVITE_BODY).trim().slice(0, 20_000);
  try {
    const existing = await ensureOrgEmailTemplates(req.orgCompanyId);
    const { data, error } = await supabase
      .from("org_email_templates")
      .insert({
        company_id: req.orgCompanyId,
        name,
        subject,
        body,
        is_default: existing.length === 0,
      })
      .select("id, company_id, name, subject, body, is_default, created_at, updated_at")
      .single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (error) {
    console.error("Create communication template failed:", error);
    return res.status(500).send("Failed to create communication template.");
  }
});

app.put("/api/org/email-templates/:id", requireOrgManager, async (req, res) => {
  const name = sanitizeText(req.body?.name || "").slice(0, 80);
  const subject = sanitizeText(req.body?.subject || "").slice(0, 200);
  const body = String(req.body?.body || "").trim().slice(0, 20_000);
  if (!name || !subject || !body) {
    return res.status(400).send("Template name, subject, and body are required.");
  }
  const { data, error } = await supabase
    .from("org_email_templates")
    .update({ name, subject, body, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("company_id", req.orgCompanyId)
    .select("id, company_id, name, subject, body, is_default, created_at, updated_at")
    .maybeSingle();
  if (error) {
    console.error("Save communication template failed:", error);
    return res.status(500).send("Failed to save communication template.");
  }
  if (!data) return res.status(404).send("Template not found.");
  return res.json(data);
});

app.post("/api/org/email-templates/:id/default", requireOrgManager, async (req, res) => {
  const { data: target } = await supabase
    .from("org_email_templates")
    .select("id")
    .eq("id", req.params.id)
    .eq("company_id", req.orgCompanyId)
    .maybeSingle();
  if (!target) return res.status(404).send("Template not found.");

  const { error: clearError } = await supabase
    .from("org_email_templates")
    .update({ is_default: false })
    .eq("company_id", req.orgCompanyId)
    .eq("is_default", true);
  if (clearError) return res.status(500).send("Failed to update active template.");
  const { data, error } = await supabase
    .from("org_email_templates")
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("company_id", req.orgCompanyId)
    .select("id, company_id, name, subject, body, is_default, created_at, updated_at")
    .single();
  if (error) {
    console.error("Set active communication template failed:", error);
    return res.status(500).send("Failed to update active template.");
  }
  return res.json(data);
});

app.delete("/api/org/email-templates/:id", requireOrgManager, async (req, res) => {
  const templates = await ensureOrgEmailTemplates(req.orgCompanyId);
  if (templates.length <= 1) return res.status(400).send("Keep at least one communication template.");
  const target = templates.find((template) => template.id === req.params.id);
  if (!target) return res.status(404).send("Template not found.");

  const { error } = await supabase
    .from("org_email_templates")
    .delete()
    .eq("id", req.params.id)
    .eq("company_id", req.orgCompanyId);
  if (error) {
    console.error("Delete communication template failed:", error);
    return res.status(500).send("Failed to delete communication template.");
  }
  if (target.is_default) {
    const replacement = templates.find((template) => template.id !== target.id);
    await supabase
      .from("org_email_templates")
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq("id", replacement.id)
      .eq("company_id", req.orgCompanyId);
  }
  return res.json({ ok: true });
});

app.get("/api/org/email-settings", requireOrgManager, async (req, res) => {
  const [{ data: smtp }, { data: draft }] = await Promise.all([
    supabase
      .from("org_smtp_settings")
      .select("host, port, username, from_email, from_name, updated_at")
      .eq("company_id", req.orgCompanyId)
      .maybeSingle(),
    supabase
      .from("org_email_drafts")
      .select("subject, body, updated_at")
      .eq("company_id", req.orgCompanyId)
      .maybeSingle(),
  ]);
  return res.json({ smtp: smtp || {}, draft: draft || {} });
});

app.put("/api/org/email-settings", requireOrgManager, async (req, res) => {
  const smtp = req.body?.smtp || {};
  const draft = req.body?.draft;
  const now = new Date().toISOString();
  const smtpPayload = {
    company_id: req.orgCompanyId,
    host: sanitizeText(smtp.host || ""),
    port: Number(smtp.port || 0) || null,
    username: sanitizeText(smtp.username || ""),
    password: smtp.password === undefined ? undefined : encryptSecret(String(smtp.password || "")),
    from_email: sanitizeEmail(smtp.from_email || ""),
    from_name: sanitizeText(smtp.from_name || ""),
    updated_at: now,
  };
  if (smtp.password === undefined) delete smtpPayload.password;

  const draftPayload = draft
    ? {
        company_id: req.orgCompanyId,
        subject: sanitizeText(draft.subject || "You have been invited to the policy portal"),
        body: String(draft.body || "Hello {{name}}, you have been added to the {{organization}} policy portal.").trim(),
        updated_at: now,
      }
    : null;
  const [{ error: smtpError }, draftResult] = await Promise.all([
    supabase.from("org_smtp_settings").upsert(smtpPayload, { onConflict: "company_id" }),
    draftPayload
      ? supabase.from("org_email_drafts").upsert(draftPayload, { onConflict: "company_id" })
      : Promise.resolve({ error: null }),
  ]);
  const draftError = draftResult.error;
  if (smtpError || draftError) {
    console.error("Save email settings failed:", smtpError || draftError);
    return res.status(500).send("Failed to save email settings.");
  }
  return res.json({ ok: true });
});

app.delete("/api/admin/orgs/:id", requireSuperAdmin, async (req, res) => {
  const orgId = req.params.id;

  // Tables that reference companies but don't have ON DELETE CASCADE:
  // legacy user_profiles + policy_documents/chunks. Wipe their rows first
  // so the company delete doesn't trip on a foreign-key constraint.
  // (org_modules and org_policies already cascade.)
  for (const table of ["user_profiles", "policy_chunks", "policy_documents"]) {
    const { error: clearError } = await supabase.from(table).delete().eq("company_id", orgId);
    if (clearError && clearError.code !== "42P01") {
      // 42P01 = "relation does not exist" — fine, table may not be present.
      console.error(`Cleanup of ${table} failed:`, clearError);
      return res.status(500).send(`Failed to delete organization (${table}).`);
    }
  }

  const { error } = await supabase.from("companies").delete().eq("id", orgId);
  if (error) {
    console.error("Delete org failed:", error);
    return res.status(500).send(error.message || "Failed to delete organization.");
  }
  return res.json({ ok: true });
});

app.get("/api/session", async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).send("Not authenticated.");
  }
  // The portal theme is enforced org-wide, so every gated page needs it. On a
  // subdomain it's already on req.company; on the root/localhost path we resolve
  // it from the user's company (one indexed read per session check).
  let branding = req.company
    ? toBrandingPayload(req.company)
    : req.session.user.selectedCompany?.theme_id !== undefined
      ? toBrandingPayload(req.session.user.selectedCompany)
      : null;
  if (!branding) {
    const companyId = req.session.user.companyId;
    if (companyId) {
      try {
        const { data } = await supabase
          .from("companies")
          .select("name, theme_id, logo_url, portal_name, login_background_color, login_background_image_url")
          .eq("id", companyId)
          .maybeSingle();
        branding = toBrandingPayload(data);
      } catch (error) {
        console.error("Session branding lookup failed:", error);
      }
    }
  }
  // Advertise the product root host so the client can build subdomain URLs
  // (login link, org tile links) without parsing window.location — which
  // gets things like `policies.zarohr.com` wrong by chopping only the
  // first label.
  return res.json({
    ...req.session.user,
    theme_id: branding?.theme_id || "default",
    branding: branding || toBrandingPayload(),
    rootHost: ROOT_HOST,
    rootPort: IS_PRODUCTION ? null : PORT,
    csrfToken: ensureCsrfToken(req),
  });
});

// Public, no-auth lightweight context used by the login page to decide which
// flow to render. The server is the authority on subdomain/root because it
// runs the Host-header → company resolution. Trying to infer this on the
// client from `window.location.hostname` is fragile across deployments.
app.get("/api/auth/context", (req, res) => {
  res.set("Cache-Control", "no-store");
  const isHrmsOrg = req.company && (req.company.access_mode || "standalone") === "hrms_link";
  return res.json({
    // hrms_only = the page should not offer email-login at all; the only
    // valid entry is a signed HRMS launch.
    mode: !req.company ? "password" : isHrmsOrg ? "hrms_only" : "standalone",
    org: req.company ? {
      name: req.company.name,
      slug: req.company.slug,
      branding: {
        theme_id: req.company.theme_id || "default",
        logo_url: req.company.logo_url || "",
        portal_name: req.company.portal_name || req.company.name || "",
        login_background_color: req.company.login_background_color || "",
        login_background_image_url: req.company.login_background_image_url || "",
      },
    } : null,
  });
});

app.get("/api/org/access", requireOrgAccess, (req, res) => {
  return res.json({ ok: true, role: req.session.user.role, company_id: req.orgCompanyId });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post("/api/upload", uploadLimiter, requireOrgManager, upload.single("file"), async (req, res) => {
  const { policyId } = req.body || {};
  const displayName = sanitizeText(req.body?.displayName || "");
  const file = req.file;
  if (!policyId) {
    return res.status(400).send("Missing policy ID.");
  }
  if (!file) {
    return res.status(400).send("Missing file.");
  }
  const fileValidationError = validatePolicyUpload(file);
  if (fileValidationError) {
    return res.status(400).send(fileValidationError);
  }

  const { data: policyRow } = await supabase
    .from("org_policies")
    .select("id")
    .eq("id", policyId)
    .eq("company_id", req.orgCompanyId)
    .maybeSingle();
  if (!policyRow) return res.status(404).send("Policy not found.");

  // Each upload replaces the previous file for this policy: wipe prior
  // document rows, their chunks, and the storage object before inserting.
  const cleared = await clearPolicyArtifacts({ policyIds: [policyId], companyId: req.orgCompanyId });
  if (!cleared.ok) {
    return res.status(500).send(cleared.message || "Failed to replace previous file.");
  }

  const timestamp = Date.now();
  const safeName = sanitizeFilename(file.originalname);
  const filePath = `private/${policyId}/${timestamp}-${safeName}`;

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("policy-files")
    .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: false });

  if (uploadError) {
    console.error("Storage upload failed:", uploadError);
    return res.status(500).send(uploadError.message || "Upload failed.");
  }

  const storedPath = uploadData?.path || filePath;
  const { data: documentRow, error: insertError } = await supabase
    .from("policy_documents")
    .insert({
      policy_id: policyId,
      file_path: storedPath,
      display_name: displayName || file.originalname,
      uploaded_by: isUuid(req.session.user.id) ? req.session.user.id : null,
      company_id: req.orgCompanyId,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("Insert failed:", insertError);
    return res.status(500).send(insertError.message || "Upload failed.");
  }

  try {
    const indexResult = await indexPolicyDocument({
      policyId,
      companyId: req.orgCompanyId,
      documentId: documentRow.id,
      file,
    });
    if (!indexResult.chunks) console.warn("Document indexing skipped:", indexResult.reason || storedPath);
  } catch (error) {
    console.error("Document indexing failed:", error);
  }

  return res.json({ filePath: storedPath });
});

app.post("/api/org/reindex-policies", requireOrgManager, async (req, res) => {
  const { data: documents, error } = await supabase
    .from("policy_documents")
    .select("id, policy_id, file_path")
    .eq("company_id", req.orgCompanyId);
  if (error) {
    console.error("Reindex document lookup failed:", error);
    return res.status(500).send("Failed to load policy documents.");
  }

  const results = [];
  for (const doc of documents || []) {
    try {
      const { data: blob, error: downloadError } = await supabase.storage
        .from("policy-files")
        .download(doc.file_path);
      if (downloadError) throw downloadError;
      const buffer = Buffer.from(await blob.arrayBuffer());
      const result = await indexPolicyDocument({
        policyId: doc.policy_id,
        companyId: req.orgCompanyId,
        documentId: doc.id,
        file: {
          buffer,
          mimetype: inferMimeFromPath(doc.file_path),
          originalname: doc.file_path.split("/").pop() || "policy-document",
        },
      });
      results.push({ document_id: doc.id, file_path: doc.file_path, ...result });
    } catch (reindexError) {
      console.error("Policy reindex failed:", reindexError);
      results.push({
        document_id: doc.id,
        file_path: doc.file_path,
        chunks: 0,
        error: reindexError.message || "Reindex failed.",
      });
    }
  }

  return res.json({
    documents: results.length,
    chunks: results.reduce((sum, item) => sum + (item.chunks || 0), 0),
    results,
  });
});

app.get("/api/org/search-status", requireOrgManager, async (req, res) => {
  const [{ count: documents }, { count: chunks }, { data: latestDocument }, { data: latestChunk }] = await Promise.all([
    supabase.from("policy_documents").select("id", { count: "exact", head: true }).eq("company_id", req.orgCompanyId),
    supabase.from("policy_chunks").select("id", { count: "exact", head: true }).eq("company_id", req.orgCompanyId),
    supabase.from("policy_documents").select("created_at").eq("company_id", req.orgCompanyId).order("created_at", { ascending: false }).limit(1),
    supabase.from("policy_chunks").select("created_at").eq("company_id", req.orgCompanyId).order("created_at", { ascending: false }).limit(1),
  ]);
  return res.json({
    documents: documents || 0,
    chunks: chunks || 0,
    searchable: Boolean((documents || 0) > 0 && (chunks || 0) > 0),
    latest_document_at: latestDocument?.[0]?.created_at || null,
    latest_chunk_at: latestChunk?.[0]?.created_at || null,
  });
});

app.get("/api/policy-documents", requireOrgAccess, async (req, res) => {
  const policyId = req.query.policyId;
  if (!policyId) {
    return res.status(400).send("Missing policy ID.");
  }

  const { data, error } = await supabase
    .from("policy_documents")
    .select("file_path")
    .eq("policy_id", policyId)
    .eq("company_id", req.orgCompanyId);

  if (error) {
    console.error("Policy documents fetch failed:", error);
    return res.status(500).send("Failed to load policy files.");
  }

  const files = data || [];
  const signedFiles = await Promise.all(
    files.map(async (file) => {
      if (!file.file_path) return { ...file, url: null };
      const { data: signed, error: signedError } = await supabase.storage
        .from("policy-files")
        .createSignedUrl(file.file_path, 60 * 10);
      if (signedError) {
        console.error("Signed URL error:", signedError);
        return { ...file, url: null };
      }
      return { ...file, url: signed?.signedUrl || null };
    })
  );

  return res.json(signedFiles);
});

app.post("/api/policy-documents/delete", requireOrgManager, async (req, res) => {
  const { policyId, filePath } = req.body || {};
  if (!policyId || !filePath) {
    return res.status(400).send("Missing policy ID or file path.");
  }

  const { data: documentRow } = await supabase
    .from("policy_documents")
    .select("id")
    .eq("policy_id", policyId)
    .eq("file_path", filePath)
    .eq("company_id", req.orgCompanyId)
    .maybeSingle();

  if (documentRow?.id) {
    const { error: chunkDeleteError } = await supabase
      .from("policy_chunks")
      .delete()
      .eq("document_id", documentRow.id);
    if (chunkDeleteError) {
      console.error("Chunk delete failed:", chunkDeleteError);
      return res.status(500).send("Failed to delete file.");
    }
  }

  const { error: storageError } = await supabase.storage.from("policy-files").remove([filePath]);
  if (storageError) {
    console.error("Storage delete failed:", storageError);
    return res.status(500).send(storageError.message || "Failed to delete file.");
  }

  const { error: deleteError } = await supabase
    .from("policy_documents")
    .delete()
    .eq("policy_id", policyId)
    .eq("file_path", filePath)
    .eq("company_id", req.orgCompanyId);

  if (deleteError) {
    console.error("Document delete failed:", deleteError);
    return res.status(500).send(deleteError.message || "Failed to delete file record.");
  }

  return res.json({ success: true });
});

app.post("/api/chat", chatLimiter, requireOrgAccess, async (req, res) => {
  const question = sanitizeText(req.body?.question || "");
  if (!question) {
    return res.status(400).send("Question is required.");
  }
  const normalizedQuestion = normalizeLookup(question);
  // Optional short conversation history from the client. Each entry is
  // { role: "user" | "assistant", text }. We use the last 4 turns only —
  // enough to resolve follow-ups like "what about new hires?" without
  // bloating the retrieval query or the final prompt.
  // Drop our own "not in policies" / rate-limit fallbacks from the client's
  // replayed history — otherwise Gemini sees a chain of them and repeats
  // the same reply for the new question even when we now have chunks.
  const isBotFallbackText = (t = "") => {
    const s = String(t || "").toLowerCase().trim();
    return (
      s.startsWith("not in the uploaded policies") ||
      s.startsWith("i could not find") ||
      s.startsWith("i don't have enough information") ||
      s.startsWith("the chat service is busy") ||
      s.startsWith("the chat service took too long")
    );
  };
  const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
  const history = rawHistory
    .slice(-4)
    .map((m) => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      text: sanitizeText(m?.text || "").slice(0, 600),
    }))
    .filter((m) => m.text)
    .filter((m) => !(m.role === "assistant" && isBotFallbackText(m.text)));
  const previousTurns = history.slice(0, -1);

  // Daily quota gate. Super-admin is exempt (one user, used for testing).
  const userId = req.session?.user?.id;
  const role = req.session?.user?.role;
  if (role !== "super_admin") {
    const already = await peekChatUsage(userId);
    if (already >= CHAT_DAILY_CAP_PER_USER) {
      return res.status(429).json({
        error: "daily_limit_reached",
        message: `You've reached today's limit of ${CHAT_DAILY_CAP_PER_USER} questions. Please come back tomorrow.`,
        remaining: 0,
      });
    }
  }

  try {
    const modules = await fetchOrgDashboard(req.orgCompanyId, { ensureTemplate: true });
    const questionIntent = classifyQuestionContext(question);
    if (questionIntent === "policy_count") {
      return res.json({
        answer: await answerPolicyCountQuestion({
          companyId: req.orgCompanyId,
          question,
          modules,
        }),
        sources: [],
        mode: "policy_count",
      });
    }

    // "Which policies are uploaded / pending" → answer from the DB directly
    // so the LLM can't drop entries or hallucinate. Runs before the generic
    // site-map fallback because that one misses "uploaded"/"pending" intent.
    const lowerQ = question.toLowerCase();
    const wantsUploadedList =
      /\b(uploaded|pending|missing|not uploaded|yet to upload)\b/.test(lowerQ) &&
      /\b(policy|policies|polices|docs?|documents?|files?|list|which|what|show|all)\b/.test(lowerQ);
    if (wantsUploadedList) {
      const { uploaded, pending } = await getUploadedPolicyLists({
        companyId: req.orgCompanyId,
        modules,
      });
      const askingPending = /\b(pending|missing|not uploaded|yet to upload)\b/.test(lowerQ);
      const target = askingPending ? pending : uploaded;
      const label = askingPending ? "pending" : "uploaded";
      let answer;
      if (!target.length) {
        answer = askingPending
          ? `No pending policies — all ${uploaded.length} listed policies have a document uploaded.`
          : `No policies have been uploaded yet.`;
      } else {
        const lines = target.map((p) => `• ${p.name} (${p.module})`).join("\n");
        answer = `${target.length} ${target.length === 1 ? "policy is" : "policies are"} ${label}:\n${lines}`;
      }
      return res.json({ answer, sources: [], mode: "policy_upload_status" });
    }

    const siteMapAnswer = (questionIntent === "navigation" || questionIntent === "policy_listing")
      ? answerSiteMapQuestion(question, modules)
      : "";
    if (siteMapAnswer) {
      return res.json({
        answer: siteMapAnswer,
        sources: [],
        mode: "site_map",
      });
    }

    const policySearchStatus = await getOrgPolicySearchStatus(req.orgCompanyId);
    if (policySearchStatus === "no_uploaded_documents") {
      return res.json({
        answer: "No uploaded policy documents are available for this org yet. Upload policy documents before using Ask Genie.",
        sources: [],
        mode: "no_uploaded_documents",
      });
    }
    if (policySearchStatus === "no_indexed_chunks") {
      return res.json({
        answer: "Uploaded policy documents are not searchable yet. Re-upload them or check indexing.",
        sources: [],
        mode: "no_indexed_chunks",
      });
    }

    // Folding recent conversation into retrieval lets follow-ups
    // ("all the members?") resolve against the prior topic. Capped so it
    // can't overwhelm the current question's embedding.
    const priorTurn = previousTurns
      .slice(-3)
      .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.text}`)
      .join("\n");
    const questionForRetrieval = priorTurn
      ? `${question}\nConversation context:\n${priorTurn.slice(0, 600)}`
      : question;
    const indexVersion = await getPolicyIndexVersion(req.orgCompanyId);
    const questionHash = hashValue(`${CHAT_CACHE_VERSION}:${normalizeLookup(questionForRetrieval)}`);
    const cached = await getCachedAnswer({
      companyId: req.orgCompanyId,
      questionHash,
      indexVersion,
    });
    if (cached) {
      return res.json({
        answer: cached.answer,
        sources: cached.sources || [],
        cached: true,
      });
    }
    if (role !== "super_admin") {
      const orgAlready = await peekOrgChatUsage(req.orgCompanyId);
      if (orgAlready >= CHAT_DAILY_CAP_PER_ORG) {
        return res.status(429).json({
          error: "org_daily_limit_reached",
          message: "This organization's Ask Genie limit has been reached for today. Please try again tomorrow.",
          remaining: 0,
        });
      }
    }

    const closestPolicyArea = findClosestPolicyArea(questionForRetrieval, modules);
    const closestPolicyAreas = findClosestPolicyAreas(questionForRetrieval, modules);
    const expectedPolicyAreas = findExpectedPolicyAreas(question, modules);
    if (expectedPolicyAreas.length) {
      const statuses = await Promise.all(
        expectedPolicyAreas.map(async (entry) => ({
          ...entry,
          status: await getPolicyDocumentStatus({ companyId: req.orgCompanyId, policyId: entry.policy.id }),
        }))
      );
      const uploadedExpected = statuses.filter((entry) => entry.status === "uploaded");
      if (!uploadedExpected.length) {
        const first = statuses[0];
        return res.json({
          answer: `"${first.policy.name}" is configured in ${first.module.name}, but its document is not uploaded yet. Ask HR to upload it before Genie can answer this.`,
          sources: [],
          mode: "policy_document_missing",
        });
      }
    }
    let focusedPolicyChunks = await fetchFocusedPolicyChunks({
      companyId: req.orgCompanyId,
      policyAreas: expectedPolicyAreas.length
        ? expectedPolicyAreas.map((entry) => ({ ...entry, score: 1 }))
        : closestPolicyAreas.length ? closestPolicyAreas : closestPolicyArea ? [closestPolicyArea] : [],
      question: questionForRetrieval,
      limit: 8,
    });
    if (!focusedPolicyChunks.length && closestPolicyArea?.rawScore > 0) {
      const closestDocumentStatus = await getPolicyDocumentStatus({
        companyId: req.orgCompanyId,
        policyId: closestPolicyArea.policy.id,
      });
      if (closestDocumentStatus === "missing") {
        return res.json({
          answer: `"${closestPolicyArea.policy.name}" is configured in ${closestPolicyArea.module.name}, but its document is not uploaded yet. Ask HR to upload it before Genie can answer this.`,
          sources: [],
          mode: "policy_document_missing",
        });
      }
    }
    const earlyEntitlementAnswer = answerSimpleEntitlementFromMatches({ question, matches: focusedPolicyChunks });
    if (earlyEntitlementAnswer) {
      return res.json({
        answer: earlyEntitlementAnswer,
        sources: focusedPolicyChunks,
        mode: "policy_entitlement_extract",
      });
    }
    const earlySanctionAnswer = answerSimpleSanctionFromMatches({ question, matches: focusedPolicyChunks });
    if (earlySanctionAnswer) {
      return res.json({
        answer: earlySanctionAnswer,
        sources: focusedPolicyChunks,
        mode: "policy_sanction_extract",
      });
    }
    const expandedQuestionParts = [
      questionForRetrieval,
      `Question intent: ${questionIntent}.`,
      `Context hint: ${contextHintForIntent(questionIntent)}`,
    ];
    if (closestPolicyArea?.score > 0) {
      expandedQuestionParts.push(`Likely policy area: ${closestPolicyArea.policy.name} in ${closestPolicyArea.module.name}.`);
    }
    const expandedQuestion = expandedQuestionParts.join("\n");

    const queryEmbedding = await embedText(expandedQuestion);
    if (!queryEmbedding.length) {
      return res.status(500).send("Embedding failed.");
    }
    // Hybrid retrieval (vector + full-text). The RPC fuses pgvector cosine
    // ranks with Postgres ts_rank via RRF — catches exact-token matches
    // (policy numbers, names, acronyms) that pure cosine misses.
    const { data: initialMatches, error: matchError } = await supabase.rpc("match_policy_chunks_hybrid", {
      query_embedding: queryEmbedding,
      query_text: questionForRetrieval,
      match_count: 12,
      filter_company: req.orgCompanyId,
    });
    if (matchError) {
      console.error("Hybrid chunk match failed:", matchError);
      return res.status(500).send("Unable to search policies.");
    }

    let matches = initialMatches || [];
    let filtered = matches.filter((row) => (row.similarity || 0) >= 0.15 || (row.hybrid_score || 0) > 0);

    // Optional adaptive query rewrite. It can rescue vague questions, but it
    // costs an extra Gemini call, so the default production path stays fast.
    const initialTopSim = filtered[0]?.similarity || 0;
    if (CHAT_ENABLE_QUERY_REWRITE && (initialTopSim < 0.22 || filtered.length < 2)) {
      const rewrittenQuery = await rewriteQueryForRetrieval(question, modules);
      if (rewrittenQuery && rewrittenQuery.toLowerCase() !== question.trim().toLowerCase()) {
        const rewriteEmbedding = await embedText(rewrittenQuery);
        if (rewriteEmbedding.length) {
          const { data: rewriteMatches, error: rewriteError } = await supabase.rpc("match_policy_chunks_hybrid", {
            query_embedding: rewriteEmbedding,
            query_text: rewrittenQuery,
            match_count: 12,
            filter_company: req.orgCompanyId,
          });
          if (rewriteError) {
            console.error("Rewrite hybrid chunk match failed:", rewriteError);
          } else {
              const rewriteFiltered = (rewriteMatches || []).filter(
                (row) => (row.similarity || 0) >= 0.15 || (row.hybrid_score || 0) > 0
              );
            if ((rewriteFiltered[0]?.similarity || 0) > initialTopSim) {
              matches = rewriteMatches || [];
              filtered = rewriteFiltered;
            }
          }
        }
      }
    }

    const policyNameById = new Map(
      modules.flatMap((module) => (module.policies || []).map((policy) => [policy.id, policy.name]))
    );
    filtered = mergeMatchesById(focusedPolicyChunks, filtered).slice(0, 12);
    matches = filtered;
    const directEntitlementAnswer = answerSimpleEntitlementFromMatches({ question, matches: filtered });
    if (directEntitlementAnswer) {
      return res.json({
        answer: directEntitlementAnswer,
        sources: filtered,
        mode: "policy_entitlement_extract",
      });
    }
    const directSanctionAnswer = answerSimpleSanctionFromMatches({ question, matches: filtered });
    if (directSanctionAnswer) {
      return res.json({
        answer: directSanctionAnswer,
        sources: filtered,
        mode: "policy_sanction_extract",
      });
    }
    const directPolicySentenceAnswer = answerFromPolicySentences({
      question,
      matches: filtered,
      minScore: ["procedure", "definition"].includes(questionIntent) ? 12 : 16,
      intent: questionIntent,
    });
    if (directPolicySentenceAnswer) {
      return res.json({
        answer: directPolicySentenceAnswer,
        sources: filtered,
        mode: "policy_sentence_extract",
      });
    }
    const context = filtered
      .slice(0, 6)
      .map((row, index) => {
        const policyName = policyNameById.get(row.policy_id) || "Unknown policy";
        return `Policy excerpt ${index + 1}\nPolicy: ${policyName}\nContent:\n${row.chunk_text.slice(0, 650)}`;
      })
      .join("\n\n");
    const matchedPolicyAreas = summarizeMatchedPolicyAreas(filtered, modules);

    if (!context) {
      return res.json({
        answer: await buildClosestPolicyFallback({
          companyId: req.orgCompanyId,
          question,
          modules,
        }),
        sources: [],
      });
    }

    const systemPrompt =
      "You are Ask Genie, an HR policy assistant for employees.\n\n" +
      "STYLE — STRICT:\n" +
      "- Maximum 2 short sentences. Bullets only if the user asks for a list.\n" +
      "- Answer the question directly. No preamble.\n" +
      "- Never mention policy excerpt numbers or source numbers.\n" +
      "- Never reveal the retrieval mechanism. Forbidden phrases (do not use any of these): \"the provided\", \"the excerpts\", \"the text\", \"the document\", \"the policy text\", \"based on\", \"I checked\", \"focuses on\", \"does not describe\", \"does not contain\", \"does not mention\", \"the information provided\".\n" +
      "- If the answer isn't in the uploaded policies, reply exactly: \"Not in the uploaded policies. Check with HR.\"\n\n" +
      "GROUNDING:\n" +
      "- Use only the provided policy content.\n" +
      "- Use recent conversation only to resolve what the user is referring to; do not use it as policy evidence.\n" +
      "- Do not invent limits, dates, amounts, approvals.\n" +
      "- For count, entitlement, eligibility, deadline, and amount questions, answer only when the exact rule is explicitly present in the policy content; otherwise use the exact not-in-policy reply.\n" +
      "- Do not infer one leave type or benefit from another leave type or benefit.\n" +
      "- If a rule depends on role/location/tenure that the user didn't give, state the rule and the condition in one sentence.";
    const closestPolicyPath = closestPolicyArea?.score > 0
      ? `${closestPolicyArea.module.name} > ${closestPolicyArea.policy.name}`
      : "No close policy area detected.";
    const conversationBlock = history.length
      ? history.map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.text}`).join("\n")
      : "";
    const prompt = `System:\n${systemPrompt}\n\nQuestion intent:\n${questionIntent}\nClosest policy area:\n${closestPolicyPath}\nMatched policy areas:\n${matchedPolicyAreas || "No matched policy areas."}\n\nPolicy content:\n${context || "None"}\n\nRecent conversation:\n${conversationBlock || "(none)"}\n\nQuestion:\n${question}\n\nAnswer:`;
    let answer = "";
    let geminiSucceeded = false;
    let fallbackPolicySentenceAnswer = "";
    try {
      answer = await chatWithGemini(prompt);
      if (isIncompleteAiAnswer(answer)) {
        answer = "Not in the uploaded policies. Check with HR.";
      }
      geminiSucceeded = true;
    } catch (error) {
      console.error("Gemini chat generation failed:", error);
      fallbackPolicySentenceAnswer = answerFromPolicySentences({
        question,
        matches: filtered,
        minScore: 10,
        intent: questionIntent,
      });
      if (fallbackPolicySentenceAnswer) {
        return res.json({
          answer: fallbackPolicySentenceAnswer,
          sources: filtered,
          mode: "policy_sentence_extract",
          ai_error: error?.status === 504 ? "ai_timeout" : "ai_unavailable",
        });
      }
      // Surface a clear "we're rate-limited" message rather than the generic
      // "not in policies" — they're different problems for the user.
      if (error?.status === 429) {
        return res.status(503).json({
          answer: "The chat service is busy right now. Please try again in a minute.",
          sources: [],
          error: "rate_limited",
        });
      }
      if (error?.status === 504) {
        return res.status(503).json({
          answer: "The chat service took too long to respond. Please try again.",
          sources: [],
          error: "ai_timeout",
        });
      }
      answer = "Not in the uploaded policies. Check with HR.";
    }
    if (isBotFallbackText(answer) || answerLooksMissing(answer)) {
      fallbackPolicySentenceAnswer = answerFromPolicySentences({
        question,
        matches: filtered,
        minScore: 10,
        intent: questionIntent,
      });
      if (fallbackPolicySentenceAnswer) {
        return res.json({
          answer: fallbackPolicySentenceAnswer,
          sources: filtered,
          mode: "policy_sentence_extract",
        });
      }
    }
    answer = appendClosestPolicyContext({ answer, closestPolicyAreas });

    // Increment the per-user daily counter ONLY when Gemini actually billed us.
    // Site-map / policy-count answers and Gemini-error fallbacks don't count.
    let remaining = null;
    let orgRemaining = null;
    if (geminiSucceeded && role !== "super_admin") {
      const [usage, orgUsage] = await Promise.all([
        recordChatUsage(userId),
        recordOrgChatUsage(req.orgCompanyId),
      ]);
      remaining = usage.remaining;
      orgRemaining = orgUsage.remaining;
    }
    if (geminiSucceeded && answer && !isBotFallbackText(answer)) {
      await setCachedAnswer({
        companyId: req.orgCompanyId,
        questionHash,
        indexVersion,
        answer,
        sources: matches || [],
      });
    }

    return res.json({
      answer: answer || "I could not find this in the uploaded policies. Please check with HR for confirmation.",
      sources: matches || [],
      ...(remaining !== null ? { remaining } : {}),
      ...(orgRemaining !== null ? { org_remaining: orgRemaining } : {}),
    });
  } catch (error) {
    console.error("Chat failed:", error);
    if (error?.status === 429) {
      return res.status(503).json({
        answer: "The chat service is busy right now. Please try again in a minute.",
        sources: [],
        error: "rate_limited",
      });
    }
    if (error?.status === 504) {
      return res.status(503).json({
        answer: "The chat service took too long to respond. Please try again.",
        sources: [],
        error: "ai_timeout",
      });
    }
    return res.status(500).json({
      answer: "I could not search the policies right now. Please try again.",
      sources: [],
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

# HRMS integration — policies.zarohr

Two ways an HRMS can hand a user into policies.zarohr without making them
log in again:

1. **Server-side redirect** — the HRMS computes a signed URL and sends the
   browser to it. policies.zarohr verifies the signature, establishes a
   session, and lands the user on the policy dashboard.
2. **Iframe embed** — same signed URL, loaded inside an `<iframe>` on an
   HRMS page so policies.zarohr appears inline.

Both paths use the same launch endpoint and signing scheme.

---

## 1. Switch the org to HRMS mode

In the policies.zarohr admin panel for the org, **Settings → Access mode**,
pick **HRMS link**. The People / Email tabs are hidden in this mode; the
HRMS becomes the source of truth for who can sign in.

## 2. Configure the shared secret

On the policies.zarohr server, set:

```
HRMS_LAUNCH_SECRET=<long random string shared with the HRMS>
```

Give the same value to the HRMS team. They sign launch URLs with it; the
server verifies them with it.

## 3. (Embed only) Allow the HRMS origin to iframe the app

```
HRMS_EMBED_ORIGINS=https://hrms.acme.com,https://workday.acme.com
```

Comma-separated. When set, two things change:

- The session cookie is issued as `SameSite=None; Secure` so it survives a
  cross-origin iframe context.
- `Content-Security-Policy: frame-ancestors 'self' <those origins>` is set,
  so the HRMS pages can iframe ours.

Both depend on HTTPS (the `Secure` cookie flag is enforced in production).

---

## 4. Build the launch URL

```
GET https://policies.zarohr.com/api/hrms/launch
  ?org=<slug>
  &email=<user@company.com>
  &name=<optional display name>
  &role=employee|admin
  &external_id=<optional HRMS user id>
  &exp=<unix-seconds, max 15 min in the future>
  &jti=<fresh random single-use token>
  &sig=<hex HMAC-SHA256>
```

### Canonical signing string

Join these **seven lines with `\n`**, in this **exact order**, every time —
none of them is ever omitted, even when the value is empty:

```
org=<slug>
email=<email>
exp=<exp>
name=<name>            // present but empty if not supplied
role=<role>
external_id=<id>       // present but empty if not supplied
jti=<jti>
```

Each value is individually run through `encodeURIComponent` before being
placed into its `key=value` line. This is not the six-field, differently-
ordered scheme this document previously showed — that scheme signed
`org, email, name, role, external_id, exp` and omitted absent fields
entirely, and never included `jti` at all. A signature built that way never
matches what the server verifies (`buildHrmsCanonicalPayload` in
`server/index.js`), so every launch built against the old example would fail
with a `401` signature mismatch.

`jti` is a single-use nonce: generate a fresh, unpredictable token (a UUID or
a random base64url string of at least 16 bytes) for every launch. The server
records it the first time it's spent; reusing the same launch URL — by the
same person or anyone who received a forwarded copy — fails with `401` even
though the signature is still valid.

`sig = HMAC_SHA256(HRMS_LAUNCH_SECRET, canonical).hex`

### Example (Node)

```js
import crypto from "crypto";

function buildCanonical({ org, email, exp, name = "", role = "employee", externalId = "", jti }) {
  const safeRole = role === "admin" ? "admin" : "employee";
  return [
    `org=${encodeURIComponent(org)}`,
    `email=${encodeURIComponent(email.trim().toLowerCase())}`,
    `exp=${encodeURIComponent(String(exp))}`,
    `name=${encodeURIComponent(name.trim())}`,
    `role=${encodeURIComponent(safeRole)}`,
    `external_id=${encodeURIComponent(externalId.trim())}`,
    `jti=${encodeURIComponent(jti)}`,
  ].join("\n");
}

const params = {
  org: "acme",
  email: "rita@acme.com",
  name: "Rita Choksi",
  role: "employee",
  externalId: "EMP-441",
  exp: Math.floor(Date.now() / 1000) + 5 * 60, // 5 minutes from now (max 15)
  jti: crypto.randomBytes(16).toString("base64url"), // fresh every launch
};

const canonical = buildCanonical(params);

const sig = crypto
  .createHmac("sha256", process.env.HRMS_LAUNCH_SECRET)
  .update(canonical)
  .digest("hex");

const url = new URL("https://policies.zarohr.com/api/hrms/launch");
url.searchParams.set("org", params.org);
url.searchParams.set("email", params.email);
url.searchParams.set("name", params.name);
url.searchParams.set("role", params.role);
url.searchParams.set("external_id", params.externalId);
url.searchParams.set("exp", String(params.exp));
url.searchParams.set("jti", params.jti);
url.searchParams.set("sig", sig);
```

## 5. Hand the URL to the browser

Either:

```
<a href="<that URL>" target="_blank">Open policy portal</a>
```

…or for embed:

```
<iframe src="<that URL>" style="width:100%; height:800px; border:0"></iframe>
```

---

## What the server validates

- `exp` is in the future and at most 15 minutes from now (replay protection).
- `sig` matches the HMAC over the canonical payload.
- The org slug exists and is in `access_mode = hrms_link`.

On success the server issues a session cookie scoped to
`.<ROOT_HOST>` and 303-redirects to `/policies.html`. The session carries
`authSource: "hrms"`, which lets you tell HRMS-originated sessions from
direct-login ones in audit logs.

## Failure modes

| Status | Meaning |
|--------|---------|
| 400 | Missing required params (including `jti`), malformed exp, or exp too far in the future |
| 401 | Signature mismatch, expired exp, or this `jti` was already used (single-use nonce) |
| 403 | Org is not in `hrms_link` mode, or its HRMS settings aren't enabled |
| 404 | Unknown org slug |
| 500 | `HRMS_LAUNCH_SECRET`/org launch secret is empty on the server, or the nonce couldn't be recorded |

---

## Quick checklist for go-live

- [ ] Org switched to **HRMS link** mode in the admin panel.
- [ ] `HRMS_LAUNCH_SECRET` set on the server, shared with the HRMS team.
- [ ] (Embed only) `HRMS_EMBED_ORIGINS` set, app served over HTTPS.
- [ ] HRMS produces URLs with `exp` ≤ 15 min in the future.
- [ ] First end-to-end test: HRMS launch → dashboard loads → chat answers a question.

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
  &sig=<hex HMAC-SHA256>
```

### Canonical signing string

Concatenate the fields with `\n` (newline) in this order, omitting any field
that wasn't provided:

```
org=<slug>
email=<email>
name=<name>          // omit line if empty
role=<role>
external_id=<id>     // omit line if empty
exp=<exp>
```

`sig = HMAC_SHA256(HRMS_LAUNCH_SECRET, canonical).hex`

### Example (Node)

```js
import crypto from "crypto";

const params = {
  org: "acme",
  email: "rita@acme.com",
  name: "Rita Choksi",
  role: "employee",
  external_id: "EMP-441",
  exp: Math.floor(Date.now() / 1000) + 5 * 60, // 5 minutes from now
};

const canonical = Object.entries(params)
  .filter(([_, v]) => v !== "" && v != null)
  .map(([k, v]) => `${k}=${v}`)
  .join("\n");

const sig = crypto
  .createHmac("sha256", process.env.HRMS_LAUNCH_SECRET)
  .update(canonical)
  .digest("hex");

const url = new URL("https://policies.zarohr.com/api/hrms/launch");
Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
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
| 400 | Missing required params, malformed exp, or exp too far in the future |
| 401 | Signature mismatch or expired exp |
| 403 | Org is not in `hrms_link` mode |
| 404 | Unknown org slug |
| 500 | `HRMS_LAUNCH_SECRET` is empty on the server |

---

## Quick checklist for go-live

- [ ] Org switched to **HRMS link** mode in the admin panel.
- [ ] `HRMS_LAUNCH_SECRET` set on the server, shared with the HRMS team.
- [ ] (Embed only) `HRMS_EMBED_ORIGINS` set, app served over HTTPS.
- [ ] HRMS produces URLs with `exp` ≤ 15 min in the future.
- [ ] First end-to-end test: HRMS launch → dashboard loads → chat answers a question.

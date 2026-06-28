# Approved To Implement

Curated queue of backlog items approved for implementation.

Workflow:

1. Candidate starts in [nice-to-have.md](nice-to-have.md).
2. Review manually with the user and ask for clarification when tradeoffs are
   unclear.
3. If the user is satisfied with the approach, move or copy the item here with
   enough implementation intent to start safely.
4. If not satisfied, leave it in `nice-to-have.md` for later review or move the
   rationale to [deferred-notes.md](deferred-notes.md).

Items here are approved in principle, not necessarily scheduled for the next
session. Before coding, still inspect the implementation and update the plan if the
code contradicts the assumptions below.

## Approved

### Enforce rate limiting on the live public deploy (approved 2026-06-18)

Status: **implemented 2026-06-18** (see `sessions/18-06-2026.md`). Moved from
`nice-to-have.md` P0. The site is public (`lazyscan.my.id`) with a paid SMTP relay
behind the auth flow; the limiter exists in code but was inert in production.

> Correction discovered during implementation: the limiter was not just "off and
> mis-keyed" — it was **inert**. Elysia defaults `.onBeforeHandle` to `local`
> scope (stripped when `.use()`d into a parent → fires for no routes) and dedupes
> plugins by `name+seed` (both limiters shared `name:"rateLimit"` with no seed →
> the auth one was dropped). Fixed via `{ as: "global"/"scoped" }` + distinct
> seeds, alongside the env/nginx wiring below.

Reason:

- The middleware is correct in isolation (`api/src/middleware/rate.limit.ts`:
  `globalRateLimit` 100/15 min all routes; `authRateLimit` 5/15 min on `/auth`)
  but is off and mis-keyed for this deploy — open to email-bomb and credential
  brute-force.

Root causes (all verified):

1. `ENABLE_RATE_LIMIT` defaults `false` (`api/src/env.ts:47`); not forwarded by the
   compose api block; absent from `.env.example`.
2. `TRUST_PROXY` defaults `false` (`api/src/env.ts:55`); same — so the limiter keys
   on the nginx socket peer and every visitor shares one bucket.
3. The middleware reads only `x-real-ip` (`rate.limit.ts:63`), but `web/nginx.conf`
   sets `X-Forwarded-For`/`X-Forwarded-Proto`, not `X-Real-IP` (the `env.ts:53`
   comment claiming otherwise is drift).
4. Behind cloudflared, the real client IP is in `CF-Connecting-IP`, which nothing
   reads — per-client keying is dead even after 1–3.

Implementation intent:

- `.env.example` + compose api `environment:` — add and forward
  `ENABLE_RATE_LIMIT=true` and `TRUST_PROXY=true`.
- `web/nginx.conf` — derive the real client from Cloudflare and pass it down:

  ```nginx
  real_ip_header CF-Connecting-IP;
  set_real_ip_from 0.0.0.0/0;     # cloudflared is the only upstream; CF is trusted
  proxy_set_header X-Real-IP $remote_addr;
  ```

- Auth bucket split — `5/15 min` across the whole `/auth` group is too tight for a
  legit register → verify (a couple of OTP typos plus one resend hits 5). Keep a
  looser limit on `verify-email`/`login`; strict on `register`/`resend` (the
  SMTP-cost paths).

Open checks before coding:

- **`set_real_ip_from 0.0.0.0/0` is only safe if the api/web port is reachable
  exclusively through the tunnel.** If `127.0.0.1:8081` (or 8080) is ever exposed
  directly, a client could spoof `CF-Connecting-IP`. Confirm the firewall / bind
  before trusting any source.
- Confirm the exact auth-bucket numbers per route (verify/login vs register/resend)
  with the user.
- Fix the `env.ts:53` comment in the same change (it currently claims nginx sets
  `X-Real-IP`).

### Profile bio (short description) with 256-char cap + profanity guard (approved 2026-06-26)

Status: **approved, not implemented.** New optional `bio` on the 1:1 `profiles` row.

Reason:

- No free-text self-description exists today (`profiles` has only `username`,
  `display_name`, visibility flags). Add a short bio, length-capped, with a
  profanity deterrent resistant to leet/symbol/number/spacing evasion.

Decided approach (no new dependency — matches the "regex" intent + lean api deps):

- **Length:** 256 chars. zod `.max(256)`, clearable (`"" | null` → null) exactly
  like `displayName`.
- **Profanity:** reject (400 `PROFILE_BIO_PROFANITY`) — do **not** auto-censor /
  mutate user text. Store the raw bio; filter only at the validation layer.
- **Matcher** (new `shared/utility/profanity.ts`, with one `assert` self-check):
  normalize for matching only — lowercase → leet map (`@4→a $5→s 1!→i 0→o 3→e
  7+→t …`) → collapse repeats (`fuuuck→fuck`) → match a small **root list with
  word boundaries**. Catches `f0ck`, `$hit`, `sh!t`, leet/symbol/number swaps.

Accepted ceiling (do not chase further):

- Fully spaced-out `f u c k` slips through **by design**. Closing it requires
  stripping all separators, which reintroduces the Scunthorpe problem (false
  positives on `classic`, `assassin`, `Scunthorpe`, `circumstance`). Regex cannot
  give both "catches spaced-out" and "no false positives" — deterrent + report/
  moderation is the backstop. Upgrade path if recall matters: swap the matcher
  internals for the `obscenity` dep behind the same `profanity.ts` seam (purpose-
  built leet+spacing matcher with a whitelist to cut false positives).

Implementation intent (smallest safe, mirrors `displayName`):

- migration `028_profile_bio.sql` — additive `ALTER TABLE profiles ADD COLUMN IF
  NOT EXISTS bio TEXT`.
- `profile.model.ts` — `bio` on `Profile`, `UpdateProfileInput`,
  `ProfileResponse`, `PublicProfileResponse` (public profile shows it).
- `profile.validation.ts` — `bio: clearable(z.string().min(1).max(256))` +
  profanity business-validator.
- `profile.repository.ts` — select/insert/update `bio`.
- `profile.service.ts` — passthrough.
- web profile edit form + display — separate change, out of api scope.

Open checks before coding:

- Confirm `bio` shows on the **public** profile lookup (assumed yes) vs owner-only.
- Confirm the profanity behavior is **reject** vs silent-censor with the user
  (recorded as reject above).

# Architecture

Fitness Intelligence v2 is a modular monolith. Next.js serves the dashboard and the HTTP API. PostgreSQL, through Prisma migrations, is the system of record. Domain math does not import Prisma or React.

## Boundaries

- UI: `src/app`, `src/components`
- API and auth: `src/server`, `src/app/api`
- Persistence: `prisma/schema.prisma` and `prisma/migrations`
- Import: `src/domain/import` parses; `src/server/services/imports.ts` writes
- Analytics: `src/domain/body-composition`, `src/domain/strength`, `src/domain/forecast`
- External adapters: `src/integrations/mcp` and `openapi/`

ChatGPT, a GPT Action, or the MCP-style endpoint are clients. They are not required for the app to function, and no OpenAI secret is shipped to the browser.

## History

Measurements, sets, nutrition rows, activity days, and sleep sessions are corrected by inserting a new row and setting `supersededAt` on the previous one. Deletes set `deletedAt`. Active rows are those with both timestamps null. Partial unique indexes stop two active rows from sharing a source id.

`valueOrigin` distinguishes measured, user-entered, imported, estimated, hydration-normalized, forecast, and fixture data. The development seed is `fixture` and can be removed without touching other origins.

## Body composition, version `body-comp-v1`

Raw values are always returned. A two-compartment estimate uses `fat-free mass = body water / 0.73` (configurable 0.70–0.76), following the usual hydration-of-fat-free-mass assumption. It is not labeled muscle.

Hydration-context normalization needs at least 8 paired weight and body-water days, a stable robust coefficient of variation, and enough non-unusual water readings. Unusual days are flagged with a modified z-score, or with a 1.5 lb / 2% rule when the median absolute deviation is zero. The adjusted fat mass is the EWMA of raw fat mass on normal days. It is not recomputed from the same bioimpedance percentages, because those percentages and the water reading often come from one impedance measurement. If the data is too thin or too noisy, the status is `insufficient_data` and the normalized fields are null.

The glycogen refill helper is a separate heuristic (2.7–4.0 g water per g glycogen). It does not change stored composition.

## Strength, version `strength-v1`

Conventional volume is work sets times reps times external load. Eccentric load-rep products stay separate. Epley estimated one-rep max applies only to reps 1–12 on conventional, bodyweight, weighted-bodyweight, and assisted sets. A one-rep set equals the effective load. Eccentric-only and isometric work do not get an estimated max. Bodyweight effective load is full body weight. Assisted load is body weight minus assistance. Muscle exposure uses an explicit credit map and is marked as a heuristic.

## Forecasts, version `forecast-v1`

The linear model is the baseline. A confidence band is returned only when there are at least 8 points. The capped scenario steps weekly from the 3500 kcal per pound proxy, caps fat loss at the smaller of 1.5 lb or 1% of body weight, caps lean gain by scenario, and holds body fat at a 5% floor. Backtests compare that idea with a no-change naive forecast. None of these dates are guaranteed biological outcomes.

## Authentication

Passwords are scrypt hashes. Sessions are HMAC-signed cookies (`AUTH_SECRET`). API tokens are stored as SHA-256 hashes and carry `read`, `write`, and/or `import`. Writes require `Idempotency-Key`. The same key and body replay the stored response. The same key and a different body return 409. A per-token in-memory rate limit protects a single server process; it resets when the process restarts.

## Samsung import

Parsers accept only the CSV layouts already implemented in the legacy body-composition app: weight, steps, nutrition, sleep, exercise, calories burned, activity day summary, user profile, and exercise live-data JSON. Other filenames are listed as unsupported. ZIP paths containing `..` or an absolute prefix are rejected. Cells such as `=1+1` are not evaluated. Repeat imports match source ids and content hashes. A user correction is not overwritten.

Apple Health, generic CSV logs, and Vitruvian exports have an adapter slot and are not parsed.

## Legacy apps

`legacy/body-comp` is the previous body-composition tracker. Its manifest and service worker were renamed to the filenames that HTML already referenced. `legacy/recomp-strength` is the previous strength logger. Their logic was not rewritten.

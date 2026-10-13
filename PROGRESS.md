# Progress

## What works

Verified on 2026-10-13 against local Postgres. No database rows were inserted by hand.

- Overview shows the persisted fixture weight, `151.0 lb`.
- An external bearer token created from the signed-in owner submitted a pull-up workout of 3 sets (3, 2, and 1 reps at 151 lb) on 2026-10-13. The API stored one session. Exercise history includes those three sets, latest total reps are 6, and the recomputed rep record is 3 with a non-null Epley e1RM. The workouts page shows `2026-10-13`, `6 reps, best 3`, and `reps 3`.
- Repeating that POST with the same `Idempotency-Key` and the same body returns `Idempotent-Replayed: true` and does not create a second workout. A new key is a new workout. Same key with a different body returns 409.
- Another user's token gets 404 from `GET`, `PATCH`, and set append on the owner's workout. The owner's name and set count stay unchanged.
- Importing `fixtures/samsung/weight_hydration.csv` (eight stable weight and body-water days) makes `normalization.status` `ok`. The body page shows raw and normalized series labels, a numeric normalized estimate, and the fat-free-mass limitation. Fat-free mass is not labeled as muscle.
- `openapi/openapi.yaml` parses as OpenAPI 3.1, matches the public route list, and the documented pull-up example passes `workoutCreateSchema`.

Personal records are recomputed from stored sets on read. The `PersonalRecord` table is not a cache that the API updates.

## What does not

- A live ChatGPT custom GPT was not tested. There is no OpenAI or ChatGPT account in this environment, and the app stores no OpenAI key. `docs/CHATGPT.md` separates that from the bearer-token path that was executed.
- `POST /api/mcp` was not part of the browser acceptance run.
- The latest seeded weigh-in still has no body water, so the overview normalized value for that reading stays blank even after the May sample makes a baseline possible. The body page shows the estimate on the paired readings.
- Rate limiting is in memory for one server process.
- Apple Health and Vitruvian files are rejected. No real phone export has been imported. Put one under gitignored `data/` before trusting a current Samsung backup.

The acceptance workout and the hydration import are now in the local owner database. `npm run db:clear-fixtures` does not remove them, because they are not fixture-origin rows.

## Checks

- `npx tsc --noEmit`: passed.
- `npx next lint`: passed, no warnings.
- `npm test`: 91 passed.
- `npm run test:integration`: 6 passed.
- `npx playwright test`: 3 passed (`e2e/acceptance.spec.ts` twice, `e2e/dashboard.spec.ts` once).
- `npm run build`: passed.

## How to resume

1. `npm run db:up`
2. `npm run db:migrate`
3. `npm run db:seed` if the owner user is missing
4. `npm run dev`, then sign in with `AUTH_EMAIL` and `AUTH_PASSWORD` from `.env`
5. `npm test`, `npm run test:integration`, and `npx playwright test` before changing the API

Next useful check: import a real Samsung export from `data/` and compare its columns with `src/domain/import/samsung/parse.ts`. Do not point a GPT Action at this API until the app is on public HTTPS and a bearer token exists for that GPT.

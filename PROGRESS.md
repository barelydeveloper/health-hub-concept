# Progress

## Completed

- Next.js, Prisma, Postgres, and Vitest scaffold. Legacy static apps moved to `legacy/` without logic edits.
- Migration `20261013180000_init` plus partial unique indexes, and `20261013190000_exercise_cascade`.
- Fixture seed for the stated height, tape, weigh-ins, dead hang, pull-ups, shoulder press, eccentric calf raises, and goals. Origin is `fixture`.
- Body-composition engine `body-comp-v1`, strength engine `strength-v1`, forecast engine `forecast-v1`.
- Samsung CSV and ZIP parser with dedup, unsafe-path rejection, and formula-cell handling.
- Authenticated `/api/v1` with scopes, idempotency, audit, rate limit, and soft corrections.
- Dashboard pages for overview, body, workouts, nutrition, recovery, goals, imports, and settings.
- OpenAPI 3.1, GPT Action notes, and a thin JSON-RPC tool endpoint at `POST /api/mcp`.

## Tests

- `npm test`: 88 passed.
- `npm run test:integration`: 6 passed (auth, cross-user 404, idempotent replay, conflicting replay, concurrent same key, measurement correction, set removal, repeated Samsung import, rate limit).
- `npx tsc --noEmit`: passed.
- `npx next lint`: passed.
- `npm run build`: passed.
- `npx playwright test`: 1 passed. Signed in, saw the 151.0 lb fixture weight, opened the pull-up workout, and saw the body-composition insufficient-data explanation.

## Known limits

- Hydration-normalized body fat stays `insufficient_data` on the fixture set because those rows have no body-water series. That is intentional.
- Shoulder press and eccentric calf-raise dates were not specified, so they share the 2026-10-09 fixture session. The session note says so.
- Rate limiting is in-memory and applies to one server process.
- Apple Health and Vitruvian imports are named unsupported adapters only.
- The MCP endpoint implements `initialize`, `tools/list`, and `tools/call` only.

## Next task

Add a real Samsung export under gitignored `data/` and run it through `POST /api/v1/imports` to confirm the column map against a current phone backup. After that, the highest-value gap is a richer workout logger (multiple sets in one form) and optional light-mode styling.

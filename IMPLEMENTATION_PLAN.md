# Implementation plan

The product is a Next.js monolith beside the two legacy static apps.

1. Scaffold, Postgres, and docs. Done.
2. Migration-managed schema, partial unique source indexes, fixture seed. Done.
3. Body-composition, strength, and forecast engines with synthetic tests. Done.
4. Samsung CSV/ZIP parser, dedup plan, unsafe-path rejection. Done.
5. Authenticated API, idempotency, audit, integration tests. Done.
6. Dashboard bound to the API. Done.
7. OpenAPI 3.1, GPT Action notes, thin MCP adapter. Done.
8. Typecheck, unit tests, integration tests, lint, production build, and a browser pass. Recorded in `PROGRESS.md`.

Assumptions that were not worth blocking on:

- Local Postgres is Docker Compose on port 54329, database `fitness_intelligence`.
- One seeded user is enough. Tokens and `userId` foreign keys are already user-scoped.
- Canonical units are pounds, inches, kilocalories, grams, and seconds.
- Shoulder press and eccentric calf-raise dates were not specified, so those fixture sets share the 2026-10-09 pull-up session and the session note says so.
- Rate limiting is in-memory for one process.
- Apple Health and Vitruvian stay unimplemented adapter names.

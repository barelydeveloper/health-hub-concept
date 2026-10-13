# Fitness Intelligence

Personal body-composition, training, nutrition, and recovery records. The browser apps that used to live at the repo root are preserved under `legacy/` and are not the system of record.

## Run locally

```bash
docker compose up -d
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Open http://127.0.0.1:3000 and sign in with `AUTH_EMAIL` / `AUTH_PASSWORD` from `.env`. The checked-in example uses `owner@localhost` and `change-me-now`. Change both before any shared deployment.

`npm run db:clear-fixtures` deletes rows whose source is `fixture` and leaves imported or hand-entered rows in place.

## Checks

```bash
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run build
```

## Layout

- `src/domain` — tested calculations and the Samsung parser. No database imports.
- `src/server` — Prisma, auth, and API handlers.
- `src/app` — mobile-first dashboard.
- `openapi/openapi.yaml` — OpenAPI 3.1 contract.
- `legacy/body-comp` and `legacy/recomp-strength` — the previous static apps.

See `ARCHITECTURE.md`, `API.md`, and `docs/CHATGPT.md`.

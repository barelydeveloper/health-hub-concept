# ChatGPT connection

This app does not call ChatGPT. ChatGPT, or any other HTTPS client, calls this API. No OpenAI key is stored here.

## What was verified locally

These checks ran against the local app and Postgres. They did not use an OpenAI or ChatGPT account.

- A browser session can create a bearer token with `read`, `write`, and `import`.
- An external client that sends only `Authorization: Bearer fihub_...` can create a workout.
- Repeating that write with the same `Idempotency-Key` and the same body returns the original workout and does not insert a second row. A different body with the same key returns 409.
- `GET /api/v1/exercises/pull-up/history` includes the new sets, and the personal-record fields are recomputed from stored sets.
- The signed-in workouts page shows that session.
- Another user's token receives 404 when it tries to read, rename, or add sets to a workout it does not own.
- `openapi/openapi.yaml` is OpenAPI 3.1, lists the public routes, and its pull-up example matches the API schema.

## What was not tested

A live custom GPT was not created or called. This environment has no ChatGPT or OpenAI account, and the server has no OpenAI credential to configure.

## Supported clients

1. **Any HTTPS bearer client.** This is the path the local acceptance test used. Create a token in Settings, send it as `Authorization: Bearer`, and send a new `Idempotency-Key` on every write. Reuse that key only to retry the same write.
2. **GPT Action.** Import `openapi/openapi.yaml` (the companion file is `openapi/gpt-action.json`). This path is documented below and has not been executed against ChatGPT.
3. **`POST /api/mcp`.** A small JSON-RPC subset: `initialize`, `tools/list`, and `tools/call`. It uses the same bearer token and the same services. It is not part of the OpenAPI file.

## Account setup required before a live GPT Action

A custom GPT with Actions requires ChatGPT Plus, Team, or Enterprise. A free ChatGPT account cannot attach this Action.

1. Deploy this app on public HTTPS. `docker compose up -d` and `npx prisma migrate deploy` prepare Postgres. Set `DATABASE_URL`, `AUTH_EMAIL`, `AUTH_PASSWORD`, and a long random `AUTH_SECRET`.
2. Sign in and create a token with the scopes that GPT should have. A read-only token cannot write.
3. In the GPT editor, add an Action and import `openapi/openapi.yaml`. Replace the server URL with the deployed origin. Do not leave `https://example.com`.
4. Set authentication to Bearer and paste the `fihub_...` token into the Action secret. ChatGPT sends it as `Authorization: Bearer` only after that Action is saved on the GPT. Ordinary chats do not gain access on their own.
5. Tell the GPT to send a new `Idempotency-Key` on every write and to reuse it only when retrying that same write.

Useful prompts once the Action is connected:

- Show my dashboard summary.
- Log today's pull-ups as 3, 2, and 1 reps at 151 lb body weight.
- Record this morning's weight.
- Compare my latest pull-up session with the previous one.
- What is the raw body-fat trend, and is a hydration-normalized estimate available?

If the normalized body-fat field is null, say so. That means the stored body-water history is not stable enough for the estimate, or that particular reading has no body-water value. Do not invent a corrected percentage.

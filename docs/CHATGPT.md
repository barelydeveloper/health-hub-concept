# ChatGPT connection

The app does not call ChatGPT. A GPT Action, or any other HTTPS client, calls this API.

1. Deploy the app on HTTPS. `docker compose up -d` and `npx prisma migrate deploy` prepare Postgres. Set `DATABASE_URL`, `AUTH_EMAIL`, `AUTH_PASSWORD`, and a long random `AUTH_SECRET`. Do not put an OpenAI key in the frontend; this server does not need one.
2. Sign in and create a token with the scopes you want. A read-only token cannot write.
3. In the GPT Action editor, import `openapi/openapi.yaml`. Replace the server URL with your origin. The companion file is `openapi/gpt-action.json`.
4. Choose API key or bearer authentication and paste the `fihub_...` token into the Action secret. ChatGPT will send it as `Authorization: Bearer ...` only after you enable the Action for that GPT. Ordinary chats do not gain access on their own.
5. Tell the GPT to send a new `Idempotency-Key` on every write and to reuse it only when retrying that same write.

Useful prompts once the Action is connected:

- Show my dashboard summary.
- Log today's pull-ups as 2, 2, and 1 reps at 151 lb body weight.
- Record this morning's weight.
- Compare my latest pull-up session with the previous one.
- What is the raw body-fat trend, and is a hydration-normalized estimate available?

`POST /api/mcp` is available for a custom client that speaks the small JSON-RPC tool subset documented in `API.md`.

If the normalized body-fat field is null, say so. That means the stored body-water history is not stable enough for the estimate. Do not invent a corrected percentage.

# API

Base path `/api/v1`. Errors use `{ "error": { "code", "message", "details" } }`.

## Authentication

- `POST /api/auth/login` with `{ email, password }` sets the `fi_session` cookie.
- `POST /api/auth/logout` clears it.
- External clients send `Authorization: Bearer fihub_...`.
- Create a token from Settings or `POST /api/v1/tokens` with scopes `read`, `write`, and/or `import`. The raw token is returned once.
- `DELETE /api/v1/tokens/{id}` revokes it.
- Missing auth is 401. A token without the required scope is 403. Another user's record is 404.

Every POST, PATCH, and DELETE needs `Idempotency-Key`. A replay of the same body returns the original response and `Idempotent-Replayed: true`. A different body with that key returns 409.

List endpoints accept `from`, `to`, `cursor`, and `limit` (max 100).

## Endpoints

| Method | Path | Scope |
| --- | --- | --- |
| GET | `/api/health` | public |
| GET | `/api/ready` | public |
| GET, PATCH | `/api/v1/profile` | read, write |
| GET | `/api/v1/dashboard` | read |
| GET, POST | `/api/v1/workouts` | read, write |
| GET, PATCH | `/api/v1/workouts/{id}` | read, write |
| POST | `/api/v1/workouts/{id}/sets` | write |
| PATCH, DELETE | `/api/v1/workouts/{id}/sets/{setId}` | write |
| GET | `/api/v1/exercises/{slug}/history` | read |
| GET | `/api/v1/personal-records` | read |
| GET, POST | `/api/v1/measurements` | read, write |
| PATCH, DELETE | `/api/v1/measurements/{id}` | write |
| GET | `/api/v1/body-composition/trends` | read |
| GET, POST | `/api/v1/nutrition` | read, write |
| GET, POST | `/api/v1/goals` | read, write |
| GET, POST | `/api/v1/forecasts` | read, write |
| GET, POST | `/api/v1/imports` | read, import |
| GET | `/api/v1/recovery` | read |
| GET, POST | `/api/v1/tokens` | read, write |
| DELETE | `/api/v1/tokens/{id}` | write |
| GET | `/api/v1/audit` | read |

`POST /api/v1/imports` accepts either `application/json` (`{ files: [{ name, text }] }`) or `application/zip`.

The contract is `openapi/openapi.yaml`. Example pull-up body:

```json
{
  "startedAt": "2026-10-09T15:00:00.000Z",
  "exercises": [
    {
      "exerciseSlug": "pull-up",
      "sets": [
        { "modality": "bodyweight", "reps": 2, "bodyWeightLb": 151 },
        { "modality": "bodyweight", "reps": 2, "bodyWeightLb": 151 },
        { "modality": "bodyweight", "reps": 1, "bodyWeightLb": 151 }
      ]
    }
  ]
}
```

Correct a weigh-in with `PATCH /api/v1/measurements/{id}` and `{ "value": 151.4 }`. The old row remains, with `supersededAt` set.

## MCP-style endpoint

`POST /api/mcp` accepts JSON-RPC methods `initialize`, `tools/list`, and `tools/call` with the same bearer token. It is a thin adapter over the domain services, not a full remote MCP session with resources and prompts. Tool names: `get_dashboard`, `list_workouts`, `get_body_trends`, `get_personal_records`, `list_goals`, `create_workout`.

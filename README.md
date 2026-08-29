# Nexus 3D

Nexus 3D is a browser-based, collaborative engineering workspace: people share a room, edit one Python document together, run it in an isolated E2B sandbox, and see the same execution result. The frontend is designed to render immediately, including its local WebGL topology scene; it never waits for Render before painting the UI.

## Main features

- Real CRDT editing: Yjs updates travel over an Ably room channel, without polling.
- Room isolation: every shareable `/nexus/room/<id>` has a distinct document, database record, and Ably capability.
- Reliable Python execution: only the Render API calls E2B Code Interpreter. Render itself does not execute user code and this repository contains no Docker executor.
- Shared execution visibility: backend-published execution events reach every connected collaborator in that room.
- Persistence and recovery: debounced snapshots go to Neon, while `y-indexeddb` preserves local Yjs state through temporary network loss and refreshes.
- A local React Three Fiber scene that remains available while Render wakes up.

## Architecture

```text
Browser (Vercel React + R3F + Yjs + IndexedDB)
   ├── HTTPS API ───────────────> Render (Express API)
   │                                  ├── Neon PostgreSQL (CRDT snapshots)
   │                                  └── E2B Code Interpreter (Python only)
   └── Ably Realtime <──── token request ─ Render (server-side Ably key)
```

The browser has only `VITE_API_URL`. It never contains an E2B key, Neon URL, or Ably API key. Render creates a short-lived, room-capability-scoped Ably TokenRequest; the Ably SDK exchanges and refreshes it automatically.

## Technology stack

- Frontend: React, Vite, TypeScript, React Three Fiber, Three.js, Yjs, y-indexeddb, Ably Realtime.
- Backend: Node 20, Express, TypeScript, Neon serverless driver, Ably REST, E2B Code Interpreter SDK.
- Hosting: Vercel frontend, Render backend, Neon database, Ably transport, E2B execution.

## Simple five-step deployment

### STEP 1 — GitHub

Unzip this project, create a GitHub repository, and push the `nexus-3d` directory contents. Do not commit `.env` files.

### STEP 2 — Vercel

Import the repository in Vercel. Set **Root Directory** to `frontend`. Add one environment variable:

```ini
VITE_API_URL=https://your-nexus-api.onrender.com
```

Deploy. Copy the resulting Vercel URL for the next step.

### STEP 3 — Render

Create a Render **Web Service** from the same repository, choosing `backend` as the root directory. Render can use `render.yaml`, or configure:

```text
Build command: npm ci && npm run build
Start command: npm start
Health check: /api/health
Runtime: Node 20
```

Set the server-only variables below. Set `CORS_ORIGIN` to the exact deployed Vercel URL (no trailing slash), then redeploy after changing it.

### STEP 4 — External services

1. Create a Neon database and copy its pooled PostgreSQL connection string to `DATABASE_URL`.
2. Create an Ably app/key and copy the full key to `ABLY_API_KEY`. This key is server-only. The backend creates the table automatically on first startup.
3. Create an E2B API key and copy it to `E2B_API_KEY`. This key is server-only.

### STEP 5 — Test

Open the Vercel URL. The 3D screen appears immediately. Enter a room, open its invite link in a second browser, and verify text sync. Run:

```python
print("Hello Nexus")
for i in range(5):
    print(i)
```

Both browsers receive the result. Refresh and confirm the document returns. Also try `print(1 / 0)`; the terminal presents a Python execution error instead of crashing the API.

## Environment variables

`frontend/.env.example` contains the only browser-safe value:

| Name | Where | Meaning |
|---|---|---|
| `VITE_API_URL` | Vercel | Public HTTPS base URL of Render API |
| `DATABASE_URL` | Render | Neon PostgreSQL connection string |
| `E2B_API_KEY` | Render | E2B secret API key |
| `ABLY_API_KEY` | Render | Ably root key used only to mint scoped client auth |
| `CORS_ORIGIN` | Render | Exact comma-separated allowed frontend origins |
| `PORT` | Render | Optional; defaults to 8787 |

## Local development

Copy both example files to `.env`, supply real server credentials only in `backend/.env`, then run in separate terminals:

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

For a local browser client, include `http://localhost:5173` in backend `CORS_ORIGIN`. Use the normal deployed Vercel origin in production.

## Python execution and limits

`POST /api/execute` validates requests and accepts Python source only. It imposes a 20,000-character input limit, a 15-second E2B code timeout, a 64 KB output cap, and at most four concurrent executions per Render instance. Each sandbox is killed in `finally`, including error paths. A Python exception is returned as an execution result; an E2B service issue is a distinct `502` response. There is no local interpreter, `child_process`, Docker, Docker-in-Docker, or 503 fallback in the execution path.

## Persistence, realtime, and reconnection

The client loads the latest Neon CRDT snapshot, starts IndexedDB persistence, then connects to a room-specific Ably channel. Local Yjs updates are sent immediately when connected and are retained locally when offline. The API saves a debounced CRDT snapshot rather than individual keystrokes. On the server snapshots are Yjs-merged, avoiding a delayed offline save overwriting another update. Ably reconnects and refreshes token authentication automatically. The UI reports connection state and has no startup dependency or endless health polling.

## API

`GET /api/health` returns JSON `{ "status": "ok", "database": "ready" }` when Neon is reachable.

`POST /api/execute` body:

```json
{ "code": "print('Hello Nexus')", "roomId": "blue-mountain" }
```

Successful execution returns `{ "success": true, "output": "Hello Nexus\\n", "error": null }`. Python failures return HTTP 200 with `success: false`; infrastructure failures are distinguishable with `kind: "service-error"`.

## Security

- Secrets exist only in Render environment variables.
- Ably clients receive signed, short-lived, room-scoped token requests rather than the server key.
- CORS is an explicit allowlist, never a permissive credentialed wildcard.
- E2B, not Render, isolates and executes arbitrary Python.
- Input, room IDs, request bodies, output size, timeouts, rate limits, and per-instance execution concurrency are bounded.

## Troubleshooting

- **Frontend says offline while loading:** The page is still usable; wait for Render to wake, then use the normal Ably reconnect flow. Check the configured `VITE_API_URL` is HTTPS and has no trailing slash.
- **CORS error:** Set `CORS_ORIGIN` exactly to Vercel's production URL, including `https://`, and redeploy Render.
- **Ably connection fails:** Verify `ABLY_API_KEY` is on Render only and the key has publish/subscribe/presence capability.
- **Execution service error:** Verify `E2B_API_KEY` on Render and E2B account access. Python exceptions themselves appear as terminal results, not service errors.
- **No persisted room after refresh:** Verify Neon `DATABASE_URL` points to the intended database and Render's `/api/health` reports `database: ready`.

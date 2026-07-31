# Gemini Agent Platform POC — Real Estate Concierge

A working demo of the identity model behind a Google Gemini Agent Platform
deployment: a user authenticated via **Auth0**, a chat agent with its own
**agent identity**, and a **user-delegation (on-behalf-of) consent flow**
that gates any action which changes the user's data — all running on plain
Node so it can be inspected and modified without needing a live GCP project
first.

See `docs/architecture.md` for how the pieces fit together, and
`docs/gcp-mapping.md` for exactly how each simplification here maps back to
the real Vertex AI Agent Engine / Agent Gateway / Agent Registry primitives.
`docs/governance.md` is the operational companion (registry, audit log,
secret rotation, an operating checklist).

## What it demonstrates

- **Registration & login** via Auth0 (with a documented mock-auth fallback
  so the whole demo runs with zero external accounts).
- **Agent-initiated reads** (`search_property`, `get_preference`) that the
  agent performs under its own identity, no user interaction required.
- **User-delegated writes** (`update_preference`): the agent proposes the
  change, the chat UI pops a consent modal, and only an explicit approval
  mints the short-lived, single-use token that lets the change actually
  happen.
- **Agent registry governance**: the mock MCP server enforces a default-deny
  allow-list of which agent may call which tool, independent of whether a
  presented token is otherwise valid.

## Repository layout

```
gemini-agent-poc/
├── .env.example                  # shared config for the 3 backend services
├── packages/
│   ├── frontend/                 # React SPA: register, login, chat, consent modal
│   ├── frontdoor/                # validates Auth0 JWT, mints OBO tokens on consent
│   ├── agent-service/            # agent runtime (Gemini function-calling or mock planner)
│   └── mcp-server/                # mock MCP tools + agent registry + audit log
├── infra/                         # Terraform: Cloud Run x4, Secret Manager, IAM
├── scripts/
│   ├── deploy.sh                  # two-phase Cloud Run deploy (see infra/README.md)
│   └── smoke-test.mjs             # one-shot local backend test, no credentials needed
└── docs/                          # architecture, GCP mapping, governance
```

## Quickstart (zero external credentials)

```bash
npm install
cp .env.example .env
cp packages/frontend/.env.example packages/frontend/.env
npm run smoke-test   # spins up the 3 backend services, runs the full flow, tears down
npm run dev          # starts all 4 services for interactive use
```

With `npm run dev` running, open http://localhost:5173, click **Create
account**, type any display name (mock-auth mode), and try:

- `find me a 2 bedroom condo in Austin under $400k` — agent searches directly.
- `update my preference to Seattle townhouses under $500k` — triggers the
  consent modal; approve or deny it to see both outcomes.
- `find me a place` (after approving) — the agent reuses your saved
  preference.

## Wiring in real Auth0 and real Gemini

Both are additive — the mock fallbacks disengage automatically once real
config is present, no code changes needed:

1. **Auth0**: create a Regular Web App / SPA in Auth0, enable it for
   Universal Login, and create an API for the audience. Set
   `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` in `.env` and
   `VITE_AUTH0_DOMAIN` / `VITE_AUTH0_CLIENT_ID` / `VITE_AUTH0_AUDIENCE` in
   `packages/frontend/.env`. Set `ALLOW_MOCK_AUTH=false` /
   `VITE_ALLOW_MOCK_AUTH=false` once that's done.
2. **Gemini**: set `GEMINI_API_KEY` in `.env`. `agent-service` logs which
   planner it picked up on startup so you can confirm the switch.

## Deploying to Cloud Run

```bash
npm run deploy   # runs scripts/deploy.sh
```

Requires `gcloud` authenticated against a real GCP project and `terraform`
installed. See `infra/README.md` for the two-phase apply this requires
(the frontend's Auth0/frontdoor config is baked in at build time) and for
what's deliberately left as manual `gcloud` steps (Agent Engine, Agent
Registry, Agent Gateway) rather than modeled in Terraform.

## Known simplifications (intentional, called out in docs/gcp-mapping.md)

- Agent identity and on-behalf-of tokens are signed with shared HS256
  secrets here, standing in for Google-issued ID tokens and a real
  token-exchange broker, respectively.
- `agent-service` runs as a plain Cloud Run container, not a real Vertex AI
  Agent Engine deployment (Node isn't a supported Agent Engine runtime today
  — see `docs/gcp-mapping.md` §1 for the real mechanism this stands in for).
- Cloud Run IAM invoker enforcement between services is off by default
  (`infra/variables.tf`'s `enforce_cloud_run_iam_invoker`) because it
  requires moving this POC's custom tokens off the `Authorization` header
  first — see that variable's description.
- No real database anywhere — `mcp-server` holds everything in memory.

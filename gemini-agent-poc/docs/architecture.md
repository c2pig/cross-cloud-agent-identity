# Architecture

## Components

| Component | Role | Stands in for (real GCP) |
|---|---|---|
| `packages/frontend` | React SPA: registration, login, chat window, consent modal | A Gemini Enterprise / custom agent UI |
| `packages/frontdoor` | Validates the user's Auth0 token, brokers consent, mints OBO tokens | Workforce Identity Federation + a trust-broker/token-exchange service |
| `packages/agent-service` | Runs the agent loop (Gemini function-calling or a mock planner), owns its own agent identity | A Vertex AI Agent Engine deployment |
| `packages/mcp-server` | Mock MCP tools (`search_property`, `get_preference`, `update_preference`), enforces the agent registry + delegation checks | An MCP-fronted backend behind an Agent Gateway (egress) |

No real database is used anywhere — `mcp-server` keeps properties and
preferences in memory (see `packages/mcp-server/src/data.js`).

## Identity model

Three distinct identities are in play, and the POC is built specifically to
keep them from ever collapsing into one:

1. **User identity** — the Auth0-authenticated end user (`sub` claim). Source
   of trust for "who is asking."
2. **Agent identity** — `agent-service`'s own fixed identity
   (`agents/real-estate-agent-v1`), asserted via a signed token it mints for
   every MCP call. This is what lets `search_property` and `get_preference`
   (read-only, no user-specific side effects) happen without bothering the
   user for consent every time the agent wants to look something up.
3. **On-behalf-of (OBO) identity** — a short-lived, single-use credential
   asserting "user X delegated this specific write action to agent Y,"
   minted by `frontdoor` only after the user explicitly approves.

## Flow 1 — agent-initiated read (no consent needed)

```mermaid
sequenceDiagram
    participant U as User (browser)
    participant F as frontdoor
    participant A as agent-service
    participant M as mcp-server

    U->>F: POST /api/chat (Auth0 JWT, "find a condo in Austin")
    F->>F: verify Auth0 JWT, extract user sub
    F->>A: POST /agent/chat (X-Frontdoor-Key, userId, message)
    A->>A: plan turn (Gemini or mock) -> decides to search
    A->>M: POST /mcp/tools/call search_property (agent identity token)
    M->>M: check agent registry allows this agent+tool
    M-->>A: matching listings
    A-->>F: final text response
    F-->>U: agent message
```

## Flow 2 — delegated write (consent required)

```mermaid
sequenceDiagram
    participant U as User (browser)
    participant F as frontdoor
    participant A as agent-service
    participant M as mcp-server

    U->>F: POST /api/chat ("update my preference to Seattle, <$500k")
    F->>A: POST /agent/chat
    A->>A: plan turn -> wants to call update_preference
    A-->>F: { type: consent_required, consentId, proposedPatch, askText }
    F-->>U: agent message + consent modal (approve/deny)
    U->>F: POST /api/consent/:consentId/approve (Auth0 JWT)
    F->>F: verify consentId belongs to this user
    F->>F: mint OBO token (sub=user, act.sub=agent, scope=preference:write, 60s exp)
    F->>A: POST /agent/consent-callback (oboToken)
    A->>M: POST /mcp/tools/call update_preference (agent identity token + X-Obo-Token)
    M->>M: verify agent registry + OBO signature/scope/actor/subject, reject replay
    M-->>A: updated preference
    A-->>F: final text response
    F-->>U: "Done -- I've updated your saved preference: ..."
```

If the user denies instead, `frontdoor` never mints an OBO token at all —
`agent-service` just returns a canned decline and `mcp-server` is never
called.

## Local dev vs. mock mode

Everything above works with zero external credentials:

- **Auth**: without a real Auth0 tenant configured, `frontdoor` and the
  frontend fall back to an explicit `ALLOW_MOCK_AUTH` mode (a typed display
  name stands in for a real login). Wiring in a real Auth0 tenant flips this
  off automatically.
- **Planner**: without `GEMINI_API_KEY`, `agent-service` uses a small
  deterministic keyword-based planner (`mockPlanner.js`) that implements the
  exact same `planTurn()` interface as the real Gemini function-calling
  planner (`geminiClient.js`). Setting `GEMINI_API_KEY` switches it over with
  no other code changes.

This is what makes `npm run dev` + `npm run smoke-test` work immediately
after `npm install`, before you've touched Auth0 or Google Cloud at all.

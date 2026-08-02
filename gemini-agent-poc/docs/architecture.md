# Architecture

As of the `fresh-eyes-501103` deployment, this POC runs on the **real**
Gemini Enterprise Agent Platform primitives (not simulations of them): a
real Vertex AI Agent Runtime deployment, real Agent Gateway in both
ingress and egress modes, a real Agent Registry, real Agent Identity
(SPIFFE/mTLS), and a real MCP (Model Context Protocol) server. See
`docs/deployment.md` for the live resource names and `docs/gcp-mapping.md`
for what's still simplified.

## Components

| Component | Role | Platform primitive |
|---|---|---|
| `packages/frontend` | React SPA: registration, login, chat window, consent modal | — |
| `packages/frontdoor` | Validates the user's Auth0 JWT, brokers consent, mints OBO delegation tokens. The Auth0 JWT is never forwarded past this point. | Cloud Run (stands in for Workforce Identity Federation) |
| `packages/agent-runtime` (`real_estate_agent`) | Python ADK agent: `search_property` / `get_preference` (read, no consent) and `propose_update_preference` / `apply_update_preference` (write, gated on consent) | **Vertex AI Agent Runtime** — real managed compute, real Agent Identity |
| `packages/agent-runtime/bridge.py` | Thin Python service frontdoor calls to reach the real Agent Runtime (session create/query/state-append) — Node has no mature client library for this yet | Cloud Run; itself just another authorized caller of Agent Runtime |
| `packages/mcp-server` | Real MCP JSON-RPC server exposing the three tools; verifies the OBO delegation token on writes (the one check Agent Gateway doesn't model) | Cloud Run, registered in **Agent Registry** |
| Agent Gateway — ingress | Controls which callers (the bridge) may reach the agent at all | **real GCP resource**, `governedAccessPath: CLIENT_TO_AGENT` |
| Agent Gateway — egress | Controls which destinations the agent may call; default-deny unless registered | **real GCP resource**, `governedAccessPath: AGENT_TO_ANYWHERE` |
| Agent Registry | Central allow-list both gateways consult — agents auto-register on deploy, `mcp-server` is registered manually with its tool spec | **real GCP resource** |

No real database is used anywhere — `mcp-server` keeps properties and
preferences in memory (see `packages/mcp-server/src/data.js`).

## System diagram

```mermaid
flowchart TB
    U["Browser SPA<br/>(React)"]
    A0["Auth0 Tenant<br/>Universal Login"]
    FD["frontdoor<br/>Cloud Run (Node)"]
    BR["bridge<br/>Cloud Run (Python)"]

    subgraph GWI["Agent Gateway — ingress<br/>(Client-to-Agent, real GCP resource)"]
        direction TB
    end

    subgraph AR["Vertex AI Agent Runtime (real)"]
        AG["real_estate_agent (Python ADK)<br/>gemini-2.5-flash<br/>Agent Identity: SPIFFE / mTLS"]
    end

    subgraph GWE["Agent Gateway — egress<br/>(Agent-to-Anywhere, real GCP resource)"]
        direction TB
    end

    MCP["mcp-server<br/>Cloud Run (Node)<br/>real MCP JSON-RPC"]
    REG[("Agent Registry<br/>(real GCP resource)")]

    U -- "Auth0 JWT (login only)" --> A0
    U -- "Auth0 JWT" --> FD
    FD -- "{userId, sessionId, message}<br/>-- no JWT" --> BR
    BR --> GWI
    GWI --> AG
    AG -- "MCP tools/call" --> GWE
    GWE --> MCP
    GWE -. "consults allow-list" .-> REG
    GWI -. "consults allow-list" .-> REG
    MCP -. "registered tool spec" .-> REG
```

## Identity model

Three distinct identities are in play, and the POC is built specifically to
keep them from ever collapsing into one:

1. **User identity** — the Auth0-authenticated end user (`sub` claim). Source
   of trust for "who is asking." The Auth0 JWT lives only between the
   browser and `frontdoor`; nothing downstream of `frontdoor` — not the
   bridge, not the agent, and never the LLM — ever sees it.
2. **Agent identity** — a real, platform-provisioned SPIFFE identity
   (`principal://.../reasoningEngines/{id}`), automatically assigned to
   `real_estate_agent` when it deployed to Agent Runtime with
   `identity_type=AGENT_IDENTITY`. Secured by auto-rotated mTLS — no shared
   secret exists anywhere for this. This is what lets `search_property` and
   `get_preference` (read-only, no user-specific side effects) happen
   without bothering the user for consent every time the agent wants to
   look something up, and it's what Agent Gateway's egress policy actually
   authorizes against Agent Registry.
3. **On-behalf-of (OBO) identity** — a short-lived, single-use delegation
   token asserting "user X approved this specific write," minted by
   `frontdoor` only after explicit user approval. It never appears in a
   chat message or the model's context: `bridge.py` injects it directly
   into the ADK session's state via the Agent Engine Sessions API
   (`appendEvent` with a `state_delta`), and only the tool function's own
   Python code (`apply_update_preference`, not the LLM) ever reads it back
   out — the same "custom auth provider" pattern Agent Identity's docs
   describe for forwarding delegated credentials.

## Flow 1 — agent-initiated read (no consent needed)

```mermaid
sequenceDiagram
    participant U as User (browser)
    participant F as frontdoor
    participant B as bridge
    participant GWI as Agent Gateway (ingress)
    participant A as real_estate_agent<br/>(Agent Runtime)
    participant GWE as Agent Gateway (egress)
    participant M as mcp-server

    U->>F: POST /api/chat (Auth0 JWT, "find a condo in Austin")
    F->>F: verify Auth0 JWT, extract user sub
    Note over F,B: Auth0 JWT stops here -- bridge only gets {userId, sessionId, message}
    F->>B: POST /agent/chat (X-Frontdoor-Key, userId, sessionId, message)
    B->>GWI: streamQuery (bridge's own SA credential)
    GWI->>GWI: check caller identity against Agent Registry allow-list
    GWI->>A: forward query
    A->>A: gemini-2.5-flash decides to call search_property
    A->>GWE: MCP tools/call search_property (agent's mTLS identity)
    GWE->>GWE: check agent identity + tool against Agent Registry
    GWE->>M: forward MCP tools/call
    M-->>GWE: matching listings
    GWE-->>A: matching listings
    A-->>GWI: final text
    GWI-->>B: final text
    B-->>F: { type: "final", message }
    F-->>U: agent message
```

## Flow 2 — delegated write (consent required)

```mermaid
sequenceDiagram
    participant U as User (browser)
    participant F as frontdoor
    participant B as bridge
    participant A as real_estate_agent<br/>(Agent Runtime)
    participant M as mcp-server

    U->>F: POST /api/chat ("update my preference to Seattle, <$500k")
    F->>B: POST /agent/chat (userId, sessionId, message)
    B->>A: streamQuery (via ingress gateway)
    A->>A: gemini-2.5-flash calls propose_update_preference<br/>(stores patch in session state, does NOT write)
    A-->>B: consent_required { proposedPatch, askText }
    B-->>F: { type: "consent_required", consentId, proposedPatch, message }
    F-->>U: agent message + consent modal (approve/deny)

    U->>F: POST /api/consent/:consentId/approve (Auth0 JWT)
    F->>F: verify consentId belongs to this user
    F->>F: mint OBO token (sub=user, scope=preference:write, consent_id, 60s exp)
    Note over F,B: OBO token travels to bridge, never to the model
    F->>B: POST /agent/consent-callback (userId, sessionId, oboToken)
    B->>A: Sessions.appendEvent(state_delta={obo_token})
    Note over A: token now lives only in session state
    B->>A: streamQuery("SYSTEM: user approved -- call apply_update_preference")
    A->>A: apply_update_preference reads obo_token from<br/>tool_context.state (never from the LLM's arguments)
    A->>M: MCP tools/call update_preference (X-Obo-Token header)
    M->>M: verify OBO scope/subject/consent_id, reject replay
    M-->>A: updated preference
    A-->>B: final text
    B-->>F: { message }
    F-->>U: "Done -- I've updated your saved preference: ..."
```

If the user denies instead, `frontdoor` never mints an OBO token at all —
`bridge` sends back a canned decline and `mcp-server` is never called.

## Token lifecycle at a glance

```mermaid
sequenceDiagram
    participant U as User
    participant A0 as Auth0
    participant F as frontdoor
    participant S as ADK session state
    participant T as Tool code (Python)
    participant L as LLM (gemini-2.5-flash)

    U->>A0: Universal Login
    A0-->>U: Auth0 JWT
    U->>F: Auth0 JWT (every request)
    F->>F: verify signature, extract sub
    Note over F: Auth0 JWT destroyed here -- never forwarded

    U->>F: approve pending write
    F->>F: mint OBO delegation token
    F->>S: appendEvent(state_delta={obo_token})
    Note over S,L: state lives outside the model's context window

    L->>T: calls apply_update_preference()
    T->>S: read obo_token directly
    Note over L: LLM never sees the Auth0 JWT or the OBO token --<br/>only ever sees tool names, arguments, and text
```

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

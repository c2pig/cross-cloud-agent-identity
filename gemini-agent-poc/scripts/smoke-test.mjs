#!/usr/bin/env node
// One-shot local smoke test: spawns mcp-server, agent-service, and frontdoor
// in mock-auth / mock-planner mode (no external credentials needed), drives
// the happy path plus the delegation/consent and registry-governance edge
// cases, then tears everything down. This is what `npm run smoke-test` runs.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const ENV = {
  ...process.env,
  AUTH0_DOMAIN: "your-tenant.auth0.com", // placeholder -> mock-auth mode
  AUTH0_AUDIENCE: "https://gemini-agent-poc/api",
  ALLOW_MOCK_AUTH: "true",
  FRONTDOOR_PORT: "8080",
  AGENT_SERVICE_PORT: "8081",
  MCP_SERVER_PORT: "8082",
  AGENT_SERVICE_URL: "http://localhost:8081",
  MCP_SERVER_URL: "http://localhost:8082",
  AGENT_IDENTITY_ID: "agents/real-estate-agent-v1",
  OBO_SIGNING_SECRET: "smoke-test-obo-secret",
  AGENT_IDENTITY_SIGNING_SECRET: "smoke-test-agent-identity-secret",
  FRONTDOOR_TO_AGENT_KEY: "smoke-test-frontdoor-key",
  GEMINI_API_KEY: "", // force mock planner for deterministic assertions
};

const procs = [];
function startService(name, cwd) {
  const p = spawn(process.execPath, ["src/index.js"], { cwd, env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  procs.push(p);
  return p;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealthy(url, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`${url} did not become healthy in time`);
}

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    console.log(`PASS: ${name}`);
    pass += 1;
  } else {
    console.log(`FAIL: ${name}`);
    fail += 1;
  }
}

function shutdown() {
  procs.forEach((p) => p.kill());
}

async function main() {
  startService("mcp-server", path.join(ROOT, "packages/mcp-server"));
  startService("agent-service", path.join(ROOT, "packages/agent-service"));
  startService("frontdoor", path.join(ROOT, "packages/frontdoor"));

  await waitForHealthy("http://localhost:8082/healthz");
  await waitForHealthy("http://localhost:8081/healthz");
  await waitForHealthy("http://localhost:8080/healthz");

  const headers = { "Content-Type": "application/json", "X-Mock-User": "smoke-tester" };
  const sessionId = "smoke-session";

  // 1. agent-initiated read, no consent needed
  let resp = await fetch("http://localhost:8080/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ message: "find me a 2 bedroom condo in Austin under $400k", sessionId }),
  });
  let body = await resp.json();
  check("search returns HTTP 200", resp.status === 200);
  check("search finds a matching Austin listing", /Austin/i.test(body.message || ""));

  // 2. delegated write proposes consent instead of acting directly
  resp = await fetch("http://localhost:8080/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ message: "update my preference to Seattle townhouses under $500k", sessionId }),
  });
  body = await resp.json();
  check(
    "update_preference triggers consent_required instead of an immediate write",
    body.type === "consent_required" && Boolean(body.consentId)
  );
  const consentId = body.consentId;

  // 3. a different user cannot resolve someone else's consent request
  resp = await fetch(`http://localhost:8080/api/consent/${consentId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Mock-User": "someone-else" },
  });
  check("a different user cannot approve someone else's consent", resp.status === 403);

  // 4. the correct user approves -> OBO token minted -> write applied
  resp = await fetch(`http://localhost:8080/api/consent/${consentId}/approve`, {
    method: "POST",
    headers,
  });
  body = await resp.json();
  check("approve succeeds", resp.status === 200);
  check("approved update is reflected in the response", /Seattle/i.test(body.message || ""));

  // 5. the same consentId cannot be resolved twice (replay protection)
  resp = await fetch(`http://localhost:8080/api/consent/${consentId}/approve`, {
    method: "POST",
    headers,
  });
  check("resolved consentId cannot be replayed", resp.status === 404);

  // 6. a later search picks up the saved preference
  resp = await fetch("http://localhost:8080/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ message: "find me a place", sessionId }),
  });
  body = await resp.json();
  check("subsequent search uses the saved preference", /saved preference/i.test(body.message || ""));

  // 7. denial path never applies the change
  resp = await fetch("http://localhost:8080/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ message: "update my preference to Denver houses under $700k", sessionId }),
  });
  body = await resp.json();
  check("second update proposal also requires consent", body.type === "consent_required");
  const denyConsentId = body.consentId;

  resp = await fetch(`http://localhost:8080/api/consent/${denyConsentId}/deny`, {
    method: "POST",
    headers,
  });
  body = await resp.json();
  check(
    "deny succeeds without applying the change",
    resp.status === 200 && /won't make that change/i.test(body.message || "")
  );

  // 8. audit log distinguishes agent-only calls from on-behalf-of calls
  resp = await fetch("http://localhost:8082/admin/audit-log");
  const auditLog = await resp.json();
  check(
    "audit log records at least one on-behalf-of call",
    auditLog.some((e) => e.onBehalfOf)
  );

  // 9. registry default-deny rejects an unregistered agent id even with a
  //    validly-signed identity token
  const rogueToken = jwt.sign({}, ENV.AGENT_IDENTITY_SIGNING_SECRET, {
    subject: "agents/rogue-agent",
    audience: "mcp-server",
    expiresIn: "5m",
  });
  resp = await fetch("http://localhost:8082/mcp/tools/call", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${rogueToken}` },
    body: JSON.stringify({ name: "search_property", arguments: {} }),
  });
  check("unregistered agent id is denied by the agent registry", resp.status === 403);

  console.log(`\n${pass} passed, ${fail} failed`);
  shutdown();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  shutdown();
  process.exit(1);
});

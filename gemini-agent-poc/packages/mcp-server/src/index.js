import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const { verifyOboToken, consumeConsentId } = await import("./auth.js");
const { searchProperties, getPreference, updatePreference } = await import("./data.js");
const { recordAudit, getAuditLog } = await import("./audit.js");

// Cloud Run injects PORT at deploy time; MCP_SERVER_PORT is the local-dev knob.
const PORT = process.env.PORT || process.env.MCP_SERVER_PORT || 8082;

// Real MCP protocol server. Agent-identity verification and the
// agent+tool allow-list that used to live here (shared-secret JWT + a local
// registry/agents.json file) are now enforced for real, before traffic ever
// reaches this container, by Agent Gateway (egress mode) + Agent Registry +
// Agent Identity's mTLS -- see docs/gcp-mapping.md. What stays here is the
// one thing Agent Gateway does *not* model: "was this specific write
// approved by the specific consenting user" -- the on-behalf-of (OBO)
// delegation-token check below.
function buildMcpServer() {
  const server = new McpServer({ name: "real-estate-mcp-server", version: "1.0.0" });

  server.registerTool(
    "search_property",
    {
      title: "Search Property",
      description: "Search mock property listings by city, max price, minimum bedrooms, and property type.",
      inputSchema: {
        city: z.string().optional(),
        maxPrice: z.number().optional(),
        minBedrooms: z.number().optional(),
        type: z.enum(["condo", "house", "townhouse"]).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      const correlationId = headerFrom(extra, "x-correlation-id");
      const results = searchProperties(args);
      recordAudit({ correlationId, tool: "search_property", decision: "allow" });
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
  );

  server.registerTool(
    "get_preference",
    {
      title: "Get Preference",
      description: "Read the calling user's saved search preference.",
      inputSchema: { userId: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      const correlationId = headerFrom(extra, "x-correlation-id");
      const pref = getPreference(args.userId);
      recordAudit({ correlationId, tool: "get_preference", decision: "allow" });
      return { content: [{ type: "text", text: JSON.stringify(pref) }] };
    }
  );

  server.registerTool(
    "update_preference",
    {
      title: "Update Preference",
      description:
        "Update the calling user's saved search preference. Requires a valid on-behalf-of (OBO) delegation token minted only after the user approved this exact change -- this is a write, never call it without one.",
      inputSchema: {
        userId: z.string(),
        patch: z.object({
          city: z.string().optional(),
          maxPrice: z.number().optional(),
          minBedrooms: z.number().optional(),
          type: z.enum(["condo", "house", "townhouse"]).optional(),
        }),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      const correlationId = headerFrom(extra, "x-correlation-id");
      const oboToken = headerFrom(extra, "x-obo-token");
      const auditBase = { correlationId, tool: "update_preference" };

      const obo = verifyOboToken(oboToken, {
        requiredScope: "preference:write",
        expectedUserId: args.userId,
      });

      if (!obo.ok) {
        recordAudit({ ...auditBase, decision: "deny", reason: obo.reason });
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: obo.reason }) }],
        };
      }

      consumeConsentId(obo.claims.consent_id);
      const updated = updatePreference(args.userId, args.patch || {});
      recordAudit({ ...auditBase, decision: "allow", onBehalfOf: obo.claims.sub, consentId: obo.claims.consent_id });
      return { content: [{ type: "text", text: JSON.stringify(updated) }] };
    }
  );

  return server;
}

function headerFrom(extra, name) {
  const headers = extra?.requestInfo?.headers;
  if (!headers) return null;
  const value = typeof headers.get === "function" ? headers.get(name) : headers[name];
  return Array.isArray(value) ? value[0] : value || null;
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
app.get("/admin/audit-log", (_req, res) => res.json(getAuditLog()));

// Stateless Streamable HTTP transport -- a fresh McpServer + transport per
// request, matching the SDK's documented stateless pattern. No session
// affinity needed for this POC's tool set.
app.post("/mcp", async (req, res) => {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`MCP server (real protocol) listening on :${PORT}`);
});

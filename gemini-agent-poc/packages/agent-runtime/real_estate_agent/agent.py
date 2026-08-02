"""Real-estate concierge agent, deployed for real onto Vertex AI Agent Runtime.

Three identities stay separate here, mirroring docs/architecture.md:
  1. User identity -- the Auth0 `sub`, passed in as a plain string arg. This
     agent's code and prompt never see the user's Auth0 JWT.
  2. Agent identity -- provisioned automatically by Agent Runtime
     (identity_type=AGENT_IDENTITY at deploy time); the mTLS/SPIFFE identity
     this process authenticates as is not something this code manages.
  3. On-behalf-of (OBO) delegation -- `apply_update_preference` reads its
     delegation token from `tool_context.state`, set there by the caller
     (frontdoor) via the Agent Engine Sessions API, never as a tool argument
     the model can see or influence. This is the "custom auth provider"
     pattern described in Agent Identity's docs: the forwarded credential
     lives in session state, not in the LLM's context window.
"""

from google.adk.agents import Agent
from google.adk.tools import ToolContext

from . import mcp_client

MODEL = "gemini-2.5-flash"

SYSTEM_INSTRUCTION = """You are a real-estate concierge agent.

Use search_property and get_preference freely to help the user -- these are
read-only and safe to call without asking first.

Never persist a preference change yourself. When the user wants to update
their saved search preference, call propose_update_preference with the new
values and then relay its confirmation question to the user verbatim. Do
not call apply_update_preference yourself -- it will only be invoked by the
platform after the user explicitly approves, and it requires a delegation
credential you do not have access to.
"""


async def search_property(
    city: str | None = None,
    max_price: float | None = None,
    min_bedrooms: int | None = None,
    type: str | None = None,
    tool_context: ToolContext = None,
) -> dict:
    """Search mock property listings by city, max price, min bedrooms, and type.

    Args:
        city: City name, e.g. "Austin".
        max_price: Maximum price in USD.
        min_bedrooms: Minimum number of bedrooms.
        type: One of "condo", "house", "townhouse".
    """
    correlation_id = tool_context.state.get("correlation_id") if tool_context else None
    args = {k: v for k, v in {
        "city": city, "maxPrice": max_price, "minBedrooms": min_bedrooms, "type": type,
    }.items() if v is not None}
    result = await mcp_client.call_tool("search_property", args, correlation_id=correlation_id)
    return {"listings": result["text"]}


async def get_preference(tool_context: ToolContext) -> dict:
    """Read the current user's saved search preference."""
    user_id = tool_context.state.get("user_id")
    correlation_id = tool_context.state.get("correlation_id")
    result = await mcp_client.call_tool(
        "get_preference", {"userId": user_id}, correlation_id=correlation_id
    )
    return {"preference": result["text"]}


async def propose_update_preference(
    city: str | None = None,
    max_price: float | None = None,
    min_bedrooms: int | None = None,
    type: str | None = None,
    tool_context: ToolContext = None,
) -> dict:
    """Propose updating the user's saved search preference.

    This does NOT save anything -- it only records the proposed patch in
    session state and returns a confirmation question for the user. The
    platform obtains explicit user consent before apply_update_preference
    is ever called.

    Args:
        city: New city preference, if changing.
        max_price: New max price preference, if changing.
        min_bedrooms: New minimum bedrooms preference, if changing.
        type: New property type preference, if changing.
    """
    patch = {k: v for k, v in {
        "city": city, "maxPrice": max_price, "minBedrooms": min_bedrooms, "type": type,
    }.items() if v is not None}
    tool_context.state["pending_preference_patch"] = patch
    return {
        "status": "consent_required",
        "proposedPatch": patch,
        "askText": f"I'd like to update your saved preference to {patch}. Shall I go ahead?",
    }


async def apply_update_preference(tool_context: ToolContext) -> dict:
    """Apply the previously proposed preference update.

    Only ever invoked by the platform after the user has explicitly
    approved -- never call this directly from a model turn. Reads the
    delegation (on-behalf-of) token from session state, not from any
    argument, so the token is never part of the model's visible context.
    """
    user_id = tool_context.state.get("user_id")
    correlation_id = tool_context.state.get("correlation_id")
    obo_token = tool_context.state.get("obo_token")
    patch = tool_context.state.get("pending_preference_patch") or {}

    result = await mcp_client.call_tool(
        "update_preference",
        {"userId": user_id, "patch": patch},
        correlation_id=correlation_id,
        obo_token=obo_token,
    )
    tool_context.state["pending_preference_patch"] = None
    return {"updated": result["text"]}


root_agent = Agent(
    name="real_estate_agent",
    model=MODEL,
    description="Real-estate concierge agent: searches listings and manages saved search preferences with user consent.",
    instruction=SYSTEM_INSTRUCTION,
    tools=[search_property, get_preference, propose_update_preference, apply_update_preference],
)

import { useState, useRef, useEffect } from "react";
import { useAuthBridge } from "../lib/AuthBridge";
import { sendChat, sendConsentDecision } from "../lib/api";
import ConsentModal from "../components/ConsentModal";

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export default function Chat() {
  const { user, getAuthHeaders, logout } = useAuthBridge();
  const [sessionId] = useState(uuid);
  const [messages, setMessages] = useState([
    {
      role: "agent",
      text:
        'Hi! I\'m your real-estate concierge agent. Try "find me a 2 bedroom condo in Austin under $400k" or "update my preference to Seattle townhouses under $500k".',
    },
  ]);
  const [input, setInput] = useState("");
  const [pendingConsent, setPendingConsent] = useState(null);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingConsent]);

  function pushMessage(role, text) {
    setMessages((prev) => [...prev, { role, text }]);
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    pushMessage("user", text);
    setBusy(true);
    try {
      const authHeaders = await getAuthHeaders();
      const resp = await sendChat({ message: text, sessionId, authHeaders });
      if (resp.type === "consent_required") {
        pushMessage("agent", resp.message);
        setPendingConsent({
          consentId: resp.consentId,
          tool: resp.tool,
          proposedPatch: resp.proposedPatch,
          message: resp.message,
        });
      } else {
        pushMessage("agent", resp.message);
      }
    } catch (err) {
      pushMessage("agent", `(error) ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function resolveConsent(decision) {
    if (!pendingConsent) return;
    setBusy(true);
    try {
      const authHeaders = await getAuthHeaders();
      const resp = await sendConsentDecision({
        consentId: pendingConsent.consentId,
        decision,
        authHeaders,
      });
      pushMessage("agent", resp.message);
    } catch (err) {
      pushMessage("agent", `(error) ${err.message}`);
    } finally {
      setPendingConsent(null);
      setBusy(false);
    }
  }

  return (
    <div className="page chat-page">
      <header className="chat-header">
        <h1>Real Estate Concierge</h1>
        <div className="actions">
          <span>{user?.name || user?.sub}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>
      <div className="chat-window" data-testid="chat-window">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <pre>{m.text}</pre>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input" onSubmit={handleSend}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent to search or update your preferences…"
          disabled={busy}
          data-testid="chat-input"
        />
        <button type="submit" disabled={busy} data-testid="chat-send">
          Send
        </button>
      </form>
      <ConsentModal
        pendingConsent={pendingConsent}
        busy={busy}
        onApprove={() => resolveConsent("approve")}
        onDeny={() => resolveConsent("deny")}
      />
    </div>
  );
}

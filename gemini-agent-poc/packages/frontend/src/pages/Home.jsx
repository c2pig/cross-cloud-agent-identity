import { Link } from "react-router-dom";
import { useAuthBridge } from "../lib/AuthBridge";

export default function Home() {
  const { isAuthenticated, user, logout } = useAuthBridge();

  return (
    <div className="page">
      <h1>Real Estate Concierge — Gemini Agent Platform POC</h1>
      <p>
        A user logs in via Auth0 (the source of trust for their identity), then chats with an
        agent that runs under its own agent identity. Read-only lookups happen freely; anything
        that changes the user's data requires the user's explicit, on-behalf-of delegation first.
      </p>
      {isAuthenticated ? (
        <div className="actions">
          <span>Signed in as {user?.name || user?.sub}</span>
          <Link className="button" to="/chat">
            Open chat
          </Link>
          <button onClick={logout}>Log out</button>
        </div>
      ) : (
        <div className="actions">
          <Link className="button" to="/login">
            Log in
          </Link>
          <Link className="button secondary" to="/register">
            Create account
          </Link>
        </div>
      )}
    </div>
  );
}

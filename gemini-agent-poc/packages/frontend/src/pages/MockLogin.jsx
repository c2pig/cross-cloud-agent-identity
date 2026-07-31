import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthBridge } from "../lib/AuthBridge";

export default function MockLogin() {
  const [name, setName] = useState("");
  const { completeMockLogin } = useAuthBridge();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const intent = params.get("intent") === "register" ? "register" : "login";

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    completeMockLogin(name.trim());
    navigate("/chat", { replace: true });
  }

  return (
    <div className="page">
      <h1>{intent === "register" ? "Create account (mock)" : "Log in (mock)"}</h1>
      <p>
        No real Auth0 tenant is configured (running with VITE_ALLOW_MOCK_AUTH=true). Enter any
        display name to simulate {intent === "register" ? "registering" : "logging in"} — set
        VITE_AUTH0_DOMAIN / VITE_AUTH0_CLIENT_ID to use real Auth0 Universal Login instead.
      </p>
      <form onSubmit={submit} className="actions">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name"
          data-testid="mock-login-name"
        />
        <button type="submit" data-testid="mock-login-submit">
          Continue
        </button>
      </form>
    </div>
  );
}

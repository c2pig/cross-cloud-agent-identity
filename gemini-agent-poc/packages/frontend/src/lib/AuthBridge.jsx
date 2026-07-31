import React, { createContext, useContext, useState, useCallback } from "react";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import {
  AUTH0_CONFIGURED,
  AUTH0_DOMAIN,
  AUTH0_CLIENT_ID,
  AUTH0_AUDIENCE,
  ALLOW_MOCK_AUTH,
} from "./config";

// Both the real Auth0 path and the local mock-auth path expose the same
// shape through this context, so pages/components never need to know which
// one is active.
const AuthBridgeContext = createContext(null);

function MockAuthProvider({ children }) {
  const [username, setUsername] = useState(() => localStorage.getItem("mockUser") || null);

  const login = useCallback((screenHint) => {
    const intent = screenHint === "signup" ? "register" : "login";
    window.location.assign(`/mock-login?intent=${intent}`);
  }, []);

  const completeMockLogin = useCallback((name) => {
    localStorage.setItem("mockUser", name);
    setUsername(name);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("mockUser");
    setUsername(null);
    window.location.assign("/");
  }, []);

  const value = {
    mode: "mock",
    isAuthenticated: Boolean(username),
    isLoading: false,
    user: username ? { sub: `mock|${username}`, name: username } : null,
    login,
    logout,
    completeMockLogin,
    getAuthHeaders: async () => ({ "X-Mock-User": username }),
  };

  return <AuthBridgeContext.Provider value={value}>{children}</AuthBridgeContext.Provider>;
}

function Auth0Bridge({ children }) {
  const {
    isAuthenticated,
    isLoading,
    user,
    loginWithRedirect,
    logout: auth0Logout,
    getAccessTokenSilently,
  } = useAuth0();

  const value = {
    mode: "auth0",
    isAuthenticated,
    isLoading,
    user,
    login: (screenHint) =>
      loginWithRedirect({ authorizationParams: { screen_hint: screenHint } }),
    logout: () => auth0Logout({ logoutParams: { returnTo: window.location.origin } }),
    getAuthHeaders: async () => {
      const token = await getAccessTokenSilently();
      return { Authorization: `Bearer ${token}` };
    },
  };

  return <AuthBridgeContext.Provider value={value}>{children}</AuthBridgeContext.Provider>;
}

export function AuthBridgeProvider({ children }) {
  if (AUTH0_CONFIGURED) {
    return (
      <Auth0Provider
        domain={AUTH0_DOMAIN}
        clientId={AUTH0_CLIENT_ID}
        authorizationParams={{
          redirect_uri: window.location.origin,
          audience: AUTH0_AUDIENCE,
        }}
      >
        <Auth0Bridge>{children}</Auth0Bridge>
      </Auth0Provider>
    );
  }

  if (ALLOW_MOCK_AUTH) {
    return <MockAuthProvider>{children}</MockAuthProvider>;
  }

  throw new Error(
    "Auth0 is not configured (VITE_AUTH0_DOMAIN) and VITE_ALLOW_MOCK_AUTH is not set -- see packages/frontend/.env.example"
  );
}

export function useAuthBridge() {
  const ctx = useContext(AuthBridgeContext);
  if (!ctx) throw new Error("useAuthBridge must be used within AuthBridgeProvider");
  return ctx;
}

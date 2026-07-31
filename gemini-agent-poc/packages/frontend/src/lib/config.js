export const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN || "";
export const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID || "";
export const AUTH0_AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE || "";
export const FRONTDOOR_URL = import.meta.env.VITE_FRONTDOOR_URL || "http://localhost:8080";
export const ALLOW_MOCK_AUTH = import.meta.env.VITE_ALLOW_MOCK_AUTH === "true";

// Treat the shipped placeholder domain as "not configured" so the app can run
// in mock-auth mode out of the box before a real Auth0 tenant is wired up.
export const AUTH0_CONFIGURED = Boolean(AUTH0_DOMAIN) && !AUTH0_DOMAIN.includes("your-tenant");

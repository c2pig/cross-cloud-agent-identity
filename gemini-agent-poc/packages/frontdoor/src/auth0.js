import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;

// Treat the shipped placeholder domain as "not configured" so the POC can
// run in mock-auth mode out of the box before a real Auth0 tenant is wired up.
export const auth0Configured = Boolean(AUTH0_DOMAIN) && !AUTH0_DOMAIN.includes("your-tenant");
export const mockAuthAllowed = process.env.ALLOW_MOCK_AUTH === "true";

const client = auth0Configured
  ? jwksClient({ jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json` })
  : null;

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

export function verifyAuth0Token(token) {
  return new Promise((resolve, reject) => {
    if (!auth0Configured) return reject(new Error("Auth0 is not configured"));
    jwt.verify(
      token,
      getKey,
      {
        audience: AUTH0_AUDIENCE,
        issuer: `https://${AUTH0_DOMAIN}/`,
        algorithms: ["RS256"],
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      }
    );
  });
}

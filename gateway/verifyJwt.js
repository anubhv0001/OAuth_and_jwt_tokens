// RESOURCE SERVER SIDE: validate the bearer token locally. Same file is used by gateway, book-service, order-service.
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ISSUER = process.env.JWT_ISSUER || 'http://localhost:4000';
const AUDIENCE = process.env.JWT_AUDIENCE || 'bookstore-api';

// >>> [A] LOAD THE PUBLIC KEY: fetched from auth-service and cached; re-fetched if a new key id appears
const JWKS = createRemoteJWKSet(new URL(process.env.JWKS_URL || 'http://localhost:4000/.well-known/jwks.json'), { cooldownDuration: 2000 });

// >>> [B] AUTHENTICATE: is this a genuine, unexpired token meant for us?
export async function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token)
    return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'missing_token' });
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER,          // iss must be our auth-service
      audience: AUDIENCE,      // aud must be this API
      algorithms: ['RS256'],   // pinned: blocks "alg: none" and algorithm-confusion attacks
    });                        // the signature and exp (expiry) are always checked by jwtVerify
    req.user = { id: payload.sub, username: payload.username, roles: payload.roles || [] };
    req.token = token;         // kept so order-service can forward it
    next();
  } catch (e) {
    res.status(401).set('WWW-Authenticate', 'Bearer error="invalid_token"').json({ error: 'invalid_token', reason: e.code });
  }
}

// >>> [C] AUTHORIZE: does the token's role allow this action?
export const requireRole = (...roles) => (req, res, next) =>
  roles.some((r) => req.user.roles.includes(r)) ? next() : res.status(403).json({ error: 'forbidden', required: roles });

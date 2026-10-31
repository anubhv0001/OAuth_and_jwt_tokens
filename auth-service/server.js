// AUTHORIZATION SERVER: logs users in and issues tokens. Everything is in memory (no database).
import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { SignJWT } from 'jose';

const PORT = process.env.PORT || 4000;
const ISSUER = process.env.JWT_ISSUER || 'http://localhost:4000';
const AUDIENCE = process.env.JWT_AUDIENCE || 'bookstore-api';
const CLIENT_ID = 'order-service';
const CLIENT_SECRET = process.env.SERVICE_CLIENT_SECRET || 'change-me-in-real-life';
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_DAYS = 7;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// >>> [1] SIGNING KEY PAIR: created at startup. The private key never leaves this process.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const KID = sha256(publicJwk.n).slice(0, 16);      // key id: tells verifiers which key signed a token
publicJwk.kid = KID; publicJwk.alg = 'RS256'; publicJwk.use = 'sig';

// >>> [2] IN-MEMORY STORES (lost on restart, which is fine for a demo)
const users = new Map([
  ['admin', { id: crypto.randomUUID(), username: 'admin', passwordHash: bcrypt.hashSync('Admin@123', 10), roles: ['USER', 'ADMIN'] }],
  ['alice', { id: crypto.randomUUID(), username: 'alice', passwordHash: bcrypt.hashSync('Alice@123', 10), roles: ['USER'] }],
]);
const refreshTokens = new Map();                   // sha256(token) -> { username, expiresAt }
setInterval(() => { for (const [k, v] of refreshTokens) if (v.expiresAt < Date.now()) refreshTokens.delete(k); }, 60_000).unref();

// >>> [3] CREATE THE ACCESS TOKEN (a signed JWT)
const signAccessToken = (claims, sub, ttlSeconds) =>
  new SignJWT(claims)                               // custom claims: username, roles
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject(String(sub))                        // sub  = who
    .setIssuer(ISSUER)                              // iss  = who issued it
    .setAudience(AUDIENCE)                          // aud  = which API it is for
    .setIssuedAt()                                  // iat
    .setExpirationTime(`${ttlSeconds}s`)            // exp  = 15 minutes from now
    .setJti(crypto.randomUUID())                    // jti  = unique token id
    .sign(privateKey);                              // RSA-SHA256 signature

// >>> [4] CREATE THE REFRESH TOKEN (random string; only its hash is stored)
const cookieOpts = {
  httpOnly: true,                                   // JavaScript cannot read it
  sameSite: 'strict',                               // not sent on cross-site requests
  secure: process.env.NODE_ENV === 'production',
  path: '/api/oauth',                               // browser sends it only to the token endpoints
  maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000,
};
async function issueTokens(res, user) {
  const raw = crypto.randomBytes(48).toString('hex');
  refreshTokens.set(sha256(raw), { username: user.username, expiresAt: Date.now() + REFRESH_DAYS * 864e5 });
  res.cookie('refresh_token', raw, cookieOpts);
  res.json({
    access_token: await signAccessToken({ username: user.username, roles: user.roles }, user.id, ACCESS_TTL_SECONDS),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
  });
}
const oauthError = (res, status, error, description) => res.status(status).json({ error, error_description: description });

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// >>> [5] PUBLISH THE PUBLIC KEY: other services download this to verify signatures
app.get('/.well-known/jwks.json', (req, res) => res.json({ keys: [publicJwk] }));

app.post('/auth/register', rateLimit({ windowMs: 60_000, limit: 10 }), async (req, res) => {
  const { username, password } = req.body;          // roles are NEVER read from the request
  if (typeof username !== 'string' || typeof password !== 'string' || username.length < 3 || password.length < 8)
    return oauthError(res, 400, 'invalid_request', 'Username min 3 chars, password min 8 chars');
  if (users.has(username)) return res.status(409).json({ error: 'username_taken' });
  users.set(username, { id: crypto.randomUUID(), username, passwordHash: await bcrypt.hash(password, 10), roles: ['USER'] });
  res.status(201).json({ message: 'registered' });
});

app.post('/oauth/token', rateLimit({ windowMs: 60_000, limit: 20 }), async (req, res) => {
  const { grant_type } = req.body;

  // >>> [6] PASSWORD GRANT (login): username + password -> tokens
  if (grant_type === 'password') {
    const user = users.get(String(req.body.username || ''));
    const ok = user && (await bcrypt.compare(String(req.body.password || ''), user.passwordHash));
    if (!ok) return oauthError(res, 400, 'invalid_grant', 'Wrong username or password');
    return issueTokens(res, user);
  }

  // >>> [7] REFRESH GRANT: refresh cookie -> new tokens (old refresh token is destroyed)
  if (grant_type === 'refresh_token') {
    const raw = req.cookies.refresh_token || req.body.refresh_token;
    if (!raw) return oauthError(res, 400, 'invalid_grant', 'No refresh token');
    const key = sha256(String(raw));
    const rec = refreshTokens.get(key);
    refreshTokens.delete(key);                      // single use: replaying it fails
    if (!rec || rec.expiresAt < Date.now() || !users.has(rec.username))
      return oauthError(res, 400, 'invalid_grant', 'Session expired, sign in again');
    return issueTokens(res, users.get(rec.username));
  }

  // >>> [8] CLIENT CREDENTIALS GRANT: service identity, no user involved
  if (grant_type === 'client_credentials') {
    const { client_id, client_secret } = req.body;
    const secretOk = crypto.timingSafeEqual(Buffer.from(sha256(String(client_secret ?? ''))), Buffer.from(sha256(CLIENT_SECRET)));
    if (client_id !== CLIENT_ID || !secretOk) return oauthError(res, 401, 'invalid_client', 'Bad client credentials');
    return res.json({ access_token: await signAccessToken({ roles: ['SERVICE'] }, client_id, 300), token_type: 'Bearer', expires_in: 300 });
  }

  oauthError(res, 400, 'unsupported_grant_type', 'Use password, refresh_token or client_credentials');
});

// >>> [9] LOGOUT: destroy the refresh token on the server
app.post('/oauth/revoke', (req, res) => {
  const raw = req.cookies.refresh_token || req.body.refresh_token;
  if (raw) refreshTokens.delete(sha256(String(raw)));
  res.clearCookie('refresh_token', { path: cookieOpts.path });
  res.status(204).end();
});

app.listen(PORT, () => console.log(`auth-service on :${PORT}  (users: admin/Admin@123, alice/Alice@123)`));

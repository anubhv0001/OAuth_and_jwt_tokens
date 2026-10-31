<<<<<<< HEAD
# OAuth2 + JWT Microservices Demo

A small full-stack project whose only goal is to **show how OAuth2 and JWT secure microservices**.
There is **no database**: users, books, orders and refresh tokens live in memory, so you can read the security code without any other noise.

Stack: Node.js + Express (4 services) and React + Vite (client). Nothing else to install: no Docker, no database.

---

## 1. Project layout (read it in this order)

```
1. auth-service/    Authorization Server: login, creates tokens, publishes the public key
2. book-service/    Protected API #1   (verifyJwt.js = the token checker)
3. order-service/   Protected API #2   (calls book-service with the user's token)
4. gateway/         Single public entry point; checks token, routes to services
5. client/          React app + live "token inspector" panel
```

```
 Browser ──► client (Vite :5173) ──/api──► gateway :8080 ──► auth-service  :4000   (public: login/refresh)
                                               │
                                               ├─ checks JWT ─► book-service  :4001
                                               └─ checks JWT ─► order-service :4002 ──► book-service (same token)
```

---

## 2. How to run (manual, no Docker)

**Requirements:** Node.js 18 or newer (check with `node -v`). That is all.

### Option A: one command (quickest)

From the project root:

```bash
npm install            # installs "concurrently", which starts all processes together
npm run install:all    # installs the dependencies of every service and the client
npm run dev            # starts auth, book, order, gateway and the React app
```

### Option B: one terminal per service (best for learning: you see every log)

Open 5 terminals. **Start auth-service first.**

| Terminal | Commands |
|---|---|
| 1 | `cd auth-service && npm install && npm start` |
| 2 | `cd book-service && npm install && npm start` |
| 3 | `cd order-service && npm install && npm start` |
| 4 | `cd gateway && npm install && npm start` |
| 5 | `cd client && npm install && npm run dev` |

### Check that it works

- Open **http://localhost:5173** and sign in.
- `http://localhost:8080/health` should show `{"status":"ok"}`.
- `http://localhost:4000/.well-known/jwks.json` should show the public key.

### Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE` (port already used) | stop the other program using that port, or the old copy of this project |
| Everything returns 401 after you restarted auth-service | it makes a new signing key on every start; log in again. If a service still rejects tokens, wait 2 seconds or restart it |
| Login page says "Request failed" | the gateway or auth-service is not running; look at their terminals |
| `npm: command not found` | install Node.js from nodejs.org |

### Demo users

| Username | Password | Roles |
|---|---|---|
| alice | Alice@123 | USER |
| admin | Admin@123 | USER, ADMIN |

You can also register new users (they always get only `USER`).

### Ports

| Port | What | Public in real life? |
|---|---|---|
| 5173 | React app | yes |
| 8080 | Gateway | yes |
| 4000 | auth-service | only the token endpoints |
| 4001 / 4002 | book / order services | **no** (open here only so you can test "bypass the gateway") |

---

## 3. How OAuth2 and JWT work here

### The roles

| OAuth2 role | In this project |
|---|---|
| Resource Owner | the user (alice, admin) |
| Client | the React app |
| Authorization Server | `auth-service` |
| Resource Server | `book-service`, `order-service` (and the gateway guards them) |

### The two tokens

| | Access token | Refresh token |
|---|---|---|
| What | JWT signed with RS256 | random 48-byte string |
| Lifetime | 15 minutes | 7 days |
| Used for | calling APIs: `Authorization: Bearer <jwt>` | getting a new access token |
| Browser storage | JS memory only | httpOnly, SameSite=Strict cookie |
| Server storage | none (stateless) | SHA-256 hash in a Map, single use |

### What a JWT looks like

Three Base64URL parts separated by dots: `header.payload.signature`

```
header    {"alg":"RS256","typ":"JWT","kid":"<key id>"}
payload   {"username":"alice","roles":["USER"],"sub":"<user id>",
           "iss":"http://localhost:4000","aud":"bookstore-api",
           "iat":1793426303,"exp":1793427203,"jti":"<uuid>"}
signature RSA-SHA256(header + "." + payload, PRIVATE KEY)
```

A JWT is **signed, not encrypted**: anyone can read it, nobody can change it. Changing one character of the header or payload breaks the signature.

### Step 1: Login, where the token is created

```
React ──POST /api/oauth/token {grant_type:"password", username, password}──► gateway ──► auth-service
        auth-service: look up user ─► bcrypt compare ─► sign JWT with PRIVATE key
                                   ─► create refresh token, store its hash
React ◄── {access_token: "eyJ..."}  +  Set-Cookie: refresh_token=...; HttpOnly; SameSite=Strict
```

### Step 2: Calling an API, where the token is checked

```
React ──GET /api/books  Authorization: Bearer eyJ...──► gateway
   gateway:       verify token  ──fail──► 401
   book-service:  verify token AGAIN (defense in depth) ─► check role ──fail──► 403 ─► data 200
```

How `verify` works (file `verifyJwt.js`, no call to auth-service per request):

1. First use: download the **public key** from `http://localhost:4000/.well-known/jwks.json` and cache it.
2. Pick the key whose `kid` matches the token header.
3. Check the **signature**, which proves auth-service created this token and nobody edited it.
4. Check **exp** (not expired), **iss** (correct issuer), **aud** (meant for this API).
5. Only **RS256** is accepted, so `alg: none` tricks fail.
6. Read `roles` from the payload for the authorization decision.

Only auth-service has the private key, so even a hacked book-service cannot create tokens.

### Step 3: Token propagation

`order-service` takes the user's token from the incoming request and sends the same `Authorization` header to `book-service`. Both services therefore know who the user is.

### Step 4: Refresh, where a new token is created before expiry

```
~30s before exp (or on any 401):
React ──POST /api/oauth/token {grant_type:"refresh_token"} + cookie (sent by browser automatically)──► auth-service
        auth-service: find hash ─► DELETE it (single use) ─► issue NEW access token + NEW refresh cookie
```

Replaying an old refresh cookie fails with `invalid_grant`. Sign out deletes the refresh token on the server (`/oauth/revoke`).

### Step 5: Service-to-service (client_credentials)

```bash
curl -X POST localhost:4000/oauth/token \
  -d grant_type=client_credentials -d client_id=order-service -d client_secret=change-me-in-real-life
```
Returns a 5-minute JWT with `roles: ["SERVICE"]`, used when no user is involved.

---

## 4. Where is the code? (code map)

| What happens | File | Lines / marker |
|---|---|---|
| RSA key pair generated, public JWK built | `auth-service/server.js` | 18, marker `[1]` |
| Users and refresh tokens (in memory) | `auth-service/server.js` | 24, `[2]` |
| **JWT creation and signing** (`SignJWT`) | `auth-service/server.js` | 32, `[3]` |
| **Refresh token creation** + cookie settings | `auth-service/server.js` | 44, `[4]` |
| Public key endpoint `/.well-known/jwks.json` | `auth-service/server.js` | 69, `[5]` |
| **Login** (password grant) | `auth-service/server.js` | 84, `[6]` |
| **Refresh** (rotation) | `auth-service/server.js` | 92, `[7]` |
| Service token (client_credentials) | `auth-service/server.js` | 104, `[8]` |
| Logout / revoke | `auth-service/server.js` | 115, `[9]` |
| **Load public key (JWKS)** | `*/verifyJwt.js` | 7, `[A]` |
| **Verify JWT** (signature, exp, iss, aud) | `*/verifyJwt.js` | 10, `[B]` |
| **Role check** (`requireRole`) | `*/verifyJwt.js` | 29, `[C]` |
| `/books` needs a token; POST needs ADMIN | `book-service/server.js` | 15, 24 |
| `/orders` needs a token; POST needs USER | `order-service/server.js` | 11, 13 |
| Token forwarded to book-service | `order-service/server.js` | 19 |
| Owner filter (users see only their orders) | `order-service/server.js` | `GET /orders` at the end |
| Public vs protected routes | `gateway/server.js` | 19, 22-24 |
| Access token kept in memory, attached to calls | `client/src/api.js` | 3, 48 |
| Auto-refresh on 401 | `client/src/api.js` | 52 |
| Refresh 30 s before expiry | `client/src/App.jsx` | 19 |
| Token inspector panel | `client/src/App.jsx` | `TokenPanel` |

`verifyJwt.js` exists as an identical copy in `book-service/`, `order-service/` and `gateway/`. In a real project it would be a shared package.

### How the processes run

Each folder is its own Node process (own `package.json`). They only talk over HTTP on localhost:

- `gateway` → `auth-service`, `book-service`, `order-service` (proxy)
- `order-service` → `book-service` (token forwarded)
- `book-service`, `order-service`, `gateway` → `auth-service` **once**, to fetch the public key (cached afterwards)

The React dev server (Vite) forwards `/api/*` to the gateway (`client/vite.config.js`), so the browser sees one origin and the refresh cookie works.

Settings can be changed with environment variables, but the defaults work as they are: `JWT_ISSUER`, `JWT_AUDIENCE`, `JWKS_URL`, `AUTH_URL`, `BOOK_URL`, `ORDER_URL`.

---

## 5. Test it (curl)

```bash
G=localhost:8080

# login as alice (cookie saved to jar.txt)
curl -s -c jar.txt -X POST $G/api/oauth/token -H 'Content-Type: application/json' \
  -d '{"grant_type":"password","username":"alice","password":"Alice@123"}'
TOKEN=<paste access_token here>
```

| # | Request | Expected |
|---|---|---|
| 1 | `curl -i $G/api/books` | **401** missing_token |
| 2 | `curl -i $G/api/books -H "Authorization: Bearer $TOKEN"` | **200** |
| 3 | `POST /api/books` with alice's token | **403** forbidden |
| 4 | `POST /api/books` with admin's token | **201** |
| 5 | `POST /api/orders` `{"bookId":"<id>","quantity":2}` as alice | **201** (book-service was called with her token) |
| 6 | `GET /api/orders` as alice / as admin | own orders / all orders |
| 7 | change `"USER"` to `"ADMIN"` in the payload, keep the signature | **401** signature verification failed |
| 8 | header `{"alg":"none"}` with empty signature | **401** algorithm not allowed |
| 9 | `curl -i localhost:4001/books` (skip the gateway) | **401** |
| 10 | `curl -b jar.txt -c jar.txt -X POST $G/api/oauth/token -d grant_type=refresh_token` | **200** new token |
| 11 | repeat 10 with the *old* cookie file | **400** invalid_grant |
| 12 | wrong password | **400** invalid_grant |

All of these were run against this code and gave the results above.

> Tip for experiment 7: edit the **payload** (middle part). Do not edit only the very last character of the token: the last Base64 character of an RSA signature contains unused padding bits, so such a change can leave the real signature bytes untouched and the token stays valid.

To see expiry quickly, change `ACCESS_TTL_SECONDS` in `auth-service/server.js` to `60` and watch the countdown in the right-hand panel of the React app.

## 6. Exercises

1. Copy a token into https://jwt.io and name every claim.
2. Open `http://localhost:4000/.well-known/jwks.json`. What is in it, and what is missing (the private key)?
3. Remove `audience` in `verifyJwt.js`. What attack becomes possible?
4. Add a `MANAGER` role that can `DELETE /books/:id`.
5. Restart auth-service: why do all existing tokens stop working? (new key pair, so a new `kid`)
6. Why validate the token in the gateway **and** in the services?

## 7. Limitations (it is a teaching demo)

- `auth-service` is a small hand-written authorization server, not a complete OAuth2 implementation. Production: Keycloak, Auth0, Cognito or Okta.
- The password grant is used for simplicity. Browser apps in production should use **Authorization Code + PKCE**.
- Everything is in memory and runs over HTTP. In production use HTTPS (`NODE_ENV=production` makes the cookie `Secure`), a real database, a managed private key, and key rotation.
=======
# OAuth_and_jwt_tokens
Learn how to secure microservices with OAuth2 and JWT. A small bookstore built with Node.js/Express (auth-service, API gateway, book and order services) and a React client. Shows RS256 token signing, JWKS verification, role-based access, token propagation and refresh rotation. No database, no Docker: just Node 18+ and npm run dev.
>>>>>>> 93af73f3129d717f9f09fbbff06252e11895d662

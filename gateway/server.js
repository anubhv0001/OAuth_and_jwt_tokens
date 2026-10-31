// API GATEWAY: the single public entry point. Rate limit -> security headers -> token check -> route.
// No body parser on purpose: request bodies stream straight through to the services.
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { authenticate } from './verifyJwt.js';

const AUTH_URL = process.env.AUTH_URL || 'http://localhost:4000';
const BOOK_URL = process.env.BOOK_URL || 'http://localhost:4001';
const ORDER_URL = process.env.ORDER_URL || 'http://localhost:4002';
const strip = { '^/api': '' };

const app = express();
app.use(helmet());
app.use(rateLimit({ windowMs: 60_000, limit: 300 }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// PUBLIC routes (no token needed): login, refresh, logout, register
app.use(createProxyMiddleware({ pathFilter: ['/api/oauth', '/api/auth'], target: AUTH_URL, pathRewrite: strip }));

// PROTECTED routes: the JWT must be valid BEFORE the request is forwarded
app.use('/api/books', authenticate);
app.use('/api/orders', authenticate);
app.use(createProxyMiddleware({ pathFilter: '/api/books', target: BOOK_URL, pathRewrite: strip }));
app.use(createProxyMiddleware({ pathFilter: '/api/orders', target: ORDER_URL, pathRewrite: strip }));

app.use((req, res) => res.status(404).json({ error: 'not_found' }));
app.listen(process.env.PORT || 8080, () => console.log('gateway on :8080'));

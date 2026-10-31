// RESOURCE SERVER #2: protected order API. It also CALLS book-service, forwarding the user's token.
import express from 'express';
import crypto from 'crypto';
import { authenticate, requireRole } from './verifyJwt.js';

const BOOK_URL = process.env.BOOK_URL || 'http://localhost:4001';
const orders = [];

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use('/orders', authenticate);

app.post('/orders', requireRole('USER'), async (req, res) => {
  const { bookId } = req.body;
  const qty = Number(req.body.quantity ?? 1);
  if (typeof bookId !== 'string' || !Number.isInteger(qty) || qty < 1 || qty > 10)
    return res.status(400).json({ error: 'invalid_order' });
  try {
    // >>> TOKEN PROPAGATION: same Bearer token goes to book-service, which verifies it again
    const r = await fetch(`${BOOK_URL}/books/${encodeURIComponent(bookId)}`, {
      headers: { Authorization: `Bearer ${req.token}` },
    });
    if (r.status === 404) return res.status(404).json({ error: 'book_not_found' });
    if (!r.ok) return res.status(502).json({ error: 'book_service_error', status: r.status });
    const book = await r.json();
    const order = {                                                // price comes from the server, not the client
      id: crypto.randomUUID(), userId: req.user.id, username: req.user.username, bookId,
      title: book.title, quantity: qty, total: Number((book.price * qty).toFixed(2)), createdAt: new Date().toISOString(),
    };
    orders.unshift(order);
    res.status(201).json(order);
  } catch {
    res.status(502).json({ error: 'book_service_unreachable' });
  }
});

// Users see only their own orders; ADMIN sees all.
app.get('/orders', (req, res) =>
  res.json(req.user.roles.includes('ADMIN') ? orders : orders.filter((o) => o.userId === req.user.id)));

app.listen(process.env.PORT || 4002, () => console.log('order-service on :4002'));

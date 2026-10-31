// RESOURCE SERVER #1: protected book API (in-memory data).
import express from 'express';
import crypto from 'crypto';
import { authenticate, requireRole } from './verifyJwt.js';

const books = [
  { id: crypto.randomUUID(), title: 'Pride and Prejudice', author: 'Jane Austen', price: 9.99 },
  { id: crypto.randomUUID(), title: 'Dracula', author: 'Bram Stoker', price: 7.5 },
  { id: crypto.randomUUID(), title: 'Frankenstein', author: 'Mary Shelley', price: 6.25 },
];

const app = express();
app.use(express.json({ limit: '10kb' }));

app.use('/books', authenticate);                                   // every /books route needs a valid token

app.get('/books', (req, res) => res.json(books));                  // any logged-in user

app.get('/books/:id', (req, res) => {
  const book = books.find((b) => b.id === req.params.id);
  book ? res.json(book) : res.status(404).json({ error: 'not_found' });
});

app.post('/books', requireRole('ADMIN'), (req, res) => {           // ADMIN role only
  const { title, author, price } = req.body;                       // whitelist the fields we accept
  if (typeof title !== 'string' || !title.trim() || title.length > 120 ||
      typeof author !== 'string' || !author.trim() || author.length > 80 ||
      typeof price !== 'number' || !(price >= 0))
    return res.status(400).json({ error: 'validation_failed' });
  const book = { id: crypto.randomUUID(), title: title.trim(), author: author.trim(), price };
  books.push(book);
  res.status(201).json(book);
});

app.listen(process.env.PORT || 4001, () => console.log('book-service on :4001'));

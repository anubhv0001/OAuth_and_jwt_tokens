import { useCallback, useEffect, useState } from 'react';
import { api, decode, login, logout, onToken, refresh, register } from './api.js';

export default function App() {
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);

  // On page load, try to restore the session silently using the refresh cookie.
  useEffect(() => {
    const off = onToken(setToken);
    refresh().catch(() => {}).finally(() => setReady(true));
    return off;
  }, []);

  // Rotate the access token 30 seconds before it expires.
  useEffect(() => {
    const c = token && decode(token);
    if (!c) return;
    const t = setTimeout(() => refresh().catch(() => {}), Math.max(1000, c.exp * 1000 - Date.now() - 30000));
    return () => clearTimeout(t);
  }, [token]);

  if (!ready) return null;
  const claims = token && decode(token);
  return (
    <div className="shell">
      <main>{claims ? <Store claims={claims} /> : <Auth />}</main>
      <TokenPanel token={token} claims={claims} />
    </div>
  );
}

function Auth() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault(); setError(''); setInfo('');
    try {
      if (mode === 'register') { await register(form.username, form.password); setInfo('Account created. Sign in to continue.'); setMode('login'); }
      else await login(form.username, form.password);
    } catch (x) { setError(x.message); }
  }

  return (
    <section className="auth">
      <h1>Bookstore</h1>
      <p className="lede">Sign in to receive a JWT and watch it work in the panel on the right.</p>
      <form onSubmit={submit}>
        <label>Username<input value={form.username} onChange={set('username')} autoComplete="username" required /></label>
        <label>Password<input type="password" value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        {info && <p className="ok">{info}</p>}
        <button className="primary">{mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'Create an account' : 'I already have an account'}
      </button>
      <p className="hint">Demo users: alice / Alice@123 (USER) and admin / Admin@123 (ADMIN).</p>
    </section>
  );
}

function Store({ claims }) {
  const [books, setBooks] = useState([]);
  const [orders, setOrders] = useState([]);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try { setBooks(await api('/books')); setOrders(await api('/orders')); }
    catch (e) { setMsg({ bad: true, text: `${e.status || ''} ${e.message}` }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function order(id) {
    try { await api('/orders', { method: 'POST', body: { bookId: id, quantity: 1 } }); setMsg({ text: 'Order placed' }); load(); }
    catch (e) { setMsg({ bad: true, text: `${e.status} ${e.message}` }); }
  }
  async function addBook(e) {
    e.preventDefault();
    const form = e.target;
    const d = Object.fromEntries(new FormData(form));
    try { await api('/books', { method: 'POST', body: { ...d, price: Number(d.price) } }); form.reset(); setMsg({ text: 'Book added' }); load(); }
    catch (x) { setMsg({ bad: true, text: `${x.status} ${x.message}` }); }
  }

  return (
    <>
      <header className="bar">
        <h1>Bookstore</h1>
        <span>{claims.username}</span>
        <button className="link" onClick={logout}>Sign out</button>
      </header>
      {msg && <p className={msg.bad ? 'error' : 'ok'} role="status">{msg.text}</p>}

      <h2>Books</h2>
      <ul className="rows">
        {books.map((b) => (
          <li key={b.id}>
            <div><strong>{b.title}</strong><span>{b.author}</span></div>
            <em>${b.price.toFixed(2)}</em>
            <button className="primary" onClick={() => order(b.id)}>Order</button>
          </li>
        ))}
      </ul>

      <h2>Add a book</h2>
      <p className="hint">Requires the ADMIN role. Try it as alice to see a 403.</p>
      <form className="inline" onSubmit={addBook}>
        <input name="title" placeholder="Title" required />
        <input name="author" placeholder="Author" required />
        <input name="price" type="number" step="0.01" min="0" placeholder="Price" required />
        <button className="primary">Add book</button>
      </form>

      <h2>{claims.roles.includes('ADMIN') ? 'All orders' : 'Your orders'}</h2>
      {orders.length === 0 ? <p className="hint">No orders yet. Order a book above.</p> : (
        <ul className="rows">
          {orders.map((o) => (
            <li key={o.id}>
              <div><strong>{o.title}</strong><span>{o.username} · qty {o.quantity}</span></div>
              <em>${o.total.toFixed(2)}</em>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TokenPanel({ token, claims }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const header = token && JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
  return (
    <aside className="tokens">
      <h2>Access token</h2>
      {!claims ? <p className="dim">No token yet. Sign in and the decoded JWT appears here.</p> : (
        <>
          <p className="ttl">Expires in {Math.max(0, claims.exp - Math.floor(now / 1000))}s</p>
          <h3>Header</h3><pre>{JSON.stringify(header, null, 2)}</pre>
          <h3>Payload</h3><pre>{JSON.stringify(claims, null, 2)}</pre>
          <h3>Signature</h3><pre>{token.split('.')[2].slice(0, 36)}…</pre>
          <p className="dim">Held in memory only. The refresh token is an httpOnly cookie that this page cannot read.</p>
        </>
      )}
    </aside>
  );
}

'use strict';
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const crypto = require('node:crypto');
const app = express();
const seed = require('./data.json');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const portIndex = process.argv.indexOf('--port');
const PORT = Number(process.env.PORT || (portIndex >= 0 ? process.argv[portIndex + 1] : 3000));
const tiers = ['', 'Elite', 'Platinum', 'Gold', 'Silver', 'Bronze'];
const digest = value => crypto.createHash('sha256').update(value).digest();
const attempts = new Map();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
  next();
});
// Same-origin by default; explicitly configure PUBLIC_ORIGIN for a separate frontend.
app.use(cors({ origin: process.env.PUBLIC_ORIGIN || false, allowedHeaders: ['Content-Type', 'x-admin-password'] }));
app.use('/api', (req, res, next) => {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !PASSWORD) {
    return res.status(503).json({ error: 'Setup incomplete: add SUPABASE_URL, SUPABASE_SECRET_KEY and ADMIN_PASSWORD in the hosting environment, then redeploy.' });
  }
  next();
});
function authorize(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  let entry = attempts.get(key);
  if (!entry || now > entry.until) entry = { count: 0, until: now + 15 * 60 * 1000 };
  if (entry.count >= 20) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (!crypto.timingSafeEqual(digest(req.get('x-admin-password') || ''), digest(PASSWORD))) {
    entry.count += 1;
    attempts.set(key, entry);
    return res.status(401).json({ error: 'Incorrect admin password.' });
  }
  attempts.delete(key);
  next();
}
setInterval(() => {
  for (const [key, entry] of attempts) if (Date.now() > entry.until) attempts.delete(key);
}, 60000).unref();
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.post('/api/login', authorize, (req, res) => res.json({ ok: true }));
const fail = message => { const error = new Error(message); error.status = 400; throw error; };
function string(value, label, max = 80) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label} must contain 1–${max} characters.`);
  return value.trim();
}
function number(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) fail(`${label} must be a whole number from 0 to 1,000,000.`);
  return value;
}
function picture(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 200000) fail('Each picture must be smaller than 200 KB. Use the upload compressor.');
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch {}
  fail('Picture must be an HTTP(S) image URL or PNG, JPEG or WebP data URL.');
}
function validate(input) {
  if (!input || !Array.isArray(input.clubs) || !Array.isArray(input.players)) fail('Clubs and players arrays are required.');
  if (input.clubs.length > 100 || input.players.length > 1000) fail('Maximum 100 clubs and 1,000 players.');
  const ids = new Set(), names = new Set();
  function id(value) {
    const result = string(value, 'ID');
    if (!/^[a-zA-Z0-9_-]+$/.test(result) || ids.has(result)) fail('IDs must be unique letters, numbers, underscores or hyphens.');
    ids.add(result); return result;
  }
  const clubs = input.clubs.map(c => {
    if (!c || typeof c !== 'object') fail('Invalid club.');
    const name = string(c.name, 'Club name');
    if (name.toLowerCase() === 'no club' || names.has(name.toLowerCase())) fail('Club names must be unique and cannot be No Club.');
    names.add(name.toLowerCase());
    const club = { id: id(c.id), name, mp: number(c.mp, 'MP'), mw: number(c.mw, 'MW'), ml: number(c.ml, 'ML'), pfp: picture(c.pfp) };
    if (club.mw + club.ml > club.mp) fail(`${name}: wins plus losses cannot exceed matches played.`);
    return club;
  });
  const players = input.players.map(p => {
    if (!p || typeof p !== 'object') fail('Invalid player.');
    const club = string(p.club, 'Player club');
    if (club !== 'No Club' && !clubs.some(c => c.name === club)) fail('Select an existing club or No Club for every player.');
    if (!tiers.includes(p.tierOverride || '')) fail('Invalid tier override.');
    return { id: id(p.id), name: string(p.name, 'Player name'), club, goals: number(p.goals, 'Goals'), assist: number(p.assist, 'Assists'), tw: number(p.tw, 'TW'), gs: number(p.gs, 'GS'), pfp: picture(p.pfp), tierOverride: p.tierOverride || '' };
  });
  return { clubs, players };
}
// The database performs the revision comparison atomically across server instances.
async function database(query, options = {}) {
  const headers = { apikey: SUPABASE_SECRET_KEY, 'Content-Type': 'application/json', ...options.headers };
  if (!SUPABASE_SECRET_KEY.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;
  }
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/community_data${query}`, {
      ...options, headers, signal: AbortSignal.timeout(15000)
    });
  } catch {
    const error = new Error('Cannot reach the database. Check Supabase project status and SUPABASE_URL.');
    error.status = 503; throw error;
  }
  if (!response.ok) {
    console.error('Database request failed, HTTP', response.status);
    const error = new Error('Database connection failed. Check the table, Data API access and server secret key.');
    error.status = 503; throw error;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}
async function read() {
  let rows = await database('?id=eq.main&select=document');
  if (!rows.length) {
    const initial = { revision: 0, ...validate(seed) };
    await database('?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ id: 'main', document: initial })
    });
    rows = await database('?id=eq.main&select=document');
  }
  if (!rows.length || !Number.isSafeInteger(rows[0].document?.revision)) {
    const error = new Error('Database data is missing or invalid.');
    error.status = 503; throw error;
  }
  return rows[0].document;
}
app.get('/api/data', async (req, res, next) => {
  try { res.json(await read()); } catch (error) { next(error); }
});
app.post('/api/data', authorize, express.json({ limit: '4mb' }), async (req, res, next) => {
  try {
    const clean = validate(req.body);
    const revision = req.body.revision;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
      fail('Invalid revision. Reload the dashboard.');
    }
    const saved = { revision: revision + 1, ...clean };
    const rows = await database(`?id=eq.main&document->>revision=eq.${revision}&select=document`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ document: saved, updated_at: new Date().toISOString() })
    });
    if (!rows.length) {
      const error = new Error('Another admin saved changes. Reload the latest data before editing again.');
      error.status = 409; throw error;
    }
    res.json(rows[0].document);
  } catch (error) { next(error); }
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny' }));
app.use((error, req, res, next) => {
  const status = error.status || 500;
  if (status === 500) console.error(error);
  res.status(status).json({ error: status === 413 ? 'Request too large. Keep the dataset below 4 MB (Vercel upload limit).' : status === 500 ? 'Server could not read or save data. Please try again.' : error.message });
});
if (require.main === module && !process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Deportivo de Jauhar running at http://localhost:${PORT}`));
}
module.exports = app;

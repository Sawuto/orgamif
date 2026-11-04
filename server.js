const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
// Variables posées par l'intégration Upstash/Vercel, avec ou sans préfixe (ex. SACCONE_KV_REST_API_URL)
const pick = re => { const k = Object.keys(process.env).find(n => re.test(n)); return k ? process.env[k] : undefined; };
const U = pick(/(^|_)(UPSTASH_REDIS_REST_URL|KV_REST_API_URL)$/), T = pick(/(^|_)(UPSTASH_REDIS_REST_TOKEN|KV_REST_API_TOKEN)$/); // stockage optionnel (Vercel)
const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const uid = () => crypto.randomBytes(4).toString('hex');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const tm = s => { const p = String(s).split(':'); return +p[0] * 60 + (+p[1] || 0); };
const okT = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const okPin = p => /^\d{4}$/.test(p);
const DEF = () => ({
  members: [['Maman', '#c2410c'], ['Papa', '#1d4ed8'], ['Léa', '#a21caf'], ['Tom', '#15803d']].map(([name, color]) => ({ id: uid(), name, color })),
  events: [], tasks: [], shop: [], links: [], sessions: {},
  tpl: [{ id: 't1', t: 'Réveil', s: '07:00', e: '07:15', r: 'wk', k: 'Activité' }, { id: 't2', t: 'Bus', s: '07:30', e: '08:00', r: 'wk', k: 'Activité' }]
});
let db;
async function rd(cmd) { const r = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: JSON.stringify(cmd) }); return (await r.json()).result; }
async function load() {
  if (U) { const v = await rd(['GET', 'maison']); return v ? JSON.parse(v) : DEF(); }
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return DEF(); }
}
async function save() {
  if (U) return void await rd(['SET', 'maison', JSON.stringify(db)]);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE);
}
const hashPin = (pin, salt = crypto.randomBytes(8).toString('hex')) => ({ salt, hash: crypto.scryptSync(pin, salt, 32).toString('hex') });
const chk = (pin, p) => crypto.timingSafeEqual(Buffer.from(hashPin(pin, p.salt).hash), Buffer.from(p.hash));
const mem = id => db.members.find(m => m.id === id);
const fails = {};
async function session(id) { const tk = crypto.randomBytes(24).toString('hex'); db.sessions[sha(tk)] = id; await save(); return { token: tk, id }; }
const pub = m => ({ id: m.id, name: m.name, color: m.color, hasPin: !!m.pin });

// Ajout (avec répétition) + contrôle de chevauchement pour une même personne
function addRep(m, d, s, e, t, k, r) {
  const ds = { wk: [0, 1, 2, 3, 4], we: [5, 6], all: [0, 1, 2, 3, 4, 5, 6] }[r] || [d];
  if (tm(e) <= tm(s)) return 'L’heure de fin doit être après l’heure de début.';
  const bad = [];
  ds.forEach(x => db.events.forEach(o => { if (o.m === m && o.d === x && tm(s) < tm(o.e) && tm(o.s) < tm(e)) bad.push(o); }));
  if (bad.length) { const b = bad[0]; return `Conflit : ${mem(m).name} a déjà « ${b.t} » le ${DAYS[b.d]} de ${b.s} à ${b.e}` + (bad.length > 1 ? `, et ${bad.length - 1} autre(s) conflit(s)` : '') + '. Rien n’a été ajouté.'; }
  const g = ds.length > 1 ? uid() : undefined;
  ds.forEach(x => db.events.push({ id: uid(), m, d: x, s, e, t, k, ...(g && { g }) }));
  return '';
}
const evBody = b => {
  const t = String(b.t || '').trim().slice(0, 80), d = Number(b.d), r = b.r || 'one';
  if (!t) return { error: 'Donnez un titre à l’événement.' };
  if (!mem(b.m)) return { error: 'Personne inconnue.' };
  if (!(d >= 0 && d <= 6) || !okT(b.s) || !okT(b.e) || !['one', 'wk', 'we', 'all'].includes(r)) return { error: 'Données invalides.' };
  return { m: b.m, d, s: b.s, e: b.e, t, k: ['Activité', 'Réunion', 'Cours'].includes(b.k) ? b.k : 'Activité', r };
};

const app = express();
app.use(express.json({ limit: '200kb' }));
// Profil créé une seule fois au premier démarrage (changez le PIN après connexion, onglet Membres)
const SEED = { name: 'Enzo', color: '#2f6b5a', pin: { salt: '0fc9a081ea144eb6', hash: 'c6a9433818c75a5c55da19e549667410ea7216ac3a0732672477578e240a5e03' } };
async function seed() {
  if (db.seeded) return;
  db.seeded = true;
  if (!db.members.some(m => m.name === SEED.name)) db.members.push({ id: uid(), name: SEED.name, color: SEED.color, pin: SEED.pin });
  await save();
}
// Diagnostic : /api/health indique si la base est bien détectée et joignable
app.get('/api/health', async (q, s) => {
  const o = { stockage: U ? 'upstash' : 'fichier local', vercel: !!process.env.VERCEL, urlDetectee: !!U, jetonDetecte: !!T };
  if (U) { try { o.redis = await rd(['PING']); } catch (e) { o.redis = 'erreur : ' + e.message; } }
  s.json(o);
});
app.use('/api', (q, s, n) => process.env.VERCEL && !U
  ? s.status(503).json({ error: 'Base de données non connectée : les variables KV_REST_API_URL et KV_REST_API_TOKEN sont introuvables sur ce déploiement. Ajoutez-les (Production), puis redéployez.' })
  : n());
app.use('/api', async (q, s, n) => { db = U ? await load() : (db || await load()); await seed(); n(); });
const A = (q, s, n) => {
  const m = mem(db.sessions[sha((q.headers.authorization || '').replace('Bearer ', ''))]);
  if (!m) return s.status(401).json({ error: 'Session expirée.', auth: true });
  q.me = m; n();
};
const bad = (s, error, code = 400) => s.status(code).json({ error });

app.get('/api/members', (q, s) => s.json(db.members.map(pub)));
app.post('/api/login', async (q, s) => {
  const m = mem(q.body.memberId);
  if (!m || !m.pin) return bad(s, 'Profil inconnu ou sans PIN.');
  const f = fails[m.id] || (fails[m.id] = { n: 0, until: 0 });
  if (Date.now() < f.until) return bad(s, 'Trop d’essais. Patientez 30 secondes.', 429);
  if (!chk(String(q.body.pin || ''), m.pin)) { if (++f.n >= 3) { f.until = Date.now() + 30000; f.n = 0; } return bad(s, 'Code incorrect.', 401); }
  f.n = 0; s.json(await session(m.id));
});
app.post('/api/pin/setup', async (q, s) => {
  const m = mem(q.body.memberId);
  if (!m || m.pin) return bad(s, 'Ce profil a déjà un PIN.');
  if (!okPin(String(q.body.pin))) return bad(s, 'Le code doit contenir 4 chiffres.');
  m.pin = hashPin(String(q.body.pin)); s.json(await session(m.id));
});
app.post('/api/pin/change', A, async (q, s) => {
  const m = q.me, f = fails[m.id] || (fails[m.id] = { n: 0, until: 0 });
  if (Date.now() < f.until) return bad(s, 'Trop d’essais. Patientez 30 secondes.', 429);
  if (!chk(String(q.body.oldPin || ''), m.pin)) { if (++f.n >= 3) { f.until = Date.now() + 30000; f.n = 0; } return bad(s, 'Ancien code incorrect.', 401); }
  if (!okPin(String(q.body.newPin))) return bad(s, 'Le nouveau code doit contenir 4 chiffres.');
  f.n = 0; m.pin = hashPin(String(q.body.newPin));
  const keep = sha(q.headers.authorization.replace('Bearer ', ''));
  Object.keys(db.sessions).forEach(k => { if (db.sessions[k] === m.id && k !== keep) delete db.sessions[k]; }); // déconnecte les autres appareils
  await save(); s.json({});
});
app.post('/api/logout', A, async (q, s) => { delete db.sessions[sha(q.headers.authorization.replace('Bearer ', ''))]; await save(); s.json({}); });
app.get('/api/me', A, (q, s) => s.json({ id: q.me.id }));
app.get('/api/state', A, (q, s) => { const { events, tasks, shop, links, tpl } = db; s.json({ members: db.members.map(pub), events, tasks, shop, links, tpl }); });

// membres
app.post('/api/members', async (q, s, n) => (db.members.length ? A(q, s, n) : n()), async (q, s) => {
  const name = String(q.body.name || '').trim().slice(0, 40);
  if (!name) return bad(s, 'Prénom requis.');
  const m = { id: uid(), name, color: /^#[0-9a-f]{6}$/i.test(q.body.color) ? q.body.color : '#0e7490' };
  db.members.push(m); await save(); s.json(pub(m));
});
app.delete('/api/members/:id', A, async (q, s) => {
  const id = q.params.id;
  db.members = db.members.filter(m => m.id !== id);
  db.events = db.events.filter(e => e.m !== id); db.tasks = db.tasks.filter(t => t.m !== id);
  Object.keys(db.sessions).forEach(k => { if (db.sessions[k] === id) delete db.sessions[k]; });
  await save(); s.json({});
});
app.post('/api/members/:id/reset-pin', A, async (q, s) => {
  const m = mem(q.params.id); if (!m) return bad(s, 'Inconnu.', 404);
  delete m.pin; Object.keys(db.sessions).forEach(k => { if (db.sessions[k] === m.id) delete db.sessions[k]; });
  await save(); s.json({});
});

// événements
app.post('/api/events', A, async (q, s) => {
  const b = evBody(q.body); if (b.error) return bad(s, b.error);
  const err = addRep(b.m, b.d, b.s, b.e, b.t, b.k, b.r); if (err) return bad(s, err, 409);
  await save(); s.json({});
});
app.delete('/api/events/:id', A, async (q, s) => { db.events = db.events.filter(e => e.id !== q.params.id); await save(); s.json({}); });
app.delete('/api/series/:g', A, async (q, s) => { db.events = db.events.filter(e => e.g !== q.params.g); await save(); s.json({}); });
app.post('/api/events/import', A, async (q, s) => {
  const m = q.body.m, list = Array.isArray(q.body.events) ? q.body.events.slice(0, 500) : [];
  if (!mem(m)) return bad(s, 'Personne inconnue.');
  db.events = db.events.filter(e => !(e.src === 'ics' && e.m === m));
  let n = 0, cf = 0;
  list.forEach(x => {
    if (!(x.d >= 0 && x.d <= 6) || !okT(x.s) || !okT(x.e)) return;
    const o = { id: uid(), m, d: x.d, s: x.s, e: x.e, t: String(x.t || 'Sans titre').slice(0, 120), k: 'Cours', src: 'ics' };
    if (db.events.some(b => b.src !== 'ics' && b.m === m && b.d === o.d && tm(o.s) < tm(b.e) && tm(b.s) < tm(o.e))) cf++;
    db.events.push(o); n++;
  });
  await save(); s.json({ n, cf });
});

// raccourcis
app.post('/api/tpl', A, async (q, s) => {
  const b = evBody({ ...q.body, m: q.me.id }); if (b.error) return bad(s, b.error);
  if (tm(b.e) <= tm(b.s)) return bad(s, 'L’heure de fin doit être après l’heure de début.');
  db.tpl.push({ id: uid(), t: b.t, s: b.s, e: b.e, r: b.r, k: b.k }); await save(); s.json({});
});
app.delete('/api/tpl/:id', A, async (q, s) => { db.tpl = db.tpl.filter(t => t.id !== q.params.id); await save(); s.json({}); });
app.post('/api/tpl/:id/apply', A, async (q, s) => {
  const t = db.tpl.find(x => x.id === q.params.id); if (!t) return bad(s, 'Raccourci inconnu.', 404);
  if (!mem(q.body.m)) return bad(s, 'Personne inconnue.');
  const err = addRep(q.body.m, Number(q.body.d) || 0, t.s, t.e, t.t, t.k, t.r); if (err) return bad(s, err, 409);
  await save(); s.json({});
});

// tâches, courses, liens
const list = (name, mk) => {
  app.post('/api/' + name, A, async (q, s) => { const o = mk(q.body, q.me); if (!o) return bad(s, 'Données invalides.'); db[name].push({ id: uid(), ...o }); await save(); s.json({}); });
  app.patch('/api/' + name + '/:id', A, async (q, s) => { db[name].forEach(x => { if (x.id === q.params.id) x.x = !!q.body.x; }); await save(); s.json({}); });
  app.delete('/api/' + name + '/:id', A, async (q, s) => { db[name] = db[name].filter(x => x.id !== q.params.id); await save(); s.json({}); });
};
const txt = (v, n = 120) => String(v || '').trim().slice(0, n);
list('tasks', b => txt(b.t) && mem(b.m) ? { t: txt(b.t), m: b.m, x: false } : null);
list('shop', b => txt(b.t) ? { t: txt(b.t), x: false } : null);
list('links', b => {
  let u = txt(b.u, 500); if (!txt(b.t) || !u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { new URL(u); } catch { return null; }
  return { t: txt(b.t), u, i: txt(b.i, 80), k: txt(b.k, 30) || 'Lien' };
});
app.delete('/api/shop-checked', A, async (q, s) => { db.shop = db.shop.filter(x => !x.x); await save(); s.json({}); });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (q, s) => bad(s, 'Introuvable.', 404));
module.exports = app;
if (require.main === module) { const P = process.env.PORT || 3000; app.listen(P, () => console.log('Notre maison : http://localhost:' + P)); }
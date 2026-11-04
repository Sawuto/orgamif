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
const mondayOf = x => { if (!/^\d{4}-\d\d-\d\d$/.test(String(x))) return null; const d = new Date(x + 'T00:00:00Z'); if (isNaN(d)) return null; d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); };
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
const nm = id => (mem(id) || { name: '?' }).name;
const eur = c => (c / 100).toFixed(2).replace('.', ',') + ' €';
const log = (q, t) => { (db.logs = db.logs || []).push({ id: uid(), at: new Date().toISOString(), by: q.me.id, n: q.me.name, t }); if (db.logs.length > 300) db.logs = db.logs.slice(-300); };
const pub = m => ({ id: m.id, name: m.name, color: m.color, hasPin: !!m.pin, admin: !!m.admin });

// Ajout (avec répétition) + contrôle de chevauchement pour une même personne
function addRep(ms, d, s, e, t, k, r, w, by, mode, ok, j) {
  const ds = { wk: [0, 1, 2, 3, 4], we: [5, 6], all: [0, 1, 2, 3, 4, 5, 6] }[r] || [d];
  if (tm(e) <= tm(s)) return 'L’heure de fin doit être après l’heure de début.';
  const conf = [];
  if (!j) ms.forEach(m => ds.forEach(x => db.events.forEach(o => { if (o.m === m && !o.j && o.d === x && (!o.w || !w || o.w === w) && !(o.ex && w && o.ex.includes(w)) && tm(s) < tm(o.e) && tm(o.s) < tm(e) && !conf.includes(o)) conf.push(o); })));
  if (conf.length && !mode) return { conflicts: conf.slice(0, 20).map(o => ({ id: o.id, who: mem(o.m).name, t: o.t, d: DAYS[o.d], s: o.s, e: o.e, rm: ok(o) })), total: conf.length };
  if (conf.length && mode === 'new') {
    if (conf.some(o => !ok(o))) return 'Vous ne pouvez pas remplacer un événement qui appartient à quelqu’un d’autre : choisissez « Garder les deux ».';
    db.events = db.events.filter(o => !conf.includes(o));
  }
  ms.forEach(m => { const g = ds.length > 1 ? uid() : undefined; ds.forEach(x => db.events.push({ id: uid(), m, d: x, s, e, t, k, ...(j && { j: true }), ...(w && { w }), ...(by && { o: by }), ...(g && { g }) })); });
  return '';
}
const confRes = (s, r) => typeof r === 'string' ? bad(s, r, 409) : s.status(409).json({ error: 'Deux événements se chevauchent.', conflicts: r.conflicts, total: r.total });
const evBody = b => {
  const t = String(b.t || '').trim().slice(0, 80), d = Number(b.d), r = b.r || 'one';
  if (!t) return { error: 'Donnez un titre à l’événement.' };
  const ms = [...new Set(Array.isArray(b.ms) && b.ms.length ? b.ms : [b.m])].filter(Boolean);
  if (!ms.length) return { error: 'Choisissez au moins une personne.' };
  if (!ms.every(x => mem(x))) return { error: 'Personne inconnue.' };
  const j = !!b.j;
  if (!(d >= 0 && d <= 6) || (!j && (!okT(b.s) || !okT(b.e))) || !['one', 'wk', 'we', 'all'].includes(r)) return { error: 'Données invalides.' };
  const w = b.rec ? undefined : mondayOf(b.w); if (!b.rec && !w) return { error: 'Semaine invalide.' };
  return { m: ms[0], ms, d, s: j ? '00:00' : b.s, e: j ? '23:59' : b.e, j, t, k: ['Activité', 'Réunion', 'Cours'].includes(b.k) ? b.k : 'Activité', r, w };
};

const app = express();
app.use(express.json({ limit: '3mb' }));
// Profil créé une seule fois au premier démarrage (changez le PIN après connexion, onglet Membres)
const SEED = { name: 'Enzo', color: '#2f6b5a', pin: { salt: '0fc9a081ea144eb6', hash: 'c6a9433818c75a5c55da19e549667410ea7216ac3a0732672477578e240a5e03' } };
async function seed() {
  let ch = false;
  if (!db.seeded) {
    db.seeded = true; ch = true;
    if (!db.members.some(m => m.name === SEED.name)) db.members.push({ id: uid(), name: SEED.name, color: SEED.color, pin: SEED.pin });
  }
  const a = db.members.find(m => m.name === SEED.name); // Enzo = administrateur
  if (a && !a.admin) { a.admin = true; ch = true; }
  if (ch) await save();
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
app.use('/api', async (q, s, n) => { db = U ? await load() : (db || await load()); await seed(); ['rem', 'exp', 'pay', 'logs'].forEach(k => { db[k] = db[k] || []; }); n(); });
const A = (q, s, n) => {
  const m = mem(db.sessions[sha((q.headers.authorization || '').replace('Bearer ', ''))]);
  if (!m) return s.status(401).json({ error: 'Session expirée.', auth: true });
  q.me = m; n();
};
const bad = (s, error, code = 400) => s.status(code).json({ error });
// Droit de supprimer : l'administrateur, ou la personne concernée (propriétaire / créateur). Sans propriétaire connu (anciennes données) : tout le monde.
const can = (q, ...ids) => { ids = ids.filter(Boolean); return !!q.me.admin || !ids.length || ids.includes(q.me.id); };
const forbid = s => bad(s, 'Vous ne pouvez pas supprimer ce qui appartient à quelqu’un d’autre.', 403);

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
app.get('/api/state', A, (q, s) => { const { events, tasks, shop, links, tpl } = db; s.json({ members: db.members.map(pub), events, tasks, shop, links, tpl, wake: db.wake || {}, days: db.days || {}, rem: db.rem, exp: db.exp, pay: db.pay, logs: db.logs.slice(-150), ics: Object.fromEntries(Object.keys(db.icsUrls || {}).map(k => [k, true])) }); });

// membres
app.post('/api/members', async (q, s, n) => (db.members.length ? A(q, s, n) : n()), async (q, s) => {
  const name = String(q.body.name || '').trim().slice(0, 40);
  if (!name) return bad(s, 'Prénom requis.');
  if (db.members.some(m => m.name.toLowerCase() === name.toLowerCase())) return bad(s, 'Ce prénom existe déjà.');
  const m = { id: uid(), name, color: /^#[0-9a-f]{6}$/i.test(q.body.color) ? q.body.color : '#0e7490' };
  db.members.push(m); await save(); s.json(pub(m));
});
app.delete('/api/members/:id', A, async (q, s) => {
  const id = q.params.id, t = mem(id);
  if (!t) return bad(s, 'Inconnu.', 404);
  if (t.admin) return bad(s, 'Le compte administrateur ne peut pas être supprimé.', 403);
  if (!q.me.admin && q.me.id !== id) return bad(s, 'Seul l’administrateur peut supprimer un autre membre.', 403);
  db.members = db.members.filter(m => m.id !== id); if (db.icsUrls) delete db.icsUrls[id];
  db.events = db.events.filter(e => e.m !== id); db.tasks = db.tasks.filter(t => t.m !== id);
  db.exp = db.exp.filter(x => x.p !== id).map(x => ({ ...x, sh: x.sh.filter(i => i !== id) })).filter(x => x.sh.length); db.pay = db.pay.filter(x => x.from !== id && x.to !== id); db.rem = db.rem.filter(x => x.o !== id);
  if (db.wake) delete db.wake[id]; Object.values(db.days || {}).forEach(d => { delete d[id]; });
  Object.keys(db.sessions).forEach(k => { if (db.sessions[k] === id) delete db.sessions[k]; });
  await save(); s.json({});
});
app.post('/api/members/:id/reset-pin', A, async (q, s) => {
  const m = mem(q.params.id); if (!m) return bad(s, 'Inconnu.', 404);
  if (!q.me.admin && q.me.id !== m.id) return bad(s, 'Seul l’administrateur peut réinitialiser le PIN d’un autre membre.', 403);
  delete m.pin; Object.keys(db.sessions).forEach(k => { if (db.sessions[k] === m.id) delete db.sessions[k]; });
  await save(); s.json({});
});

// événements
app.post('/api/events', A, async (q, s) => {
  const b = evBody(q.body); if (b.error) return bad(s, b.error);
  const err = addRep(b.ms, b.d, b.s, b.e, b.t, b.k, b.r, b.w, q.me.id, ['both', 'new'].includes(q.body.mode) ? q.body.mode : undefined, o => can(q, o.m, o.o), b.j); if (err) return confRes(s, err);
  log(q, 'Événement ajouté : ' + b.t + ' (' + b.ms.map(nm).join(', ') + ', ' + (b.j ? 'toute la journée' : b.s + '–' + b.e) + ')');
  await save(); s.json({});
});
// modification d'un événement existant (un seul créneau ; un événement « chaque semaine » est modifié pour toutes les semaines)
app.patch('/api/events/:id', A, async (q, s) => {
  const e = db.events.find(x => x.id === q.params.id); if (!e) return bad(s, 'Événement introuvable.', 404);
  if (!can(q, e.m, e.o)) return bad(s, 'Vous ne pouvez pas modifier ce qui appartient à quelqu’un d’autre.', 403);
  const b = evBody({ ...q.body, m: e.m, ms: [e.m], r: 'one', rec: !e.w, w: e.w }); if (b.error) return bad(s, b.error);
  if (tm(b.e) <= tm(b.s)) return bad(s, 'L’heure de fin doit être après l’heure de début.');
  const conf = [];
  if (!b.j) db.events.forEach(o => { if (o !== e && o.m === e.m && !o.j && o.d === b.d && (!o.w || !e.w || o.w === e.w) && !(o.ex && e.w && o.ex.includes(e.w)) && tm(b.s) < tm(o.e) && tm(o.s) < tm(b.e)) conf.push(o); });
  const mode = ['both', 'new'].includes(q.body.mode) ? q.body.mode : undefined;
  if (conf.length && !mode) return s.status(409).json({ error: 'Deux événements se chevauchent.', conflicts: conf.slice(0, 20).map(o => ({ id: o.id, who: nm(o.m), t: o.t, d: DAYS[o.d], s: o.s, e: o.e, rm: can(q, o.m, o.o) })), total: conf.length });
  if (conf.length && mode === 'new') {
    if (conf.some(o => !can(q, o.m, o.o))) return bad(s, 'Vous ne pouvez pas remplacer un événement qui appartient à quelqu’un d’autre : choisissez « Garder les deux ».', 409);
    db.events = db.events.filter(o => !conf.includes(o));
  }
  const av = e.t + ' ' + (e.j ? 'toute la journée' : e.s + '–' + e.e) + ' ' + DAYS[e.d];
  Object.assign(e, { t: b.t, k: b.k, d: b.d, s: b.s, e: b.e }); if (b.j) e.j = true; else delete e.j;
  log(q, 'Événement modifié : ' + av + ' → ' + e.t + ' ' + (e.j ? 'toute la journée' : e.s + '–' + e.e) + ' ' + DAYS[e.d] + ' (' + nm(e.m) + ')');
  await save(); s.json({});
});
app.delete('/api/events/:id', A, async (q, s) => {
  const e = db.events.find(x => x.id === q.params.id); if (!e) return s.json({});
  if (!can(q, e.m, e.o)) return forbid(s);
  const wk = mondayOf(q.query.w); // « seulement cette semaine » : un événement hebdomadaire reçoit une exception
  const one = q.query.only && !e.w && wk;
  if (one) e.ex = [...new Set([...(e.ex || []), wk])].slice(-300);
  else db.events = db.events.filter(x => x !== e);
  log(q, (one ? 'Créneau supprimé (semaine du ' + wk + ') : ' : 'Événement supprimé : ') + e.t + ' (' + nm(e.m) + ', ' + DAYS[e.d] + ')');
  await save(); s.json({});
});
app.delete('/api/series/:g', A, async (q, s) => {
  if (db.events.some(e => e.g === q.params.g && !can(q, e.m, e.o))) return forbid(s);
  const f0 = db.events.find(e => e.g === q.params.g); if (f0) log(q, 'Série supprimée : ' + f0.t + ' (' + nm(f0.m) + ')');
  db.events = db.events.filter(e => e.g !== q.params.g); await save(); s.json({});
});
// ICS-BEGIN
const PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const parisParts = d => { const o = {}; PARIS.formatToParts(d).forEach(p => { o[p.type] = p.value; }); return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute }; };
function icsDate(x) { // heures en UTC (Z) converties en heure de Paris ; heures sans fuseau lues telles quelles
  const m = String(x).match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/); if (!m) return null;
  if (!m[4]) return { timed: false };
  const p = m[7] ? parisParts(new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6] || 0))) : { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
  return { timed: true, ...p };
}
const hhmm = (h, mi) => String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
function parseIcsServer(txt) {
  txt = txt.replace(/\r?\n[ \t]/g, '');
  const out = [];
  txt.split('BEGIN:VEVENT').slice(1).forEach(b => {
    const ls = b.split('END:VEVENT')[0].split(/\r?\n/);
    const g = n => { for (const l of ls) { const c = l.charAt(n.length); if (l.indexOf(n) === 0 && (c === ':' || c === ';')) return l.slice(l.indexOf(':') + 1).trim(); } return ''; };
    if (/CANCELLED/i.test(g('STATUS'))) return;
    const a = icsDate(g('DTSTART')), z = icsDate(g('DTEND')) || a;
    if (!a || !a.timed || !z.timed) return;
    const day = new Date(Date.UTC(a.y, a.mo - 1, a.d)), d = (day.getUTCDay() + 6) % 7;
    const w = new Date(day.getTime() - d * 864e5).toISOString().slice(0, 10);
    const s = hhmm(a.h, a.mi), e = z.y === a.y && z.mo === a.mo && z.d === a.d ? hhmm(z.h, z.mi) : '23:59';
    if (tm(e) <= tm(s)) return;
    const title = g('SUMMARY').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s*\[[^\]]*\]\s*$/, '') || 'Sans titre';
    const loc = g('LOCATION').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
    out.push({ w, d, s, e, t: (title + (loc ? ' (' + loc + ')' : '')).slice(0, 120) });
  });
  return out;
}
async function fetchIcs(raw) {
  const u = String(raw || '').trim().replace(/^webcals?:/i, 'https:');
  let url; try { url = new URL(u); } catch { throw new Error('Adresse invalide.'); }
  if (!/^https?:$/.test(url.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i.test(url.hostname) || /\.local$/i.test(url.hostname)) throw new Error('Adresse non autorisée.');
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), 8000);
  let r;
  try { r = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'User-Agent': 'NotreMaison/1.0', Accept: 'text/calendar,*/*' } }); }
  catch { throw new Error('Impossible de joindre ce lien (délai dépassé ou adresse inaccessible).'); }
  finally { clearTimeout(to); }
  if (!r.ok) throw new Error('Le lien répond avec une erreur (' + r.status + ').');
  const txt = (await r.text()).slice(0, 8e6);
  if (!/BEGIN:VCALENDAR/i.test(txt)) throw new Error('Ce lien ouvre une page web, pas un agenda. Il faut l’adresse d’export iCal (.ics) du portail, pas l’adresse de la page.');
  return txt;
}
// ICS-END
function doImport(m, list) {
  const cut = list.length > 3000; list = list.slice(0, 3000);
  db.events = db.events.filter(e => !(e.src === 'ics' && e.m === m)); // remplace l'import précédent de cette personne
  const mine = db.events.filter(e => e.m === m);
  let n = 0, cf = 0;
  list.forEach(x => {
    const w = mondayOf(x.w);
    if (!w || !(x.d >= 0 && x.d <= 6) || !okT(x.s) || !okT(x.e)) return;
    const o = { id: uid(), m, d: x.d, s: x.s, e: x.e, t: String(x.t || 'Sans titre').slice(0, 120), k: 'Cours', src: 'ics', w };
    if (mine.some(b => !b.j && !(b.ex && b.ex.includes(w)) && b.d === o.d && (!b.w || b.w === w) && tm(o.s) < tm(b.e) && tm(b.s) < tm(o.e))) cf++;
    db.events.push(o); n++;
  });
  return { n, cf, cut };
}
const okImp = (q, s, m) => {
  if (!mem(m)) { bad(s, 'Personne inconnue.'); return false; }
  if (!q.me.admin && m !== q.me.id) { bad(s, 'Vous ne pouvez importer un agenda que pour vous-même.', 403); return false; }
  return true;
};
app.post('/api/events/import', A, async (q, s) => {
  const m = q.body.m; if (!okImp(q, s, m)) return;
  const r = doImport(m, Array.isArray(q.body.events) ? q.body.events : []); log(q, 'Agenda importé pour ' + nm(m) + ' (' + r.n + ' cours)'); await save(); s.json(r);
});
app.post('/api/events/import-url', A, async (q, s) => {
  const m = q.body.m; if (!okImp(q, s, m)) return;
  const url = String(q.body.url || (db.icsUrls || {})[m] || '').trim();
  if (!url) return bad(s, 'Collez d’abord le lien de l’agenda.');
  try {
    const list = parseIcsServer(await fetchIcs(url));
    if (!list.length) return bad(s, 'Aucun cours trouvé dans cet agenda.');
    (db.icsUrls = db.icsUrls || {})[m] = url;
    const r = doImport(m, list); log(q, 'Agenda importé pour ' + nm(m) + ' (' + r.n + ' cours)'); await save(); s.json(r);
  } catch (e) { bad(s, e.message); }
});

// réveil : horaires habituels (par personne) et statut du jour
app.post('/api/wake', A, async (q, s) => {
  const m = q.body.m || q.me.id;
  if (!mem(m)) return bad(s, 'Personne inconnue.');
  if (!can(q, m)) return bad(s, 'Vous ne pouvez régler que votre propre réveil.', 403);
  const times = Array.isArray(q.body.times) ? q.body.times.slice(0, 7).map(x => String(x || '')) : [];
  while (times.length < 7) times.push('');
  if (!times.every(x => x === '' || okT(x))) return bad(s, 'Heure invalide.');
  const tol = Math.round(Number(q.body.tol));
  if (!(tol >= 0 && tol <= 240)) return bad(s, 'Marge invalide (0 à 240 minutes).');
  (db.wake = db.wake || {})[m] = { times, tol };
  await save(); s.json({});
});
app.post('/api/day', A, async (q, s) => {
  const { m, date, k } = q.body, v = q.body.v == null || q.body.v === '' ? null : String(q.body.v);
  if (!mem(m)) return bad(s, 'Personne inconnue.');
  if (!/^\d{4}-\d\d-\d\d$/.test(String(date)) || Math.abs(Date.parse(date + 'T00:00:00Z') - Date.now()) > 4 * 864e5) return bad(s, 'Date invalide.');
  const okV = { up: x => okT(x), late: x => okT(x), away: x => ['night', 'gone'].includes(x), pres: x => ['home', 'route', 'out'].includes(x) }[k];
  if (!okV || (v !== null && !okV(v))) return bad(s, 'Données invalides.');
  if (k !== 'up' && !can(q, m)) return bad(s, 'Seule la personne concernée (ou l’administrateur) peut changer cela.', 403);
  db.days = db.days || {};
  const day = db.days[date] = db.days[date] || {}, r = day[m] = day[m] || {};
  if (v === null) { delete r[k]; if (k === 'up') delete r.by; } else { r[k] = v; if (k === 'up') r.by = q.me.id; }
  if (!Object.keys(r).length) delete day[m];
  if (!Object.keys(day).length) delete db.days[date];
  Object.keys(db.days).sort().slice(0, -14).forEach(x => { delete db.days[x]; });
  await save(); s.json({});
});

// raccourcis
app.post('/api/tpl', A, async (q, s) => {
  const b = evBody({ ...q.body, m: q.me.id, rec: true }); if (b.error) return bad(s, b.error);
  if (tm(b.e) <= tm(b.s)) return bad(s, 'L’heure de fin doit être après l’heure de début.');
  db.tpl.push({ id: uid(), t: b.t, s: b.s, e: b.e, r: b.r, k: b.k, ...(b.j && { j: true }), o: q.me.id }); await save(); s.json({});
});
app.delete('/api/tpl/:id', A, async (q, s) => {
  const t = db.tpl.find(x => x.id === q.params.id); if (!t) return s.json({});
  if (!can(q, t.o)) return forbid(s);
  db.tpl = db.tpl.filter(x => x !== t); await save(); s.json({});
});
app.post('/api/tpl/:id/apply', A, async (q, s) => {
  const t = db.tpl.find(x => x.id === q.params.id); if (!t) return bad(s, 'Raccourci inconnu.', 404);
  if (!mem(q.body.m)) return bad(s, 'Personne inconnue.');
  const err = addRep([q.body.m], Number(q.body.d) || 0, t.s, t.e, t.t, t.k, t.r, mondayOf(q.body.w) || undefined, q.me.id, ['both', 'new'].includes(q.body.mode) ? q.body.mode : undefined, o => can(q, o.m, o.o), !!t.j); if (err) return confRes(s, err);
  log(q, 'Événement ajouté (raccourci) : ' + t.t + ' (' + nm(q.body.m) + ')');
  await save(); s.json({});
});

// tâches, courses, liens
const list = (name, mk, lab) => {
  app.post('/api/' + name, A, async (q, s) => { const o = mk(q.body, q.me); if (!o) return bad(s, 'Données invalides.'); const n = { id: uid(), ...o, o: q.me.id }; db[name].push(n); lab && log(q, lab.a + ' : ' + lab.f(n)); await save(); s.json({}); });
  app.patch('/api/' + name + '/:id', A, async (q, s) => { db[name].forEach(x => { if (x.id === q.params.id) x.x = !!q.body.x; }); await save(); s.json({}); });
  app.delete('/api/' + name + '/:id', A, async (q, s) => {
    const x = db[name].find(y => y.id === q.params.id); if (!x) return s.json({});
    if (!can(q, x.m, x.o)) return forbid(s);
    db[name] = db[name].filter(y => y !== x); lab && log(q, lab.d + ' : ' + lab.f(x)); await save(); s.json({});
  });
};
const txt = (v, n = 120) => String(v || '').trim().slice(0, n);
list('tasks', b => txt(b.t) && mem(b.m) ? { t: txt(b.t), m: b.m, x: false } : null, { a: 'Tâche ajoutée', d: 'Tâche supprimée', f: o => o.t + ' (' + nm(o.m) + ')' });
list('shop', b => txt(b.t) ? { t: txt(b.t), x: false } : null);
list('links', b => {
  let u = txt(b.u, 500); if (!txt(b.t) || !u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { new URL(u); } catch { return null; }
  return { t: txt(b.t), u, i: txt(b.i, 80), k: txt(b.k, 30) || 'Lien' };
});
list('rem', b => {
  const d = String(b.date || '');
  if (!txt(b.t) || !/^\d{4}-\d\d-\d\d$/.test(d) || isNaN(new Date(d + 'T00:00:00Z'))) return null;
  return { t: txt(b.t, 80), date: d, y: !!b.y, k: b.k === 'Anniversaire' ? 'Anniversaire' : 'Autre' };
}, { a: 'Rappel ajouté', d: 'Rappel supprimé', f: o => o.t + ' (' + o.date + (o.y ? ', chaque année' : '') + ')' });
app.delete('/api/shop-checked', A, async (q, s) => { db.shop = db.shop.filter(x => !(x.x && can(q, x.o))); await save(); s.json({}); });

// comptes : dépenses partagées à parts égales + remboursements
const money = v => Math.round(Number(String(v).replace(',', '.')) * 100);
app.post('/api/exp', A, async (q, s) => {
  const t = txt(q.body.t, 80), amt = money(q.body.amt), p = q.body.p;
  const sh = [...new Set(Array.isArray(q.body.sh) ? q.body.sh : [])].filter(i => mem(i));
  if (!t) return bad(s, 'Donnez un libellé à la dépense.');
  if (!(amt > 0 && amt <= 1e8)) return bad(s, 'Montant invalide.');
  if (!mem(p)) return bad(s, 'Qui a payé ?');
  if (!sh.length) return bad(s, 'Choisissez au moins une personne concernée.');
  const d = /^\d{4}-\d\d-\d\d$/.test(String(q.body.d)) ? q.body.d : new Date().toISOString().slice(0, 10);
  db.exp.push({ id: uid(), t, amt, p, sh, d, o: q.me.id });
  log(q, 'Dépense ajoutée : ' + t + ' ' + eur(amt) + ', payée par ' + nm(p) + ', partagée entre ' + sh.map(nm).join(', '));
  await save(); s.json({});
});
app.delete('/api/exp/:id', A, async (q, s) => {
  const x = db.exp.find(y => y.id === q.params.id); if (!x) return s.json({});
  if (!can(q, x.o)) return forbid(s);
  db.exp = db.exp.filter(y => y !== x); log(q, 'Dépense supprimée : ' + x.t + ' ' + eur(x.amt) + ' (payée par ' + nm(x.p) + ')');
  await save(); s.json({});
});
app.post('/api/pay', A, async (q, s) => {
  const { from, to } = q.body, amt = money(q.body.amt);
  if (!mem(from) || !mem(to) || from === to) return bad(s, 'Choisissez deux personnes différentes.');
  if (!(amt > 0 && amt <= 1e8)) return bad(s, 'Montant invalide.');
  if (!q.me.admin && q.me.id !== from && q.me.id !== to) return bad(s, 'Seules les personnes concernées (ou l’administrateur) peuvent enregistrer ce remboursement.', 403);
  db.pay.push({ id: uid(), from, to, amt, d: new Date().toISOString().slice(0, 10), o: q.me.id });
  log(q, 'Remboursement : ' + nm(from) + ' → ' + nm(to) + ' ' + eur(amt));
  await save(); s.json({});
});
app.delete('/api/pay/:id', A, async (q, s) => {
  const x = db.pay.find(y => y.id === q.params.id); if (!x) return s.json({});
  if (!can(q, x.o)) return forbid(s);
  db.pay = db.pay.filter(y => y !== x); log(q, 'Remboursement annulé : ' + nm(x.from) + ' → ' + nm(x.to) + ' ' + eur(x.amt));
  await save(); s.json({});
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (q, s) => bad(s, 'Introuvable.', 404));
module.exports = app;
if (require.main === module) { const P = process.env.PORT || 3000; app.listen(P, () => console.log('Notre maison : http://localhost:' + P)); }
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const tm = s => { const p = String(s).split(':'); return +p[0] * 60 + (+p[1] || 0); };
const p2 = n => (n < 10 ? '0' : '') + n;
const hm = t => p2(t.getHours()) + ':' + p2(t.getMinutes());
const iso = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const todayIdx = (new Date().getDay() + 6) % 7;
const PRES = { home: 'À la maison', route: 'En route', out: 'Absent(e)' };
const utc = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
const parseIso = s => { const p = s.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); };
const monIso = d => iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7));
const eurF = c => (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
let toastT;
const OK = [
  ['POST', /^\/events$/, 'Événement ajouté'], ['PATCH', /^\/events\//, 'Événement modifié'],
  ['DELETE', /^\/events\/[^?]+\?only/, 'Créneau de cette semaine supprimé'], ['DELETE', /^\/events\//, 'Événement supprimé'], ['DELETE', /^\/series\//, 'Série supprimée'],
  ['POST', /^\/tpl\/.+\/apply$/, 'Ajouté au planning'], ['POST', /^\/tpl$/, 'Raccourci enregistré'], ['DELETE', /^\/tpl\//, 'Raccourci supprimé'],
  ['POST', /^\/tasks$/, 'Tâche ajoutée'], ['DELETE', /^\/tasks\//, 'Tâche supprimée'],
  ['POST', /^\/shop$/, 'Article ajouté'], ['DELETE', /^\/shop-checked/, 'Articles cochés retirés'], ['DELETE', /^\/shop\//, 'Article retiré'],
  ['POST', /^\/links$/, 'Lien ajouté'], ['DELETE', /^\/links\//, 'Lien supprimé'],
  ['POST', /^\/rem$/, 'Rappel ajouté'], ['DELETE', /^\/rem\//, 'Rappel supprimé'],
  ['POST', /^\/exp$/, 'Dépense ajoutée'], ['DELETE', /^\/exp\//, 'Dépense supprimée'],
  ['POST', /^\/pay$/, 'Remboursement enregistré'], ['DELETE', /^\/pay\//, 'Remboursement annulé'],
  ['POST', /^\/day$/, 'Statut enregistré'], ['POST', /^\/wake$/, 'Horaires enregistrés'],
  ['POST', /^\/members$/, 'Membre ajouté'], ['DELETE', /^\/members\//, 'Membre supprimé'], ['POST', /^\/members\/.+\/reset-pin$/, 'PIN réinitialisé'], ['POST', /^\/pin\/change$/, 'Code PIN modifié']
];
const AWAY = { night: 'Absent(e) cette nuit', gone: 'Déjà parti(e)' };
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };

function pd(x) { // date iCalendar -> Date
  const m = x.match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/); if (!m) return null;
  return m[7] ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6] || 0)) : new Date(+m[1], m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0);
}
function parseIcs(txt) {
  txt = txt.replace(/\r?\n[ \t]/g, '');
  return txt.split('BEGIN:VEVENT').slice(1).map(b => {
    const ls = b.split('END:VEVENT')[0].split(/\r?\n/);
    const g = n => { for (const l of ls) { const c = l.charAt(n.length); if (l.indexOf(n) === 0 && (c === ':' || c === ';')) return l.slice(l.indexOf(':') + 1).trim(); } return ''; };
    const a = pd(g('DTSTART')), z = pd(g('DTEND'));
    return a ? { s: a, e: z || a, t: (g('SUMMARY').replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\s*\[[^\]]*\]\s*$/, '') || 'Sans titre') + (g('LOCATION').trim() ? ' (' + g('LOCATION').trim() + ')' : '') } : null;
  }).filter(Boolean);
}

Vue.createApp({
  data: () => ({
    DAYS, todayIdx, PRES, AWAY, now: Date.now(), view: 'week', moff: 0, ed: null, edErr: '', tmsg: '', xf: { t: '', amt: '', p: '', sh: [] }, pf: { from: '', to: '', amt: '' }, rf: { t: '', date: '', k: 'Anniversaire', y: true }, lt: '', ld: 0, del: null, wmsg: '', wf: { m: '', times: ['', '', '', '', '', '', ''], tol: 30 }, today: new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    token: store.get('maison-token') || '', me: null, members: [], st: null, sel: null, pin: '', pin2: '', err: '', err2: '', msg: '',
    off: 0, conf: null, im: '', icsUrl: '', tab: 'me', tabs: [['me', 'Mon espace'], ['today', 'Aujourd’hui'], ['plan', 'Planning'], ['tasks', 'Tâches'], ['shop', 'Courses'], ['money', 'Comptes'], ['rem', 'Rappels'], ['links', 'Liens'], ['members', 'Membres'], ['logs', 'Journal']],
    filter: null, kf: null, icsFile: null, nt: '', ns: '', nm2: '', nm: { name: '', color: '#0e7490' }, cp: { o: '', n: '', n2: '' }, lk: { t: '', k: 'Lien', u: '', i: '' },
    f: { t: '', k: 'Activité', m: '', d: todayIdx, r: 'one', rec: false, j: false, ms: [], s: '08:00', e: '09:00' }
  }),
  computed: {
    mon() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() - todayIdx + 7 * this.off); },
    wIso() { return iso(this.mon); },
    weekLabel() {
      const a = this.mon, b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 6), o = { day: 'numeric', month: 'long' };
      return 'Semaine du ' + a.toLocaleDateString('fr-FR', o) + ' au ' + b.toLocaleDateString('fr-FR', { ...o, year: 'numeric' });
    },
    dur() { return tm(this.f.e) - tm(this.f.s); },
    durLabel() { return this.dur > 0 ? this.durTxt(this.dur) : 'la fin doit suivre le début'; },
    impList() { return this.st.members.filter(m => this.me.admin || m.id === this.me.id); },
    mgrid() {
      const n = new Date(this.now), first = new Date(n.getFullYear(), n.getMonth() + this.moff, 1), last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
      const start = new Date(first.getFullYear(), first.getMonth(), 1 - (first.getDay() + 6) % 7), rows = [];
      for (let r = 0; r < 6; r++) {
        const rs = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * r); if (rs > last) break;
        const row = [];
        for (let i = 0; i < 7; i++) {
          const dt = new Date(rs.getFullYear(), rs.getMonth(), rs.getDate() + i), k = iso(dt);
          const items = this.evsOn(dt).map(e => ({ id: 'e' + e.id, t: (e.j ? '' : e.s + ' ') + e.t, c: this.mem(e.m).color, title: e.t + ' – ' + (e.j ? 'toute la journée' : e.s + '–' + e.e) + ' · ' + this.mem(e.m).name }))
            .concat(this.remsOn(dt).map(x => ({ id: 'r' + x.id, t: (x.k === 'Anniversaire' ? '🎂 ' : '🔔 ') + x.t, c: '#b45309' })));
          row.push({ k, n: dt.getDate(), out: dt.getMonth() !== first.getMonth(), today: k === this.tIso, items: items.slice(0, 3), more: Math.max(0, items.length - 3) });
        }
        rows.push(row);
      }
      return { label: first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), rows };
    },
    bal() {
      const b = {}; this.st.members.forEach(m => { b[m.id] = 0; });
      (this.st.exp || []).forEach(x => {
        const sh = x.sh.filter(id => b[id] !== undefined); if (!sh.length || b[x.p] === undefined) return;
        const base = Math.floor(x.amt / sh.length), rem = x.amt - base * sh.length;
        b[x.p] += x.amt; sh.forEach((id, i) => { b[id] -= base + (i < rem ? 1 : 0); });
      });
      (this.st.pay || []).forEach(p => { if (b[p.from] !== undefined && b[p.to] !== undefined) { b[p.from] += p.amt; b[p.to] -= p.amt; } });
      return b;
    },
    transfers() {
      const b = this.bal, cr = [], de = [];
      Object.keys(b).forEach(id => { if (b[id] > 0) cr.push([id, b[id]]); else if (b[id] < 0) de.push([id, -b[id]]); });
      cr.sort((x, y) => y[1] - x[1]); de.sort((x, y) => y[1] - x[1]);
      const out = []; let i = 0, j = 0;
      while (i < cr.length && j < de.length) { const a = Math.min(cr[i][1], de[j][1]); out.push({ from: de[j][0], to: cr[i][0], amt: a }); cr[i][1] -= a; de[j][1] -= a; if (!cr[i][1]) i++; if (!de[j][1]) j++; }
      return out;
    },
    remList() {
      const t = parseIso(this.tIso);
      return (this.st.rem || []).map(r => {
        const b = parseIso(r.date); let d = b, past = false;
        if (r.y) { d = new Date(t.getFullYear(), b.getMonth(), b.getDate()); if (d < t) d = new Date(t.getFullYear() + 1, b.getMonth(), b.getDate()); } else past = d < t;
        const dd = Math.round((utc(d) - utc(t)) / 864e5), age = r.y && r.k === 'Anniversaire' ? d.getFullYear() - b.getFullYear() : 0;
        return { r, dd, past, age, day: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: r.y ? undefined : 'numeric' }), when: past ? 'Passé' : dd === 0 ? 'Aujourd’hui !' : dd === 1 ? 'Demain' : 'Dans ' + dd + ' jours' };
      }).sort((a, b) => a.past - b.past || a.dd - b.dd);
    },
    remSoon() { return this.remList.filter(x => !x.past && x.dd <= 30); },
    myDay() { return this.evsOn(parseIso(this.tIso), this.me.id); },
    myNext() {
      const t = parseIso(this.tIso), out = [];
      for (let i = 1; i <= 7; i++) { const dt = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i), evs = this.evsOn(dt, this.me.id); if (evs.length) out.push({ k: iso(dt), label: dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), evs }); }
      return out;
    },
    myTasks() { return this.st.tasks.filter(t => t.m === this.me.id && !t.x); },
    logsList() { return (this.st.logs || []).slice().reverse(); },
    tIso() { return iso(new Date(this.now)); },
    tIdx() { return (new Date(this.now).getDay() + 6) % 7; },
    tmrIso() { const n = new Date(this.now); return iso(new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1)); },
    myAnn() {
      const out = [];
      [[this.tIso, 'Aujourd’hui'], [this.tmrIso, 'Demain']].forEach(([date, lab]) => {
        const r = this.dayRec(this.me.id, date);
        if (r.late) out.push({ k: 'late', date, txt: lab + ' : lever tardif vers ' + r.late });
        if (r.away) out.push({ k: 'away', date, txt: lab + ' : ' + AWAY[r.away] });
      });
      return out;
    },
    grid() {
      const PX = 44, all = this.st.events.filter(e => (!e.w || e.w === this.wIso) && !(e.ex && e.ex.includes(this.wIso)) && (!this.filter || e.m === this.filter) && (!this.kf || (this.kf === 'Cours') === ['Cours', 'TP', 'TD', 'Autonomie'].includes(e.k)));
      const timed = all.filter(e => !e.j);
      let lo = 8, hi = 18;
      timed.forEach(e => { lo = Math.min(lo, Math.floor(tm(e.s) / 60)); hi = Math.max(hi, Math.ceil(tm(e.e) / 60)); });
      const hours = []; for (let h = lo; h < hi; h++) hours.push(h);
      const cols = DAYS.map((name, i) => {
        const dt = new Date(this.mon.getFullYear(), this.mon.getMonth(), this.mon.getDate() + i), date = p2(dt.getDate()) + '/' + p2(dt.getMonth() + 1);
        const evs = timed.filter(e => e.d === i).sort((a, b) => tm(a.s) - tm(b.s)), ends = [];
        const pl = evs.map(e => { let l = 0; while (ends[l] !== undefined && ends[l] > tm(e.s)) l++; ends[l] = Math.max(tm(e.e), tm(e.s) + 20); return { e, l }; });
        const n = Math.max(1, ends.length);
        const blocks = pl.map(({ e, l }) => {
          const c = this.mem(e.m).color, sub = `${e.s}–${e.e} · ${this.mem(e.m).name}` + (e.k && e.k !== 'Activité' ? ' · ' + e.k : '') + (e.w ? '' : ' · chaque semaine');
          return { e, sub, title: e.t + ' – ' + sub, style: { top: (tm(e.s) - lo * 60) * PX / 60 + 'px', height: Math.max((tm(e.e) - tm(e.s)) * PX / 60, 20) + 'px', left: l * 100 / n + '%', width: 100 / n + '%', background: c + '26', borderColor: c } };
        });
        const ads = all.filter(e => e.j && e.d === i).map(e => {
          const c = this.mem(e.m).color, sub = 'toute la journée · ' + this.mem(e.m).name + (e.w ? '' : ' · chaque semaine');
          return { e, c, title: e.t + ' – ' + sub, style: { background: c + '26', borderColor: c } };
        });
        return { i, name, date, today: this.off === 0 && i === todayIdx, blocks, ads, range: evs.length ? evs[0].s + '–' + evs.reduce((a, e) => e.e > a ? e.e : a, '00:00') : '' };
      });
      const adN = Math.max(0, ...cols.map(c => c.ads.length));
      return { lo, hi, H: (hi - lo) * PX, adH: adN * 24, hours, cols };
    }
  },
  methods: {
    can(...ids) { ids = ids.filter(Boolean); return !!this.me && (this.me.admin || !ids.length || ids.includes(this.me.id)); },
    fmtT(min) { min = Math.max(0, Math.min(Math.round(min), 1439)); return p2(Math.floor(min / 60)) + ':' + p2(min % 60); },
    durTxt(d) { return d < 60 ? d + ' min' : Math.floor(d / 60) + ' h' + (d % 60 ? p2(d % 60) : ''); },
    setStart(v) { if (!v) return; const d = this.dur > 0 ? this.dur : 60; this.f.s = v; this.f.e = this.fmtT(tm(v) + d); },
    setDur(d) { this.f.e = this.fmtT(tm(this.f.s) + d); },
    togMs(id) { const i = this.f.ms.indexOf(id); if (i < 0) this.f.ms.push(id); else this.f.ms.splice(i, 1); },
    async importUrl(re) {
      this.msg = this.err = '';
      const body = { m: this.im };
      if (!re) { if (!this.icsUrl.trim()) { this.msg = 'Collez d’abord le lien de l’agenda.'; return; } body.url = this.icsUrl.trim(); }
      this.msg = 'Import en cours…';
      try {
        const r = await this.api('POST', '/events/import-url', body);
        this.msg = r.n + ' cours importé(s) sur toute la période du calendrier.' + (r.cut ? ' Le calendrier dépasse 3000 événements : la fin a été ignorée.' : '') + (r.cf ? ' Attention : ' + r.cf + ' conflit(s) d’horaire avec des événements existants.' : '');
        this.icsUrl = ''; await this.refresh();
      } catch (e) { this.msg = e.message; }
    },
    evsOn(dt, who) {
      const mon = monIso(dt), d = (dt.getDay() + 6) % 7;
      return this.st.events.filter(e => e.d === d && (!e.w || e.w === mon) && !(e.ex && e.ex.includes(mon)) && (who ? e.m === who : (!this.filter || e.m === this.filter) && (!this.kf || (this.kf === 'Cours') === ['Cours', 'TP', 'TD', 'Autonomie'].includes(e.k))))
        .sort((a, b) => (b.j ? 1 : 0) - (a.j ? 1 : 0) || tm(a.s) - tm(b.s));
    },
    remsOn(dt) { const k = iso(dt); return (this.st.rem || []).filter(r => r.date === k || (r.y && r.date.slice(5) === k.slice(5))); },
    mgo(n) { this.moff = n === 0 ? 0 : this.moff + n; },
    openDay(c) { this.off = Math.round((utc(parseIso(monIso(parseIso(c.k)))) - utc(parseIso(monIso(new Date(this.now))))) / (7 * 864e5)); this.view = 'week'; },
    fmt: eurF,
    fmtAt(a) { return new Date(a).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); },
    balTxt(id) { const v = this.bal[id]; return v > 0 ? 'récupère ' + eurF(v) : v < 0 ? 'doit ' + eurF(-v) : 'à l’équilibre'; },
    toast(m) { this.tmsg = m; clearTimeout(toastT); toastT = setTimeout(() => { this.tmsg = ''; }, 3500); },
    notify(method, url) { const o = OK.find(x => x[0] === method && x[1].test(url)); if (o) this.toast(o[2]); },
    async rm(path, msg) { if (confirm(msg)) await this.call('DELETE', path); },
    async addExp() {
      this.err = '';
      try { await this.api('POST', '/exp', { ...this.xf, d: this.tIso }); this.xf.t = ''; this.xf.amt = ''; await this.refresh(); } catch (e) { this.err = e.message; }
    },
    async addPay() {
      this.err = '';
      try { await this.api('POST', '/pay', this.pf); this.pf.amt = ''; await this.refresh(); } catch (e) { this.err = e.message; }
    },
    paid(t) { return this.call('POST', '/pay', { from: t.from, to: t.to, amt: t.amt / 100 }); },
    openEdit(e) { this.edErr = ''; this.ed = { id: e.id, t: e.t, k: ['Activité', 'Réunion', 'Cours'].includes(e.k) ? e.k : 'Cours', d: e.d, s: e.s, e: e.e, j: !!e.j, m: e.m, rec: !e.w, ok: this.can(e.m, e.o) }; },
    async saveEdit(mode) {
      const x = this.ed; if (!x) return; this.edErr = '';
      try { await this.api('PATCH', '/events/' + x.id, { t: x.t, k: x.k, d: x.d, s: x.s, e: x.e, j: x.j, mode }); this.ed = null; this.conf = null; await this.refresh(); }
      catch (e) {
        if (e.conflicts) this.conf = { kind: 'edit', list: e.conflicts, total: e.total, nv: { t: x.t.trim() || 'Événement', s: x.s, e: x.e, who: this.mem(x.m).name } };
        else { this.conf = null; this.edErr = e.message; }
      }
    },
    delFromEdit() { const e = this.st.events.find(x => x.id === this.ed.id); this.ed = null; if (e) this.askDel(e); },
    evDate(e) { const d = new Date(this.mon.getFullYear(), this.mon.getMonth(), this.mon.getDate() + e.d); return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); },
    askDel(e) { if (e.w) this.call('DELETE', '/events/' + e.id); else this.del = e; },
    async delOnce(e) { await this.call('DELETE', '/events/' + e.id + '?only=1&w=' + this.wIso); this.del = null; },
    async delAll(e) { await this.call('DELETE', '/events/' + e.id); this.del = null; },
    nowHm() { return hm(new Date()); },
    dayRec(id, date) { const d = this.st && this.st.days && this.st.days[date || this.tIso]; return (d && d[id]) || {}; },
    wakeOf(id) { const w = this.st && this.st.wake && this.st.wake[id]; return { times: (w && w.times) || [], tol: w && w.tol != null ? w.tol : 30 }; },
    wstat(id) {
      const r = this.dayRec(id), w = this.wakeOf(id), n = new Date(this.now), mins = n.getHours() * 60 + n.getMinutes();
      if (r.away) return { c: 'neu', l: AWAY[r.away] };
      if (r.up) return { c: 'ok', l: 'Réveillé à ' + r.up + (r.by && r.by !== id ? ' · confirmé par ' + this.mem(r.by).name : '') };
      const exp = r.late || w.times[this.tIdx];
      if (!exp) return { c: 'neu', l: 'Pas d’heure de réveil réglée' };
      const over = mins > tm(exp) + w.tol;
      if (r.late) return over ? { c: 'warn', l: 'Pas encore confirmé (lever tardif annoncé vers ' + exp + ')' } : { c: 'neu', l: 'Grasse matinée prévue jusqu’à ' + exp };
      return over ? { c: 'warn', l: 'Pas encore confirmé (prévu à ' + exp + ')' } : { c: 'neu', l: 'Prévu à ' + exp };
    },
    setDay(m, k, v, date) { return this.call('POST', '/day', { m, date: date || this.tIso, k, v }); },
    announce(k, v) { return this.setDay(this.me.id, k, v, this.ld === 1 ? this.tmrIso : this.tIso); },
    loadWake() { const w = this.wakeOf(this.wf.m); this.wf.times = [0, 1, 2, 3, 4, 5, 6].map(i => w.times[i] || ''); this.wf.tol = w.tol; this.wmsg = ''; },
    async saveWake() {
      this.wmsg = this.err = '';
      try { await this.api('POST', '/wake', { m: this.wf.m, times: this.wf.times, tol: Number(this.wf.tol) }); await this.refresh(); this.wmsg = 'Horaires enregistrés.'; }
      catch (e) { this.err = e.message; }
    },
    go(n) { this.off = n === 0 ? 0 : this.off + n; },
    mem(id) { return (this.st && this.st.members.find(m => m.id === id)) || { name: '?', color: '#888' }; },
    async api(method, url, body) {
      let r;
      try { r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
      catch { throw new Error('Serveur injoignable. Lancez « npm start » puis ouvrez http://localhost:3000 (et non le fichier index.html).'); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (j.auth) this.logout(true); const er = new Error(j.error || 'Le serveur ne répond pas correctement (erreur ' + r.status + '). L’API Express est-elle bien déployée ?'); if (j.conflicts) { er.conflicts = j.conflicts; er.total = j.total; } throw er; }
      if (method !== 'GET') this.notify(method, url);
      return j;
    },
    async call(method, url, body) { this.err = ''; try { await this.api(method, url, body); await this.refresh(); } catch (e) { this.err = e.message; } },
    async add(name, body, done) { this.err = ''; try { await this.api('POST', '/' + name, body); done && done(); await this.refresh(); } catch (e) { this.err = e.message; } },
    async refresh() { this.st = await this.api('GET', '/state'); this.members = this.st.members; this.me = this.members.find(m => m.id === this.me.id) || this.me; if (!this.f.m) this.f.m = this.me.id; if (!this.nm2) this.nm2 = this.me.id; if (!this.im) this.im = this.me.id; },
    async loadMembers() { try { this.members = await this.api('GET', '/members'); this.err = ''; } catch (e) { this.err = e.message; } },
    pick(m) { this.sel = m; this.pin = this.pin2 = this.err = ''; },
    async enter() {
      this.err = '';
      try {
        if (!this.sel.hasPin && this.pin !== this.pin2) throw new Error('Les deux codes sont différents.');
        const r = await this.api('POST', this.sel.hasPin ? '/login' : '/pin/setup', { memberId: this.sel.id, pin: this.pin });
        this.token = r.token; store.set('maison-token', r.token); this.pin = this.pin2 = ''; await this.start();
      } catch (e) { this.err = e.message; this.pin = this.pin2 = ''; }
    },
    async start() {
      try { const { id } = await this.api('GET', '/me'); this.st = await this.api('GET', '/state'); this.members = this.st.members; this.me = this.members.find(m => m.id === id); this.f.m = this.nm2 = this.im = this.wf.m = id; this.f.ms = [id]; this.loadWake(); this.xf.p = this.pf.from = id; this.xf.sh = this.members.map(m => m.id); }
      catch { this.logout(true); }
    },
    async logout(silent) {
      if (!silent && this.token) { try { await this.api('POST', '/logout'); } catch {} }
      this.token = ''; store.set('maison-token', ''); this.me = null; this.st = null; this.sel = null; this.filter = null; this.f.m = this.nm2 = this.im = this.wf.m = ''; this.f.ms = []; this.xf.p = this.pf.from = ''; this.xf.sh = []; this.ed = null; this.tab = 'me'; this.off = 0; this.loadMembers();
    },
    async addMember() {
      this.err = '';
      try { await this.api('POST', '/members', this.nm); this.nm = { name: '', color: '#0e7490' }; this.me ? await this.refresh() : await this.loadMembers(); } catch (e) { this.err = e.message; }
    },
    async changePin() {
      this.msg = this.err = '';
      try {
        if (this.cp.n !== this.cp.n2) throw new Error('Les deux nouveaux codes sont différents.');
        await this.api('POST', '/pin/change', { oldPin: this.cp.o, newPin: this.cp.n });
        this.cp = { o: '', n: '', n2: '' }; this.msg = 'Code PIN modifié. Les autres appareils devront se reconnecter.';
      } catch (e) { this.err = e.message; }
    },
    async resetPin(m) { if (m.hasPin && confirm('Réinitialiser le PIN de ' + m.name + ' ?')) { await this.call('POST', '/members/' + m.id + '/reset-pin'); if (m.id === this.me.id) this.logout(true); } },
    async delMember(m) { if (confirm('Supprimer ' + m.name + ', ses activités, ses tâches et ses dépenses ?')) { await this.call('DELETE', '/members/' + m.id); if (m.id === this.me.id) this.logout(true); if (this.filter === m.id) this.filter = null; } },
    async addEvent(mode) {
      this.err2 = '';
      try { await this.api('POST', '/events', { ...this.f, w: this.wIso, mode }); this.f.t = ''; this.conf = null; await this.refresh(); }
      catch (e) {
        if (e.conflicts) this.conf = { kind: 'event', list: e.conflicts, total: e.total, nv: { t: this.f.t.trim() || 'Nouvel événement', s: this.f.s, e: this.f.e, who: this.f.ms.map(id => this.mem(id).name).join(', ') } };
        else { this.conf = null; this.err2 = e.message; }
      }
    },
    async saveTpl() {
      this.err2 = ''; if (!this.f.t.trim()) return;
      try { await this.api('POST', '/tpl', this.f); await this.refresh(); } catch (e) { this.err2 = e.message; }
    },
    async applyTpl(t, mode) {
      this.err = '';
      const who = this.filter || this.me.id;
      try { await this.api('POST', '/tpl/' + t.id + '/apply', { m: who, d: this.off === 0 ? todayIdx : 0, w: this.wIso, mode }); this.conf = null; await this.refresh(); }
      catch (e) {
        if (e.conflicts) this.conf = { kind: 'tpl', tpl: t, list: e.conflicts, total: e.total, nv: { t: t.t, s: t.s, e: t.e, who: this.mem(who).name } };
        else { this.conf = null; this.err = e.message; }
      }
    },
    resolve(mode) { const c = this.conf; if (!c) return; if (mode === 'old') { this.conf = null; return; } c.kind === 'tpl' ? this.applyTpl(c.tpl, mode) : c.kind === 'edit' ? this.saveEdit(mode) : this.addEvent(mode); },
    importIcs() {
      if (!this.icsFile) { this.msg = 'Choisissez d’abord un fichier .ics.'; return; }
      const rd = new FileReader();
      rd.onload = async () => {
        const events = parseIcs(String(rd.result)).map(x => ({ w: iso(new Date(x.s.getFullYear(), x.s.getMonth(), x.s.getDate() - (x.s.getDay() + 6) % 7)), d: (x.s.getDay() + 6) % 7, s: hm(x.s), e: hm(x.e), t: x.t }));
        if (!events.length) { this.msg = 'Aucun événement trouvé dans ce fichier.'; return; }
        try { const r = await this.api('POST', '/events/import', { m: this.im, events }); this.msg = r.n + ' événement(s) importé(s) sur toutes les semaines du fichier.' + (r.cut ? ' Le fichier dépasse 3000 événements : la fin a été ignorée.' : '') + (r.cf ? ' Attention : ' + r.cf + ' conflit(s) d’horaire avec des événements existants.' : ''); await this.refresh(); }
        catch (e) { this.msg = e.message; }
      };
      rd.readAsText(this.icsFile);
    },
    copy(t, ev) { try { navigator.clipboard.writeText(t); ev.target.textContent = 'Copié'; } catch {} }
  },
  async mounted() {
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { this.conf = this.del = this.ed = null; } });
    setInterval(() => { this.now = Date.now(); }, 30000);
    await this.loadMembers();
    if (this.token) await this.start();
    setInterval(() => { if (this.me && !document.hidden) this.refresh().catch(() => {}); }, 15000); // synchro famille
  }
}).mount('#app');
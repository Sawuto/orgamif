const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const tm = s => { const p = String(s).split(':'); return +p[0] * 60 + (+p[1] || 0); };
const p2 = n => (n < 10 ? '0' : '') + n;
const hm = t => p2(t.getHours()) + ':' + p2(t.getMinutes());
const todayIdx = (new Date().getDay() + 6) % 7;
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
    DAYS, todayIdx, today: new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    token: store.get('maison-token') || '', me: null, members: [], st: null, sel: null, pin: '', pin2: '', err: '', err2: '', msg: '',
    tab: 'plan', tabs: [['plan', 'Planning'], ['tasks', 'Tâches'], ['shop', 'Courses'], ['links', 'Liens'], ['members', 'Membres']],
    filter: null, kf: null, icsFile: null, nt: '', ns: '', nm2: '', nm: { name: '', color: '#0e7490' }, lk: { t: '', k: 'Lien', u: '', i: '' },
    f: { t: '', k: 'Activité', m: '', d: todayIdx, r: 'one', s: '08:00', e: '09:00' }
  }),
  computed: {
    grid() {
      const PX = 44, all = this.st.events.filter(e => (!this.filter || e.m === this.filter) && (!this.kf || (this.kf === 'Cours') === ['Cours', 'TP', 'TD', 'Autonomie'].includes(e.k)));
      let lo = 8, hi = 18;
      all.forEach(e => { lo = Math.min(lo, Math.floor(tm(e.s) / 60)); hi = Math.max(hi, Math.ceil(tm(e.e) / 60)); });
      const hours = []; for (let h = lo; h < hi; h++) hours.push(h);
      const cols = DAYS.map((name, i) => {
        const evs = all.filter(e => e.d === i).sort((a, b) => tm(a.s) - tm(b.s)), ends = [];
        const pl = evs.map(e => { let l = 0; while (ends[l] !== undefined && ends[l] > tm(e.s)) l++; ends[l] = Math.max(tm(e.e), tm(e.s) + 20); return { e, l }; });
        const n = Math.max(1, ends.length);
        const blocks = pl.map(({ e, l }) => {
          const c = this.mem(e.m).color, sub = `${e.s}–${e.e} · ${this.mem(e.m).name}` + (e.k && e.k !== 'Activité' ? ' · ' + e.k : '');
          return { e, sub, title: e.t + ' – ' + sub, style: { top: (tm(e.s) - lo * 60) * PX / 60 + 'px', height: Math.max((tm(e.e) - tm(e.s)) * PX / 60, 20) + 'px', left: l * 100 / n + '%', width: 100 / n + '%', background: c + '26', borderColor: c } };
        });
        return { i, name, blocks, range: evs.length ? evs[0].s + '–' + evs.reduce((a, e) => e.e > a ? e.e : a, '00:00') : '' };
      });
      return { lo, hi, H: (hi - lo) * PX, hours, cols };
    }
  },
  methods: {
    mem(id) { return (this.st && this.st.members.find(m => m.id === id)) || { name: '?', color: '#888' }; },
    async api(method, url, body) {
      const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (j.auth) this.logout(true); throw new Error(j.error || 'Erreur'); }
      return j;
    },
    async call(method, url, body) { this.err = ''; try { await this.api(method, url, body); await this.refresh(); } catch (e) { this.err = e.message; } },
    async add(name, body, done) { this.err = ''; try { await this.api('POST', '/' + name, body); done && done(); await this.refresh(); } catch (e) { this.err = e.message; } },
    async refresh() { this.st = await this.api('GET', '/state'); this.members = this.st.members; if (!this.f.m) this.f.m = this.me.id; if (!this.nm2) this.nm2 = this.me.id; },
    async loadMembers() { try { this.members = await this.api('GET', '/members'); } catch {} },
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
      try { const { id } = await this.api('GET', '/me'); this.st = await this.api('GET', '/state'); this.members = this.st.members; this.me = this.members.find(m => m.id === id); this.f.m = this.nm2 = id; }
      catch { this.logout(true); }
    },
    async logout(silent) {
      if (!silent && this.token) { try { await this.api('POST', '/logout'); } catch {} }
      this.token = ''; store.set('maison-token', ''); this.me = null; this.st = null; this.sel = null; this.filter = null; this.f.m = this.nm2 = ''; this.loadMembers();
    },
    async addMember() {
      this.err = '';
      try { await this.api('POST', '/members', this.nm); this.nm = { name: '', color: '#0e7490' }; this.me ? await this.refresh() : await this.loadMembers(); } catch (e) { this.err = e.message; }
    },
    async resetPin(m) { if (m.hasPin && confirm('Réinitialiser le PIN de ' + m.name + ' ?')) { await this.call('POST', '/members/' + m.id + '/reset-pin'); if (m.id === this.me.id) this.logout(true); } },
    async delMember(m) { if (confirm('Supprimer ' + m.name + ', ses activités et ses tâches ?')) { await this.call('DELETE', '/members/' + m.id); if (m.id === this.me.id) this.logout(true); if (this.filter === m.id) this.filter = null; } },
    async addEvent() { this.err2 = ''; try { await this.api('POST', '/events', this.f); this.f.t = ''; await this.refresh(); } catch (e) { this.err2 = e.message; } },
    async saveTpl() {
      this.err2 = ''; if (!this.f.t.trim()) return;
      try { await this.api('POST', '/tpl', this.f); await this.refresh(); } catch (e) { this.err2 = e.message; }
    },
    async applyTpl(t) { this.err = ''; try { await this.api('POST', '/tpl/' + t.id + '/apply', { m: this.filter || this.me.id, d: todayIdx }); await this.refresh(); } catch (e) { this.err = e.message; } },
    importIcs() {
      if (!this.icsFile) { this.msg = 'Choisissez d’abord un fichier .ics.'; return; }
      const rd = new FileReader();
      rd.onload = async () => {
        const now = new Date(), mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - todayIdx), end = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7);
        const events = parseIcs(String(rd.result)).filter(x => x.s >= mon && x.s < end).map(x => ({ d: (x.s.getDay() + 6) % 7, s: hm(x.s), e: hm(x.e), t: x.t }));
        try { const r = await this.api('POST', '/events/import', { m: this.f.m, events }); this.msg = r.n + ' événement(s) importé(s) pour la semaine en cours.' + (r.cf ? ' Attention : ' + r.cf + ' conflit(s) d’horaire avec des événements existants.' : ''); await this.refresh(); }
        catch (e) { this.msg = e.message; }
      };
      rd.readAsText(this.icsFile);
    },
    copy(t, ev) { try { navigator.clipboard.writeText(t); ev.target.textContent = 'Copié'; } catch {} }
  },
  async mounted() {
    await this.loadMembers();
    if (this.token) await this.start();
    setInterval(() => { if (this.me && !document.hidden) this.refresh().catch(() => {}); }, 15000); // synchro famille
  }
}).mount('#app');

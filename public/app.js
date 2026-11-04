const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const tm = s => { const p = String(s).split(':'); return +p[0] * 60 + (+p[1] || 0); };
const p2 = n => (n < 10 ? '0' : '') + n;
const hm = t => p2(t.getHours()) + ':' + p2(t.getMinutes());
const iso = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
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
    off: 0, im: '', icsUrl: '', tab: 'plan', tabs: [['plan', 'Planning'], ['tasks', 'Tâches'], ['shop', 'Courses'], ['links', 'Liens'], ['members', 'Membres']],
    filter: null, kf: null, icsFile: null, nt: '', ns: '', nm2: '', nm: { name: '', color: '#0e7490' }, cp: { o: '', n: '', n2: '' }, lk: { t: '', k: 'Lien', u: '', i: '' },
    f: { t: '', k: 'Activité', m: '', d: todayIdx, r: 'one', rec: false, ms: [], s: '08:00', e: '09:00' }
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
    grid() {
      const PX = 44, all = this.st.events.filter(e => (!e.w || e.w === this.wIso) && (!this.filter || e.m === this.filter) && (!this.kf || (this.kf === 'Cours') === ['Cours', 'TP', 'TD', 'Autonomie'].includes(e.k)));
      let lo = 8, hi = 18;
      all.forEach(e => { lo = Math.min(lo, Math.floor(tm(e.s) / 60)); hi = Math.max(hi, Math.ceil(tm(e.e) / 60)); });
      const hours = []; for (let h = lo; h < hi; h++) hours.push(h);
      const cols = DAYS.map((name, i) => {
        const dt = new Date(this.mon.getFullYear(), this.mon.getMonth(), this.mon.getDate() + i), date = p2(dt.getDate()) + '/' + p2(dt.getMonth() + 1);
        const evs = all.filter(e => e.d === i).sort((a, b) => tm(a.s) - tm(b.s)), ends = [];
        const pl = evs.map(e => { let l = 0; while (ends[l] !== undefined && ends[l] > tm(e.s)) l++; ends[l] = Math.max(tm(e.e), tm(e.s) + 20); return { e, l }; });
        const n = Math.max(1, ends.length);
        const blocks = pl.map(({ e, l }) => {
          const c = this.mem(e.m).color, sub = `${e.s}–${e.e} · ${this.mem(e.m).name}` + (e.k && e.k !== 'Activité' ? ' · ' + e.k : '') + (e.w ? '' : ' · chaque semaine');
          return { e, sub, title: e.t + ' – ' + sub, style: { top: (tm(e.s) - lo * 60) * PX / 60 + 'px', height: Math.max((tm(e.e) - tm(e.s)) * PX / 60, 20) + 'px', left: l * 100 / n + '%', width: 100 / n + '%', background: c + '26', borderColor: c } };
        });
        return { i, name, date, today: this.off === 0 && i === todayIdx, blocks, range: evs.length ? evs[0].s + '–' + evs.reduce((a, e) => e.e > a ? e.e : a, '00:00') : '' };
      });
      return { lo, hi, H: (hi - lo) * PX, hours, cols };
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
    go(n) { this.off = n === 0 ? 0 : this.off + n; },
    mem(id) { return (this.st && this.st.members.find(m => m.id === id)) || { name: '?', color: '#888' }; },
    async api(method, url, body) {
      let r;
      try { r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
      catch { throw new Error('Serveur injoignable. Lancez « npm start » puis ouvrez http://localhost:3000 (et non le fichier index.html).'); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (j.auth) this.logout(true); throw new Error(j.error || 'Le serveur ne répond pas correctement (erreur ' + r.status + '). L’API Express est-elle bien déployée ?'); }
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
      try { const { id } = await this.api('GET', '/me'); this.st = await this.api('GET', '/state'); this.members = this.st.members; this.me = this.members.find(m => m.id === id); this.f.m = this.nm2 = this.im = id; this.f.ms = [id]; }
      catch { this.logout(true); }
    },
    async logout(silent) {
      if (!silent && this.token) { try { await this.api('POST', '/logout'); } catch {} }
      this.token = ''; store.set('maison-token', ''); this.me = null; this.st = null; this.sel = null; this.filter = null; this.f.m = this.nm2 = this.im = ''; this.f.ms = []; this.off = 0; this.loadMembers();
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
    async delMember(m) { if (confirm('Supprimer ' + m.name + ', ses activités et ses tâches ?')) { await this.call('DELETE', '/members/' + m.id); if (m.id === this.me.id) this.logout(true); if (this.filter === m.id) this.filter = null; } },
    async addEvent() { this.err2 = ''; try { await this.api('POST', '/events', { ...this.f, w: this.wIso }); this.f.t = ''; await this.refresh(); } catch (e) { this.err2 = e.message; } },
    async saveTpl() {
      this.err2 = ''; if (!this.f.t.trim()) return;
      try { await this.api('POST', '/tpl', this.f); await this.refresh(); } catch (e) { this.err2 = e.message; }
    },
    async applyTpl(t) { this.err = ''; try { await this.api('POST', '/tpl/' + t.id + '/apply', { m: this.filter || this.me.id, d: this.off === 0 ? todayIdx : 0, w: this.wIso }); await this.refresh(); } catch (e) { this.err = e.message; } },
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
    await this.loadMembers();
    if (this.token) await this.start();
    setInterval(() => { if (this.me && !document.hidden) this.refresh().catch(() => {}); }, 15000); // synchro famille
  }
}).mount('#app');
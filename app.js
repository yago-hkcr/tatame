/* ==========================================================================
   TATAME · app
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ util */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, '0');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const TEC_MAP = Object.fromEntries(TECNICAS.map((t) => [t.id, t]));
  const TIPO = Object.fromEntries(TIPOS_BLOCO.map((t) => [t.id, t]));
  const SUB_NOME = {};
  GRUPOS.forEach((g) => g.subs.forEach((s) => (SUB_NOME[s.id] = s.nome)));

  /* ---------------- exercícios personalizados (fora do repertório) ----------
     Flexão, agachamento, prancha, o golpe que a pessoa está montando: cada um
     vive no perfil (`db.exercicios`) e entra nos blocos igual a uma técnica,
     com id próprio (`cx-…`) para não colidir com os ids do catálogo. */
  const CAT_EX = [
    { id: 'forca', nome: 'Força', cor: '#e0654f' },
    { id: 'golpe', nome: 'Golpe', cor: '#e8c063' },
    { id: 'mobilidade', nome: 'Mobilidade', cor: '#7fb2ff' },
    { id: 'cardio', nome: 'Cardio', cor: '#59c9a5' },
    { id: 'outro', nome: 'Outro', cor: '#a78bfa' },
  ];
  const CAT_EX_MAP = Object.fromEntries(CAT_EX.map((c) => [c.id, c]));
  const EX_SUGESTOES = {
    forca: ['Flexão de braço', 'Agachamento', 'Prancha', 'Abdominal', 'Barra fixa', 'Afundo'],
    golpe: ['Uchi mata (entrada)', 'Seoi nage (entrada)', 'O soto gari', 'De ashi barai', 'Raspagem', 'Passagem de guarda'],
    mobilidade: ['Mobilidade de quadril', 'Mobilidade de ombro', 'Ponte', 'Rolamento'],
    cardio: ['Polichinelo', 'Burpee', 'Corda', 'Corrida leve', 'Escada'],
    outro: ['Elástico', 'Kettlebell', 'Uchikomi em dupla'],
  };
  const isEx = (id) => typeof id === 'string' && id.indexOf('cx-') === 0;
  const exercicios = () => (Array.isArray(db.exercicios) ? db.exercicios : []);

  /* aceita exercícios de backup antigo/estranho sem quebrar a tela */
  function normalizaExercicios(lista) {
    if (!Array.isArray(lista)) return [];
    return lista
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({
        id: isEx(e.id) ? e.id : 'cx-' + uid(),
        nome: String(e.nome || '').slice(0, 40),
        cat: CAT_EX_MAP[e.cat] ? e.cat : 'outro',
        dica: String(e.dica || '').slice(0, 80),
        criado: Number(e.criado) || Date.now(),
      }))
      .filter((e) => e.nome);
  }

  /* resolve id → técnica do catálogo ou exercício do perfil, num formato só */
  function tecById(id) {
    if (TEC_MAP[id]) return TEC_MAP[id];
    const e = exercicios().find((x) => x.id === id);
    if (!e) return null;
    const c = CAT_EX_MAP[e.cat] || CAT_EX[CAT_EX.length - 1];
    return { id: e.id, nome: e.nome, jp: '', sub: null, cat: c.nome, catId: c.id, cor: c.cor, dica: e.dica || '', custom: true };
  }
  const tecSub = (t) => (t && t.cat) || SUB_NOME[(t && t.sub) || ''] || '';

  const mmss = (sec) => {
    const s = Math.max(0, Math.round(sec));
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  };
  const durText = (sec) => {
    const s = Math.round(Number(sec) || 0);
    if (!s) return '—';
    if (s < 60) return s + 's';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? h + 'h ' + pad2(r) : h + 'h';
  };
  const dayKey = (d) => {
    const x = new Date(d);
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
  };
  const somaDur = (blocos) => (blocos || []).reduce((a, b) => a + (Number(b.dur) || 0), 0);

  function toast(msg) {
    const el = $('#toast');
    if (document.body.classList.contains('locked')) return; // nada sobre a tela de entrada
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Boa madrugada';
    if (h < 12) return 'Bom dia';
    if (h < 19) return 'Boa tarde';
    return 'Boa noite';
  }

  /* ---------------------------------------------------------------- áudio */
  let AC = null;
  function ensureAudio() {
    if (!AC) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try { AC = new Ctx(); } catch (e) { return null; }
    }
    if (AC.state === 'suspended') AC.resume().catch(() => {});
    return AC;
  }
  function beep(freq, dur, vol, delay, type) {
    if (!db.config.som) return;
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + (delay || 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(vol || 0.2, 0.0002), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.12));
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + (dur || 0.12) + 0.03);
  }
  // tique de contagem: 3 → 2 → 1 sobe de tom
  function cueTick(sec) { beep(600 + (3 - sec) * 110, 0.06, 0.17); }
  function cuePrepStart() { beep(440, 0.09, 0.14); }
  function cueBlockStart() { beep(660, 0.1, 0.22); beep(990, 0.14, 0.2, 0.11); }
  function cueBlockEnd() { beep(784, 0.12, 0.24); beep(1046, 0.18, 0.22, 0.12); }
  function cueFinish() { beep(880, 0.12, 0.24); beep(1174, 0.12, 0.22, 0.14); beep(1568, 0.26, 0.22, 0.28); }
  function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

  /* ---------------------------------------------------------------- store */
  const LS_LEGACY = 'tatame.v1';
  const LS_ACTIVE = 'tatame.chave';
  const LS_PERFIS = 'tatame.perfis';
  const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const DEFAULT_DB = {
    version: 2,
    perfil: null,
    treinos: [],
    sessoes: [],
    tecnicas: {},
    exercicios: [],
    config: { prep: 10, som: true },
  };

  const novaChave = () => {
    let s = '';
    for (let i = 0; i < 8; i++) s += ALFA[(Math.random() * ALFA.length) | 0];
    return 'TATAME-' + s.slice(0, 4) + '-' + s.slice(4);
  };
  function normalizaChave(raw) {
    const s = String(raw || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/^TATAME/, '');
    // aceita qualquer chave de 8 caracteres (0/1/O/I inclusos) para não travar
    // quem digitou uma chave antiga ou importada; a geração usa alfabeto seguro
    if (s.length !== 8) return null;
    return 'TATAME-' + s.slice(0, 4) + '-' + s.slice(4);
  }
  const storeKey = (chave) => 'tatame.v1:' + chave;

  function lerPerfis() {
    try {
      const l = JSON.parse(localStorage.getItem(LS_PERFIS) || '[]');
      return Array.isArray(l) ? l.filter((p) => p && p.chave) : [];
    } catch (e) {
      return [];
    }
  }
  function gravaPerfis(l) {
    try { localStorage.setItem(LS_PERFIS, JSON.stringify(l.slice(0, 12))); } catch (e) {}
  }
  function guardaPerfil(p) {
    if (!p || !p.chave) return;
    const l = lerPerfis().filter((x) => x.chave !== p.chave);
    l.unshift({ chave: p.chave, nome: p.nome || '', ultimo: p.ultimo || Date.now() });
    gravaPerfis(l);
  }
  function legadoBruto() {
    try {
      const raw = localStorage.getItem(LS_LEGACY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || (!(p.treinos || []).length && !(p.sessoes || []).length)) return null;
      return raw;
    } catch (e) {
      return null;
    }
  }

  function loadDb(chave) {
    const base = clone(DEFAULT_DB);
    base.perfil = chave ? { chave, nome: '', criado: Date.now() } : null;
    if (!chave) return base;
    try {
      const raw = localStorage.getItem(storeKey(chave));
      if (!raw) return base;
      const p = JSON.parse(raw);
      return {
        version: 2,
        perfil: Object.assign({ chave, nome: '', criado: Date.now() }, p.perfil || {}, { chave }),
        treinos: Array.isArray(p.treinos) ? p.treinos : [],
        sessoes: Array.isArray(p.sessoes) ? p.sessoes : [],
        tecnicas: p.tecnicas && typeof p.tecnicas === 'object' ? p.tecnicas : {},
        exercicios: normalizaExercicios(p.exercicios),
        config: Object.assign({}, DEFAULT_DB.config, p.config || {}),
      };
    } catch (e) {
      return base;
    }
  }
  function saveDb() {
    if (!db || !db.perfil || !db.perfil.chave) return;
    try {
      localStorage.setItem(storeKey(db.perfil.chave), JSON.stringify(db));
      guardaPerfil({ chave: db.perfil.chave, nome: db.perfil.nome, ultimo: Date.now() });
    } catch (e) {
      toast('Não consegui salvar no dispositivo.');
    }
  }

  let db = clone(DEFAULT_DB);
  let perfilAtivo = null;

  /* --------------------------------------------------------------- perfis */
  const initials = (nome) =>
    (String(nome || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('') || 'T').toUpperCase();

  function gateHtml() {
    const perfis = lerPerfis().slice(0, 4);
    const temLegado = !!legadoBruto();
    return `
      <div class="gate-wrap">
        <div class="gw-left">
        <div class="gate-brand">
          <span class="brand-mark">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <defs>
                <linearGradient id="ggold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#f8e3a6"/>
                  <stop offset="55%" stop-color="#e8c063"/>
                  <stop offset="100%" stop-color="#b8863a"/>
                </linearGradient>
              </defs>
              <rect x="1.2" y="1.2" width="37.6" height="37.6" rx="11" fill="none" stroke="url(#ggold)" stroke-width="1.6" opacity=".7"/>
              <path d="M12.5 13.2h15M20 13.2v13.4M14.6 26.6h10.8" fill="none" stroke="url(#ggold)" stroke-width="2.6" stroke-linecap="round"/>
              <circle cx="20" cy="10.2" r="2.5" fill="url(#ggold)"/>
            </svg>
          </span>
          <span class="brand-text"><strong>Tatame</strong><span>treino de judô</span></span>
        </div>

        <p class="kicker">cada um no seu tatame</p>
        <h1>Quem está<br>treinando?</h1>
        <p class="gate-sub">Sua chave abre o seu tatame neste aparelho: treinos, histórico e técnicas ficam só com você.</p>
        </div>
        <div class="gw-right">

        ${
          perfis.length
            ? `<div class="gate-profiles">
                <span class="lbl">Continuar como</span>
                <div class="gp-row">
                  ${perfis
                    .map(
                      (x) => `<button class="gp" data-action="gate-perfil" data-chave="${x.chave}">
                        <span class="gp-avatar">${esc(initials(x.nome || 'Judoca'))}</span>
                        <span class="gp-txt"><b>${esc(x.nome || 'Judoca')}</b><small>${x.chave}</small></span>
                        <span class="gp-go">→</span>
                      </button>`
                    )
                    .join('')}
                </div>
              </div>`
            : ''
        }

        <div class="gate-card">
          <label class="lbl" for="gate-nome">Seu nome</label>
          <input id="gate-nome" type="text" placeholder="Como te chamam no dojo" autocomplete="off" maxlength="28">
          <button class="btn primary block" data-action="gate-criar">Criar minha chave</button>

          <div class="gate-or"><span>ou entre com a sua</span></div>

          <div class="gate-keyrow">
            <input id="gate-chave" type="text" placeholder="TATAME-XXXX-XXXX" autocomplete="off" spellcheck="false" autocapitalize="characters" maxlength="20">
            <button class="btn ghost" data-action="gate-entrar">Entrar</button>
          </div>
          ${temLegado ? '<p class="gate-legacy">Achei treinos salvos neste aparelho — ao criar sua chave, eles vêm junto.</p>' : ''}
        </div>

        <button class="gate-import" data-action="gate-importar">Restaurar de um backup</button>
        <p class="gate-foot">offline · sem servidor · tudo neste aparelho</p>
        </div>
      </div>
      <input type="file" id="gate-file" accept="application/json" hidden>`;
  }

  function abrirGate() {
    const g = $('#gate');
    if (!g) return;
    const t = $('#toast');
    if (t) t.classList.remove('show'); // toast do app não entra na tela de entrada
    g.hidden = false;
    g.innerHTML = gateHtml();
    document.body.classList.add('locked');
    const inp = $('#gate-nome');
    if (inp && !lerPerfis().length) setTimeout(() => inp.focus(), 200);
  }
  function fecharGate() {
    const g = $('#gate');
    if (g) {
      g.hidden = true;
      g.innerHTML = '';
    }
    document.body.classList.remove('locked');
  }

  function entrar(chave, opts) {
    opts = opts || {};
    const k = normalizaChave(chave);
    if (!k) return false;
    perfilAtivo = k;
    db = loadDb(k);
    if (!db.perfil.nome && opts.nome) db.perfil.nome = String(opts.nome).trim().slice(0, 28);
    db.perfil.chave = k;
    try { localStorage.setItem(LS_ACTIVE, k); } catch (e) {}
    saveDb();
    fecharGate();
    ui.sheet = null;
    ui.view = 'treinar';
    render();
    scrollTop();
    return true;
  }

  function sairDoPerfil() {
    try { localStorage.removeItem(LS_ACTIVE); } catch (e) {}
    perfilAtivo = null;
    db = clone(DEFAULT_DB);
    closeSheet();
    abrirGate();
  }

  function criarPerfil() {
    const nomeEl = $('#gate-nome');
    const nome = nomeEl ? nomeEl.value.trim().slice(0, 28) : '';
    const chave = novaChave();
    const legado = legadoBruto();
    if (legado) {
      try {
        localStorage.setItem(storeKey(chave), legado);
        localStorage.removeItem(LS_LEGACY);
      } catch (e) {}
    }
    entrar(chave, { nome });
    toast(legado ? 'Chave criada · seus treinos vieram junto' : 'Chave criada · guarde ela com você');
    openSheet({ type: 'perfil', novo: true });
  }

  function entrarComChave() {
    const el = $('#gate-chave');
    const k = normalizaChave(el ? el.value : '');
    if (!k) return toast('Chave inválida. Ela tem o formato TATAME-XXXX-XXXX.');
    const conhecida = lerPerfis().some((p) => p.chave === k);
    if (!conhecida) {
      const vazio = !localStorage.getItem(storeKey(k));
      if (vazio) {
        entrar(k);
        toast('Chave nova neste aparelho · restaure o backup para trazer seus treinos');
        return;
      }
    }
    entrar(k);
    toast('Bem-vindo de volta');
  }

  function perfilHtml() {
    const p = db.perfil || { chave: '', nome: '' };
    const treinos = db.treinos.length;
    const sessoes = db.sessoes.length;
    const min = Math.round(db.sessoes.reduce((a, x) => a + (Number(x.dur) || 0), 0) / 60);
    const desde = p.criado ? new Date(p.criado).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '') : '—';
    return sheetShell(
      'Seu tatame',
      `
      <div class="perfil-top">
        <div class="p-avatar">${esc(initials(p.nome || 'Judoca'))}</div>
        <div style="flex:1;min-width:0">
          <label class="lbl" for="perfil-nome">Nome</label>
          <input id="perfil-nome" type="text" data-field="perfil-nome" value="${esc(p.nome || '')}" placeholder="Como te chamam no dojo" maxlength="28">
          <p class="tiny muted" style="margin-top:6px">no tatame desde ${desde}</p>
        </div>
      </div>

      <div class="key-box">
        <span class="kb-lbl">sua chave</span>
        <b id="chave-txt">${esc(p.chave)}</b>
        <button class="btn ghost sm" data-action="copiar-chave">Copiar</button>
      </div>
      <p class="tiny muted key-hint">Anote esta chave. Ela abre o seu tatame neste aparelho e identifica o seu backup — para trocar de celular, use <b>Progresso → Exportar dados</b> e restaure na tela de entrada.</p>

      <div class="perfil-stats">
        <div><b>${treinos}</b><span>treinos</span></div>
        <div><b>${sessoes}</b><span>sessões</span></div>
        <div><b>${min}</b><span>minutos</span></div>
      </div>
      `,
      `
      <button class="btn ghost" data-action="sair-perfil">Sair</button>
      <button class="btn primary" data-action="fechar-sheet">Fechar</button>
      `
    );
  }

  /* --------------------------------------------------------------- estado */
  const ui = {
    view: 'treinar',
    busca: '',
    grupo: 'todas',
    sheet: null,
    mood: 0,
  };
  let draft = null;
  let pickerQ = '';

  /* ----------------------------------------------------------- estatística */
  function computeStreak() {
    const dias = new Set(db.sessoes.map((s) => dayKey(s.fim)));
    if (!dias.size) return 0;
    const d = new Date();
    if (!dias.has(dayKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (dias.has(dayKey(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }
  function totalMinutos() {
    return Math.round(db.sessoes.reduce((a, s) => a + (Number(s.dur) || 0), 0) / 60);
  }
  function minutosSemana() {
    const limite = Date.now() - 7 * 864e5;
    return Math.round(db.sessoes.filter((s) => s.fim >= limite).reduce((a, s) => a + (Number(s.dur) || 0), 0) / 60);
  }
  function ultimaSessao() {
    return db.sessoes[0] || null;
  }
  function tecStatus(id) {
    const t = db.tecnicas[id];
    return (t && t.s) || 'novo';
  }


  /* ---------------------------------------------------------------- icons */
  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 5.4v13.2L19 12z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.6" y="4.6" width="4" height="14.8" rx="1.4" fill="currentColor"/><rect x="13.4" y="4.6" width="4" height="14.8" rx="1.4" fill="currentColor"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14M19.5 5.5L10 12l9.5 6.5z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 5v14M4.5 5.5L14 12l-9.5 6.5z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12.6 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2.6L5.3 13.4h5.3l-.7 8 8-10.9h-5.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.7 12.6V6.3a1.55 1.55 0 013.1 0v5M10.8 11V4.9a1.55 1.55 0 013.1 0v6.2M13.9 12V6.7a1.55 1.55 0 013.1 0v6.8c0 4.2-2.6 6.9-6.3 6.9-3.1 0-5.3-1.8-6.2-5.1l-.9-3.3a1.45 1.45 0 012.7-.9l.9 2.1" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    mat: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9.4 3.7v16.6M14.6 3.7v16.6M3.7 9.4h16.6M3.7 14.6h16.6" stroke="currentColor" stroke-width="1" opacity=".5"/></svg>',
    dumbbell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.2v5.6M7.2 7v10M16.8 7v10M20 9.2v5.6M7.2 12h9.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    infinity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 9.2a2.8 2.8 0 000 5.6c2.5 0 3.4-2.8 5.4-2.8s2.9 2.8 5.4 2.8a2.8 2.8 0 000-5.6c-2.5 0-3.4 2.8-5.4 2.8s-2.9-2.8-5.4-2.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.2 2.6c.3 3.1 2.6 4.1 3.9 6.1a6.6 6.6 0 01-2.1 9.2 6.4 6.4 0 01-9-2.2c-.9-1.5-1-3.4-.3-5 1 1 1.7 1.3 2.5 1.2-.7-3.4.9-6.4 5-9.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.6V12l3 2.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    sessions: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.6" y="5.2" width="16.8" height="15" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.8 9.8h16.4M8.2 3.4v3.2M15.8 3.4v3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l1.8 5.2 5.2 1.8-5.2 1.8L12 17.4l-1.8-5.2L5 10.4l5.2-1.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 4.9A1.9 1.9 0 017.4 3H18a1 1 0 011 1v16a1 1 0 01-1 1H7.4a1.9 1.9 0 01-1.9-1.9z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 8h6M9 12h6M9 16h3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  };

  const MODEL_ACCENT = ['#e8c063', '#7fb2ff', '#59d0a4', '#ff9e5e', '#b6d45b', '#ff4b6d'];
  const ACENTOS = [
    { cor: '#e8c063', nome: 'Ouro' },
    { cor: '#ff6b57', nome: 'Fogo' },
    { cor: '#7fb2ff', nome: 'Gelo' },
    { cor: '#59d0a4', nome: 'Mata' },
    { cor: '#c9a2ff', nome: 'Lilás' },
    { cor: '#8b93a1', nome: 'Grafite' },
  ];
  const PREPS = [0, 3, 5, 10, 15, 20, 30];
  const DUR_QUICK = [30, 60, 180, 300, 480, 600, 900, 1200];

  /* -------------------------------------------------------------- helpers */
  function lighten(hex, amt) {
    const h = String(hex || '#ffffff').replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    const mix = (v) => Math.round(v + (255 - v) * amt);
    return '#' + [mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function timelineHtml(blocos) {
    const list = blocos && blocos.length ? blocos : [];
    if (!list.length) return '';
    return `<div class="timeline">${list
      .map((b, i) => {
        const tp = TIPO[b.tipo] || TIPO.outro;
        const peso = b.modo === 'manual' ? 1 : Math.max(1, (Number(b.dur) || 0) / 60);
        return `<span class="seg" style="--c:${tp.cor};--i:${i};flex-grow:${peso.toFixed(2)}"></span>`;
      })
      .join('')}</div>`;
  }

  function fmtMin(v) {
    const n = Math.max(0, Math.round(v));
    if (n < 60) return `${n}<small>min</small>`;
    return `${Math.floor(n / 60)}<small>h</small> ${pad2(n % 60)}<small>min</small>`;
  }

  function animateCounts() {
    const els = $$('[data-count]');
    if (!els.length) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    els.forEach((el) => {
      const target = Number(el.dataset.count) || 0;
      const fmt = el.dataset.fmt || 'int';
      const paint = (v) => { el.innerHTML = fmt === 'min' ? fmtMin(v) : String(Math.round(v)); };
      if (reduce || !target) { paint(target); return; }
      const dur = 900;
      const t0 = performance.now();
      paint(0);
      const step = (t) => {
        if (!el.isConnected) return;
        const k = Math.min(1, (t - t0) / dur);
        paint(target * (1 - Math.pow(1 - k, 2.6)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function updateTabInk() {
    const ink = $('#tab-ink');
    const nav = $('.tabbar');
    const active = $('.tab.is-active');
    if (!ink || !nav || !active) return;
    const n = nav.getBoundingClientRect();
    const r = active.getBoundingClientRect();
    ink.style.width = r.width + 'px';
    ink.style.height = r.height + 'px';
    ink.style.transform = `translate(${Math.round(r.left - n.left)}px, ${Math.round(r.top - n.top)}px)`;
  }

  /* ---------------------------------------------------------------- views */
  const VIEWS = {};
  let ACTIONS = {};

  VIEWS.treinar = function () {
    const ult = ultimaSessao();
    const semana = minutosSemana();
    const streak = computeStreak();
    const totalSessoes = db.sessoes.length;

    const quick = [
      { nome: 'Uchikomi', dur: '5 min', tipo: 'uchikomi', seg: 300, icon: 'grip', foco: 'Entradas em velocidade, sem queda. 3 séries de 10 de cada lado.' },
      { nome: 'Randori', dur: '5 min', tipo: 'randori', seg: 300, icon: 'bolt', foco: 'Ritmo de competição. Ataque sempre.' },
      { nome: 'Ne-waza', dur: '5 min', tipo: 'newaza', seg: 300, icon: 'mat', foco: 'Luta no chão começando sentado.' },
      { nome: 'Físico', dur: '10 min', tipo: 'fisico', seg: 600, icon: 'dumbbell', foco: 'Circuito: agachamento, flexão, prancha e corda.' },
    ];

    const modelos = MODELOS.map(
      (m, i) => `
      <button class="model" data-action="modelo" data-i="${i}" style="--i:${i};--c:${MODEL_ACCENT[i % MODEL_ACCENT.length]}">
        <span class="m-kicker">Modelo ${pad2(i + 1)}</span>
        <strong>${esc(m.nome)}</strong>
        <span class="m-desc">${esc(m.descricao)}</span>
        <span class="m-foot"><span>${durText(somaDur(m.blocos))} · ${m.blocos.length} blocos</span><b>usar →</b></span>
      </button>`
    ).join('');

    return `
    <div class="page">
      <section class="hero">
        <p class="kicker">${greeting()}</p>
        <h1>${ult ? 'Bora treinar?' : 'Seu tatame,<br>seu plano.'}</h1>
        <p class="hero-sub">${
          ult
            ? `Último treino: <b>${esc(ult.nome)}</b> · ${fmtData(ult.fim)}. ${semana ? `São <b>${semana} min</b> nos últimos 7 dias.` : 'Bora abrir a semana.'}`
            : 'Monte o treino do jeito que você treina, aperte play e execute. O relógio é meu problema — o judô é seu.'
        }</p>
        <div class="hero-chips">
          <span class="chip-stat ${streak ? 'hot' : ''}">${ICON.flame}<b>${streak}</b> dia${streak === 1 ? '' : 's'} seguido${streak === 1 ? '' : 's'}</span>
          <span class="chip-stat">${ICON.clock}<b>${semana}</b> min / 7 dias</span>
          <span class="chip-stat">${ICON.sessions}<b>${totalSessoes}</b> sessões</span>
        </div>
      </section>

      <div class="quick-grid">
        ${quick
          .map(
            (q, i) => `
          <button class="quick" style="--i:${i};--c:${(TIPO[q.tipo] || TIPO.outro).cor}" data-action="quick" data-nome="${esc(q.nome)}" data-tipo="${q.tipo}" data-dur="${q.seg}" data-foco="${esc(q.foco)}">
            <span class="q-ico">${ICON[q.icon]}</span>
            <span class="q-body"><b>${q.nome}</b><span>${q.dur}</span></span>
          </button>`
          )
          .join('')}
        <button class="quick free" style="--i:4" data-action="quick" data-nome="Treino livre" data-tipo="outro" data-dur="0" data-livre="1">
          <span class="q-ico">${ICON.infinity}</span>
          <span class="q-body"><b>Treino livre</b><span>cronômetro aberto</span></span>
        </button>
      </div>

      <section class="section">
        <div class="section-head">
          <h2>Meus treinos</h2>
          <button class="btn ghost sm" data-action="novo-treino">${ICON.plus} Novo</button>
        </div>
        ${
          db.treinos.length
            ? `<div class="card-grid">${db.treinos.map(treinoCard).join('')}</div>`
            : `<div class="empty">
                 <div class="e-mark">${ICON.spark}</div>
                 <h3>Nenhum treino ainda</h3>
                 <p>Comece por um modelo pronto ou monte o seu: bloque a bloque, com tempo e foco.</p>
                 <button class="btn primary sm" data-action="novo-treino">${ICON.plus} Criar meu primeiro treino</button>
               </div>`
        }
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Modelos prontos</h2>
          <span class="hint">toque para usar</span>
        </div>
        <div class="rail">${modelos}</div>
      </section>
    </div>`;
  };

  function treinoCard(t, i) {
    const total = somaDur(t.blocos);
    const tipos = [...new Set((t.blocos || []).map((b) => b.tipo))].slice(0, 4);
    const nTec = new Set((t.blocos || []).flatMap((b) => b.tecnicas || [])).size;
    return `
      <article class="treino-card" style="--i:${i || 0};--tc:${t.cor || '#e8c063'}">
        <div class="tc-head">
          <div class="tc-main" data-action="editar-treino" data-id="${t.id}">
            <h3>${esc(t.nome)}</h3>
            ${t.descricao ? `<p class="tc-desc">${esc(t.descricao)}</p>` : ''}
            <div class="tc-meta">
              <span>${(t.blocos || []).length} blocos</span>
              <i class="dot-sep"></i>
              <span>${total ? durText(total) : 'livre'}</span>
              ${nTec ? `<i class="dot-sep"></i><span>${nTec} técnicas</span>` : ''}
            </div>
          </div>
          <button class="play-btn" data-action="iniciar-treino" data-id="${t.id}" aria-label="Iniciar ${esc(t.nome)}">${ICON.play}</button>
        </div>
        ${timelineHtml(t.blocos)}
        <div class="tc-foot">
          <div class="tags">
            ${tipos
              .map((id) => {
                const tp = TIPO[id] || TIPO.outro;
                return `<span class="tag" style="color:${tp.cor}"><i class="dot"></i>${esc(tp.nome)}</span>`;
              })
              .join('')}
          </div>
        </div>
      </article>`;
  }
  VIEWS.treinos = function () {
    const lista = db.treinos;
    const modelos = MODELOS.map(
      (m, i) => `
      <button class="model" data-action="modelo" data-i="${i}" style="--i:${i};--c:${MODEL_ACCENT[i % MODEL_ACCENT.length]}">
        <span class="m-kicker">Modelo ${pad2(i + 1)}</span>
        <strong>${esc(m.nome)}</strong>
        <span class="m-desc">${esc(m.descricao)}</span>
        <span class="m-foot"><span>${durText(somaDur(m.blocos))}</span><b>usar →</b></span>
      </button>`
    ).join('');

    return `
    <div class="page">
      <section class="hero">
        <p class="kicker">seu acervo</p>
        <h1>Treinos</h1>
        <p class="hero-sub">Cada treino é uma sequência de blocos com tempo. Toque no cartão para editar, ou no ▶ para começar.</p>
        <div class="hero-chips">
          <span class="chip-stat">${ICON.sessions}<b>${lista.length}</b> treino${lista.length === 1 ? '' : 's'}</span>
          <span class="chip-stat">${ICON.clock}<b>${Math.round(lista.reduce((a, t) => a + somaDur(t.blocos), 0) / 60)}</b> min no total</span>
        </div>
      </section>

      <div class="stack" style="margin-top:22px">
        <button class="btn primary block" data-action="novo-treino">${ICON.plus} Novo treino</button>
      </div>

      <section class="section">
        <div class="section-head"><h2>Seus treinos</h2><span class="hint">${lista.length} no acervo</span></div>
        ${
          lista.length
            ? `<div class="card-grid">${lista.map(treinoCard).join('')}</div>`
            : `<div class="empty"><div class="e-mark">${ICON.spark}</div><h3>Nada por aqui</h3><p>Crie um treino do zero ou use um modelo na aba Treinar.</p></div>`
        }
      </section>

      <section class="section">
        <div class="section-head"><h2>Modelos</h2><span class="hint">viram cópia editável</span></div>
        <div class="rail">${modelos}</div>
      </section>
    </div>`;
  };

  VIEWS.tecnicas = function () {
    const grupos = [{ id: 'todas', nome: 'Todas' }].concat(GRUPOS.map((g) => ({ id: g.id, nome: g.nome })));
    const q = ui.busca.trim().toLowerCase();
    const filtradas = TECNICAS.filter((t) => {
      if (ui.grupo !== 'todas' && t.grupo !== ui.grupo) return false;
      if (!q) return true;
      return (t.nome + ' ' + t.jp + ' ' + (t.dica || '') + ' ' + SUB_NOME[t.sub]).toLowerCase().includes(q);
    });

    const afinadas = TECNICAS.filter((t) => tecStatus(t.id) === 'afinada').length;
    const estudando = TECNICAS.filter((t) => tecStatus(t.id) === 'estudando').length;

    const meus = exercicios().filter(
      (e) => !q || (e.nome + ' ' + (e.dica || '') + ' ' + ((CAT_EX_MAP[e.cat] || {}).nome || '')).toLowerCase().includes(q)
    );

    let corpo = '';
    if (!filtradas.length) {
      corpo = `<div class="empty"><div class="e-mark">${ICON.book}</div><h3>Nenhuma técnica encontrada</h3><p>Tente outro nome, kanji ou pedaço da dica.</p></div>`;
    } else {
      GRUPOS.forEach((g) => {
        const doGrupo = filtradas.filter((t) => t.grupo === g.id);
        if (!doGrupo.length) return;
        corpo += `<div class="grupo-title">${esc(g.nome)} · ${g.subs.length} grupos</div>`;
        g.subs.forEach((sub) => {
          const itens = doGrupo.filter((t) => t.sub === sub.id);
          if (!itens.length) return;
          corpo += `<div class="sub-title">${esc(sub.nome)}</div>
          <div class="tec-list">${itens.map(tecRow).join('')}</div>`;
        });
      });
    }

    return `
    <div class="page">
      <section class="hero">
        <p class="kicker">go kyo</p>
        <h1>Repertório</h1>
        <p class="hero-sub">${TECNICAS.length} técnicas com kanji e uma dica prática cada. Marque o que você está estudando e o que já está afiado.</p>
        <div class="hero-chips">
          <span class="chip-stat">${ICON.book}<b>${TECNICAS.length}</b> no repertório</span>
          <span class="chip-stat hot">${ICON.spark}<b>${afinadas}</b> afinadas</span>
          <span class="chip-stat"><b style="color:var(--blue)">${estudando}</b> estudando</span>
          <span class="chip-stat">${ICON.bolt}<b>${exercicios().length}</b> seus</span>
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Meus exercícios</h2>
          <button class="btn ghost sm" data-action="novo-exercicio">${ICON.plus} Criar</button>
        </div>
        ${
          exercicios().length
            ? `<p class="sec-sub">Flexão, agachamento, prancha, o golpe que você está montando: cria uma vez e usa em qualquer treino.</p>
               ${
                 meus.length
                   ? `<div class="tec-list">${meus.map(exRow).join('')}</div>`
                   : `<div class="empty"><div class="e-mark">${ICON.bolt}</div><h3>Nada com esse nome</h3><p>Nenhum exercício seu bate com “${esc(ui.busca)}”.</p></div>`
               }`
            : `<div class="empty ex-empty">
                 <div class="e-mark">${ICON.bolt}</div>
                 <h3>Crie o seu primeiro exercício</h3>
                 <p>Flexão, agachamento, prancha, corda, o golpe novo que você está treinando. Ele entra nos blocos como qualquer técnica — com tempo, repetições e histórico.</p>
                 <div class="ex-quick">
                   ${['Flexão de braço', 'Agachamento', 'Prancha', 'Polichinelo']
                     .map((x) => `<button class="chip" data-action="novo-exercicio" data-nome="${esc(x)}">+ ${esc(x)}</button>`)
                     .join('')}
                 </div>
                 <button class="btn primary sm" data-action="novo-exercicio">${ICON.plus} Criar exercício</button>
               </div>`
        }
      </section>

      <div class="search-row">
        <svg class="search-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M16.2 16.2L20.5 20.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
        <input class="search" id="busca-tec" type="search" placeholder="Buscar técnica, exercício, kanji ou dica..." value="${esc(ui.busca)}">
      </div>

      <div class="chip-row">
        ${grupos.map((g) => `<button class="chip ${ui.grupo === g.id ? 'on' : ''}" data-action="filtro-grupo" data-g="${g.id}">${esc(g.nome)}</button>`).join('')}
      </div>

      ${corpo}
    </div>`;
  };

  function tecRow(t) {
    const st = tecStatus(t.id);
    return `
      <button class="tec-row" data-action="abrir-tec" data-id="${t.id}">
        <i class="status-dot ${st}"></i>
        <span class="t-body">
          <h4><span class="t-name">${esc(t.nome)}</span></h4>
          <p>${esc(tecSub(t))}</p>
        </span>
        <span class="kanji-mark" aria-hidden="true">${esc((t.jp || '').slice(0, 2))}</span>
      </button>`;
  }

  /* linha de exercício personalizado (categoria colorida em vez de kanji) */
  function exRow(e) {
    const st = tecStatus(e.id);
    const c = CAT_EX_MAP[e.cat] || CAT_EX[CAT_EX.length - 1];
    return `
      <button class="tec-row" data-action="abrir-exercicio" data-id="${e.id}">
        <i class="status-dot ${st}"></i>
        <span class="t-body">
          <h4><span class="t-name">${esc(e.nome)}</span></h4>
          <p>${esc(c.nome)}${e.dica ? ' · ' + esc(e.dica) : ''}</p>
        </span>
        <span class="kanji-mark ex-mark" style="--c:${c.cor}" aria-hidden="true">${esc(initials(e.nome))}</span>
      </button>`;
  }

  VIEWS.progresso = function () {
    const total = db.sessoes.length;
    const minutos = totalMinutos();
    const streak = computeStreak();
    const semana = minutosSemana();
    const meta = 300;
    const pct = Math.min(1, semana / meta);
    const R = 40;
    const C = 2 * Math.PI * R;
    const afinadas = TECNICAS.filter((t) => tecStatus(t.id) === 'afinada').length;
    const media = total ? Math.round(minutos / total) : 0;

    const dias = [];
    const porDia = {};
    db.sessoes.forEach((s) => {
      const k = dayKey(s.fim);
      porDia[k] = (porDia[k] || 0) + (Number(s.dur) || 0);
    });
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = dayKey(d);
      dias.push({ k, d, sec: porDia[k] || 0 });
    }
    const maxSec = Math.max(1, ...dias.map((x) => x.sec));
    const hoje = dayKey(new Date());

    const hist = db.sessoes.slice(0, 40);
    const mov = ['', '😖', '😕', '🙂', '😃', '🤩'];

    return `
    <div class="page">
      <section class="hero">
        <p class="kicker">sua evolução</p>
        <h1>Progresso</h1>
        <p class="hero-sub">${total ? 'Cinco minutos contam. O que você registra vira padrão.' : 'Seu histórico começa no primeiro treino concluído.'}</p>
      </section>

      <div class="stat-hero">
        <div>
          <div class="sh-label">no tatame</div>
          <div class="sh-value"><b data-count="${minutos}" data-fmt="min">0</b></div>
          <div class="sh-sub">${total} ${total === 1 ? 'sessão registrada' : 'sessões registradas'} · meta ${meta} min/semana</div>
        </div>
        <div class="sh-ring" title="Meta semanal: ${meta} minutos">
          <svg viewBox="0 0 92 92" aria-hidden="true">
            <defs>
              <linearGradient id="gr2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#f8e3a6"/>
                <stop offset="100%" stop-color="#e8c063"/>
              </linearGradient>
            </defs>
            <circle class="rc-bg" cx="46" cy="46" r="${R}"/>
            <circle class="rc-fg" cx="46" cy="46" r="${R}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-ring="${(C * (1 - pct)).toFixed(1)}"/>
          </svg>
          <span>${Math.round(pct * 100)}%</span>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat ${streak ? 'accent' : ''}" style="--i:0">
          <div class="s-top">${ICON.flame}<span class="label">Sequência</span></div>
          <div class="value"><b data-count="${streak}">0</b><small>dia${streak === 1 ? '' : 's'}</small></div>
          <div class="foot">${streak ? 'não quebre o ritmo' : 'treine hoje para começar'}</div>
        </div>
        <div class="stat" style="--i:1">
          <div class="s-top">${ICON.sessions}<span class="label">Sessões</span></div>
          <div class="value"><b data-count="${total}">0</b></div>
          <div class="foot">${semana} min em 7 dias</div>
        </div>
        <div class="stat" style="--i:2">
          <div class="s-top">${ICON.clock}<span class="label">Média</span></div>
          <div class="value"><b data-count="${media}">0</b><small>min</small></div>
          <div class="foot">por sessão</div>
        </div>
        <div class="stat" style="--i:3">
          <div class="s-top">${ICON.spark}<span class="label">Afinadas</span></div>
          <div class="value"><b data-count="${afinadas}">0</b></div>
          <div class="foot">técnicas no ponto</div>
        </div>
      </div>

      <section class="section">
        <div class="section-head"><h2>Últimos 14 dias</h2><span class="hint">minutos por dia</span></div>
        <div class="chart-card">
          <div class="chart">
            ${dias
              .map(
                (x, i) => `
              <div class="bar-wrap">
                <div class="bar-track">
                  <div class="bar ${x.sec ? '' : 'zero'} ${x.k === hoje ? 'today' : ''}" style="--i:${i};height:${x.sec ? Math.max(6, Math.round((x.sec / maxSec) * 100)) : 2}%" title="${x.sec ? Math.round(x.sec / 60) + ' min' : 'sem treino'}"></div>
                </div>
                <div class="bar-day ${x.k === hoje ? 'today' : ''}">${x.d.getDate()}</div>
              </div>`
              )
              .join('')}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Histórico</h2><span class="hint">${db.sessoes.length} registros</span></div>
        ${
          hist.length
            ? `<div class="hist-list">${hist
                .map(
                  (s, i) => `
              <div class="hist-item" style="--i:${i}">
                <div class="hist-date"><b>${pad2(new Date(s.fim).getDate())}</b>${new Date(s.fim).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</div>
                <div class="hist-body">
                  <h4>${esc(s.nome)}</h4>
                  <p>${s.blocos}/${s.total} blocos${s.nota ? ' · ' + esc(s.nota) : ''}</p>
                </div>
                <span class="hist-mood">${mov[s.mood] || ''}</span>
                <span class="hist-dur">${durText(s.dur)}</span>
                <button class="icon-btn danger" data-action="del-sessao" data-id="${s.id}" aria-label="Apagar registro">${ICON.x}</button>
              </div>`
                )
                .join('')}</div>`
            : `<div class="empty"><div class="e-mark">${ICON.sessions}</div><h3>Sem histórico</h3><p>Quando você concluir um treino, ele aparece aqui com duração e sensação.</p><button class="btn primary sm" data-action="nav" data-view="treinar">Ir treinar</button></div>`
        }
      </section>

      <section class="section">
        <div class="section-head"><h2>Perfil</h2><span class="hint">${esc((db.perfil && db.perfil.nome) || 'sem nome')}</span></div>
        <button class="perfil-row" data-action="perfil">
          <span class="p-avatar">${esc(initials((db.perfil && db.perfil.nome) || 'Judoca'))}</span>
          <span class="pr-txt"><b>Sua chave</b><small>${esc((db.perfil && db.perfil.chave) || '—')}</small></span>
          <span class="pr-go">ver →</span>
        </button>
      </section>

      <section class="section">
        <div class="section-head"><h2>Ajustes</h2><span class="hint">salvos no aparelho</span></div>
        <div class="chart-card" style="padding:18px">
          <div class="row-between">
            <div><div style="font-weight:600;font-size:.88rem">Som do timer</div><div class="tiny muted" style="margin-top:2px">3 · 2 · 1 antes de começar e de acabar</div></div>
            <input type="checkbox" class="switch" id="cfg-som" ${db.config.som ? 'checked' : ''}>
          </div>
          <div class="divider" style="margin:16px 0"></div>
          <div class="field" style="margin-bottom:0">
            <label for="cfg-prep">Preparação padrão (segundos)</label>
            <input class="input" id="cfg-prep" type="number" min="0" max="60" step="5" value="${db.config.prep}">
          </div>
        </div>

        <div class="export-row">
          <button class="btn ghost" data-action="exportar">Exportar dados</button>
          <button class="btn ghost" data-action="importar">Importar</button>
        </div>
        <input type="file" id="file-import" accept="application/json" hidden>
        <button class="btn danger block" style="margin-top:10px" data-action="reset">Apagar tudo</button>
        <p class="tiny muted" style="text-align:center;margin-top:16px">Tatame · dados só no seu aparelho · v2.1</p>
      </section>
    </div>`;
  };

  function semanasAtivas() {
    const semanas = new Set();
    db.sessoes.forEach((s) => {
      const d = new Date(s.fim);
      const umJan = new Date(d.getFullYear(), 0, 1);
      const semana = Math.floor((d - umJan) / 6048e5);
      semanas.add(d.getFullYear() + '-' + semana);
    });
    return semanas.size || 1;
  }

  function fmtData(ts) {
    const d = new Date(ts);
    const hoje = new Date();
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    if (dayKey(d) === dayKey(hoje)) return 'hoje';
    if (dayKey(d) === dayKey(ontem)) return 'ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  /* ------------------------------------------------------------- render */
  function render() {
    const fn = VIEWS[ui.view] || VIEWS.treinar;
    $('#view').innerHTML = fn();
    $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === ui.view));
    const streak = computeStreak();
    const pill = $('#topbar-streak');
    if (pill) pill.textContent = String(streak);
    const unit = $('#streak-unit');
    if (unit) unit.textContent = streak === 1 ? 'dia' : 'dias';
    const av = $('#topbar-avatar');
    if (av) av.textContent = initials((db.perfil && db.perfil.nome) || 'Judoca');
    if (ui.view !== 'tecnicas') ui.busca = '';
    requestAnimationFrame(() => {
      updateTabInk();
      animateCounts();
      $$('[data-ring]').forEach((c) => c.setAttribute('stroke-dashoffset', c.dataset.ring));
    });
  }

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'auto' : 'auto' });
  }

  /* --------------------------------------------------------------- sheet */
  function openSheet(sheet) {
    ui.sheet = sheet;
    renderSheet();
  }
  function closeSheet() {
    ui.sheet = null;
    const layer = $('#sheet');
    layer.hidden = true;
    layer.innerHTML = '';
    document.body.classList.remove('sheet-open');
  }

  function sheetShell(title, body, foot, opts) {
    opts = opts || {};
    return `
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-grip"></div>
        <div class="sheet-head">
          ${opts.back ? '<button class="close-btn" data-action="voltar-editor" aria-label="Voltar">←</button>' : ''}
          <h2>${esc(title)}</h2>
          <button class="close-btn" data-action="fechar-sheet" aria-label="Fechar">✕</button>
        </div>
        <div class="sheet-body">${body}</div>
        ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
      </div>`;
  }

  function renderSheet() {
    const layer = $('#sheet');
    const s = ui.sheet;
    if (!s) {
      layer.hidden = true;
      layer.innerHTML = '';
      document.body.classList.remove('sheet-open');
      return;
    }
    layer.hidden = false;
    document.body.classList.add('sheet-open');
    layer.innerHTML =
      s.type === 'editor'
        ? editorHtml()
        : s.type === 'picker'
        ? pickerHtml()
        : s.type === 'tec'
        ? tecHtml(s.id)
        : s.type === 'ex'
        ? exFormHtml(s)
        : s.type === 'perfil'
        ? perfilHtml()
        : s.type === 'resumo'
        ? resumoHtml(s.data)
        : '';
  }

  /* --------------------------------------------------------- técnica sheet */
  function tecHtml(id) {
    const t = tecById(id);
    if (!t) return '';
    const st = tecStatus(id);
    const reg = db.tecnicas[id] || {};
    return sheetShell(
      'Técnica',
      `
      <div class="tec-hero">
        <div class="jp">${esc(t.jp)}</div>
        <h2>${esc(t.nome)}</h2>
        <div class="grp">${esc(tecSub(t))}</div>
      </div>
      <div class="dica">${esc(t.dica)}</div>

      <div class="flabel">Meu nível</div>
      <div class="status-row">
        <button class="status-opt ${st === 'novo' ? 'on' : ''}" data-action="set-status" data-id="${id}" data-s="novo">Nunca treinei</button>
        <button class="status-opt ${st === 'estudando' ? 'on' : ''}" data-action="set-status" data-id="${id}" data-s="estudando">Estudando</button>
        <button class="status-opt ${st === 'afinada' ? 'on' : ''}" data-action="set-status" data-id="${id}" data-s="afinada">Afinada</button>
      </div>

      <div class="field" style="margin-top:18px">
        <label for="tec-nota">Minhas anotações</label>
        <textarea id="tec-nota" data-tec-nota="${id}" placeholder="Detalhes da sua pegada, ajustes do sensei, o que errou no randori...">${esc(reg.n || '')}</textarea>
      </div>
      `,
      `<button class="btn ghost" data-action="fechar-sheet">Fechar</button>`
    );
  }

  /* ---------------------------------------------------- exercício sheet */
  function exFormHtml(sheet) {
    const e = sheet.id ? exercicios().find((x) => x.id === sheet.id) : null;
    const novo = !e;
    const cat = sheet.cat || (e && e.cat) || 'forca';
    const nomeIni = e ? e.nome : sheet.nome || '';
    const sugestoes = EX_SUGESTOES[cat] || [];
    const st = e ? tecStatus(e.id) : 'novo';
    const reg = e ? db.tecnicas[e.id] || {} : {};
    return sheetShell(
      novo ? 'Novo exercício' : 'Exercício',
      `
      <div class="field">
        <label for="ex-nome">Nome do exercício</label>
        <input id="ex-nome" type="text" maxlength="40" autocomplete="off" data-ex="nome"
          value="${esc(nomeIni)}" placeholder="Ex.: Flexão de braço, agachamento com salto">
      </div>
      ${
        novo
          ? `<div class="ex-sug-row" id="ex-sug">
               ${sugestoes.map((x) => `<button class="chip sm" data-action="ex-sugestao" data-nome="${esc(x)}">${esc(x)}</button>`).join('')}
             </div>`
          : ''
      }
      <span class="lbl">Categoria</span>
      <div class="chip-row" id="ex-cats">
        ${CAT_EX.map((c) => `<button class="chip ${cat === c.id ? 'on' : ''}" data-action="ex-cat" data-cat="${c.id}">${c.nome}</button>`).join('')}
      </div>
      <div class="field">
        <label for="ex-dica">Como executar (opcional)</label>
        <input id="ex-dica" type="text" maxlength="80" data-ex="dica"
          value="${esc(e ? e.dica : '')}" placeholder="Ex.: 3x12 sem apoiar o joelho">
      </div>
      ${
        novo
          ? ''
          : `<div class="flabel">Meu nível</div>
             <div class="status-row">
               <button class="status-opt ${st === 'novo' ? 'on' : ''}" data-action="set-status" data-id="${e.id}" data-s="novo">Nunca fiz</button>
               <button class="status-opt ${st === 'estudando' ? 'on' : ''}" data-action="set-status" data-id="${e.id}" data-s="estudando">Treinando</button>
               <button class="status-opt ${st === 'afinada' ? 'on' : ''}" data-action="set-status" data-id="${e.id}" data-s="afinada">Afinado</button>
             </div>
             <div class="field" style="margin-top:18px">
               <label for="tec-nota">Minhas anotações</label>
               <textarea id="tec-nota" data-tec-nota="${e.id}" placeholder="Carga, séries, o que ajustar na próxima...">${esc(reg.n || '')}</textarea>
             </div>`
      }
      `,
      novo
        ? `<button class="btn ghost" data-action="fechar-sheet">Cancelar</button>
           <button class="btn primary" data-action="criar-exercicio">Criar exercício</button>`
        : `<button class="btn ghost" data-action="excluir-exercicio" data-id="${e.id}">Excluir</button>
           <button class="btn primary" data-action="salvar-exercicio" data-id="${e.id}">Salvar</button>`
    );
  }

  function novoExercicioSheet(pre) {
    openSheet(Object.assign({ type: 'ex', id: null, cat: 'forca' }, pre || {}));
    const inp = $('#ex-nome');
    if (inp) setTimeout(() => inp.focus(), 260);
  }

  /* ------------------------------------------------------------- editor */
  function novoBloco(over) {
    return Object.assign(
      { id: uid(), nome: 'Novo bloco', tipo: 'tecnica', modo: 'tempo', dur: 600, reps: '', foco: '', tecnicas: [] },
      over || {}
    );
  }

  function openEditor(id) {
    const t = id ? db.treinos.find((x) => x.id === id) : null;
    if (t) {
      draft = clone(t);
      draft.prep = draft.prep == null ? db.config.prep : draft.prep;
      draft.cor = draft.cor || '';
      draft.blocos = (draft.blocos || []).map((b) => Object.assign({ tecnicas: [], modo: 'tempo', reps: '' }, b));
    } else {
      draft = {
        id: uid(),
        nome: '',
        descricao: '',
        prep: db.config.prep,
        cor: '',
        blocos: [novoBloco({ nome: 'Aquecimento', tipo: 'aquecimento', dur: 600 })],
      };
    }
    openSheet({ type: 'editor' });
  }

  function editorHtml() {
    const total = somaDur(draft.blocos);
    const existente = db.treinos.some((t) => t.id === draft.id);
    return sheetShell(
      existente ? 'Editar treino' : 'Novo treino',
      `
      <div class="field">
        <label for="ed-nome">Nome do treino</label>
        <input id="ed-nome" type="text" data-field="nome" value="${esc(draft.nome)}" placeholder="Ex.: Treino de terça · uchi mata">
      </div>
      <div class="field">
        <label for="ed-desc">Descrição (opcional)</label>
        <input id="ed-desc" type="text" data-field="descricao" value="${esc(draft.descricao || '')}" placeholder="Objetivo do dia">
      </div>

      <div class="grid2 grid-prep">
        <div>
          <span class="lbl">Preparação inicial</span>
          <select data-field="prep">
            ${PREPS.map((x) => `<option value="${x}" ${Number(draft.prep) === x ? 'selected' : ''}>${x ? x + ' s' : 'sem contagem'}</option>`).join('')}
          </select>
        </div>
        <div>
          <span class="lbl">Cor do treino</span>
          <div class="swatches">
            ${ACENTOS.map(
              (a) => `<button class="swatch ${(draft.cor || '') === a.cor ? 'on' : ''}" data-action="set-cor" data-cor="${a.cor}" style="--c:${a.cor}" aria-label="Cor ${a.nome}"></button>`
            ).join('')}
          </div>
        </div>
      </div>

      <div class="flabel editor-flabel">
        <span>Blocos do treino</span>
        <span class="hint">${draft.blocos.length} · ${durText(total)}</span>
      </div>
      <div class="block-list" id="block-list">
        ${
          draft.blocos.length
            ? draft.blocos.map(blocoHtml).join('')
            : `<div class="empty"><p>Sem blocos. Adicione o primeiro abaixo.</p></div>`
        }
      </div>
      <button class="btn ghost block" data-action="add-bloco">+ Adicionar bloco</button>
      <div class="editor-total"><span>Duração estimada</span><b>${durText(total)}</b></div>
      <div class="editor-tools">
        <button class="btn ghost sm" data-action="embaralhar">Embaralhar ordem</button>
        ${existente ? `<button class="btn ghost sm" data-action="dup-treino" data-id="${draft.id}">Duplicar treino</button>` : ''}
      </div>
      `,
      `
      ${
        existente
          ? `<button class="btn danger" data-action="excluir-treino" data-id="${draft.id}">Excluir</button>`
          : `<button class="btn ghost" data-action="fechar-sheet">Cancelar</button>`
      }
      <button class="btn primary" data-action="salvar-treino">Salvar treino</button>
      `
    );
  }

  function blocoHtml(b, i) {
    const tp = TIPO[b.tipo] || TIPO.outro;
    const min = Math.floor((Number(b.dur) || 0) / 60);
    const sec = (Number(b.dur) || 0) % 60;
    return `
      <details class="blk" data-i="${i}" ${i === 0 ? 'open' : ''}>
        <summary>
          <span class="idx">${i + 1}</span>
          <span class="dot" style="background:${tp.cor}"></span>
          <span class="name">${esc(b.nome || 'Bloco')}</span>
          <span class="dur">${b.modo === 'manual' ? 'livre' : mmss(b.dur || 0)}</span>
        </summary>
        <div class="blk-body">
          <div class="grid2">
            <div>
              <span class="lbl">Nome</span>
              <input type="text" data-field="nome" value="${esc(b.nome)}" placeholder="Ex.: Uchikomi de o goshi">
            </div>
            <div>
              <span class="lbl">Tipo</span>
              <select data-field="tipo">
                ${TIPOS_BLOCO.map((t) => `<option value="${t.id}" ${t.id === b.tipo ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="grid2">
            <div>
              <span class="lbl">Controle</span>
              <select data-field="modo">
                <option value="tempo" ${b.modo !== 'manual' ? 'selected' : ''}>Por tempo</option>
                <option value="manual" ${b.modo === 'manual' ? 'selected' : ''}>Livre (eu encerro)</option>
              </select>
            </div>
            <div>
              <span class="lbl">Duração</span>
              <div class="dur-inputs">
                <input type="number" min="0" max="180" step="1" data-field="min" value="${min}" ${b.modo === 'manual' ? 'disabled' : ''} aria-label="Minutos">
                <span>min</span>
                <input type="number" min="0" max="59" step="5" data-field="sec" value="${sec}" ${b.modo === 'manual' ? 'disabled' : ''} aria-label="Segundos">
                <span>s</span>
              </div>
            </div>
          </div>
          ${b.modo === 'manual' ? '' : `<div class="dur-quick">
            ${DUR_QUICK.map((x) => `<button class="dq ${Number(b.dur) === x ? 'on' : ''}" data-action="blk-dur" data-i="${i}" data-sec="${x}">${x < 60 ? x + 's' : x / 60 + 'm'}</button>`).join('')}
          </div>`}
          <div>
            <span class="lbl">Repetições / séries (opcional)</span>
            <input type="text" data-field="reps" value="${esc(b.reps || '')}" placeholder="Ex.: 3x10, 5 séries de 20, 2 min cada lado">
          </div>
          <div>
            <span class="lbl">Foco / observações</span>
            <input type="text" data-field="foco" value="${esc(b.foco || '')}" placeholder="O que você precisa lembrar ao executar">
          </div>
          <div>
            <span class="lbl">Técnicas do bloco</span>
            <div class="tech-chips">
              ${(b.tecnicas || [])
                .map((id) => {
                  const tt = tecById(id);
                  if (!tt) return '';
                  return `<button class="chip-x" data-action="rm-tec" data-i="${i}" data-tec="${id}">${esc(tt.nome)} <b>✕</b></button>`;
                })
                .join('')}
              <button class="chip-add" data-action="abrir-picker" data-i="${i}">+ adicionar</button>
            </div>
          </div>
          <div class="row-between blk-foot">
            <div style="display:flex;gap:6px">
              <button class="icon-btn" data-action="blk-up" data-i="${i}" aria-label="Subir bloco">↑</button>
              <button class="icon-btn" data-action="blk-down" data-i="${i}" aria-label="Descer bloco">↓</button>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              <button class="btn ghost xs" data-action="blk-rest" data-i="${i}" title="Adicionar 30s de descanso depois">+ descanso</button>
              <button class="btn ghost xs" data-action="blk-dup" data-i="${i}">Duplicar</button>
              <button class="icon-btn danger" data-action="blk-del" data-i="${i}" aria-label="Remover bloco">✕</button>
            </div>
          </div>
        </div>
      </details>`;
  }

  /* ------------------------------------------------------------- picker */
  function pickerHtml() {
    const i = ui.sheet.i;
    const b = draft.blocos[i];
    if (!b) return '';
    b.tecnicas = b.tecnicas || [];
    const q = pickerQ.trim().toLowerCase();
    const lista = TECNICAS.filter((t) => !q || (t.nome + ' ' + t.jp + ' ' + SUB_NOME[t.sub]).toLowerCase().includes(q));
    const meus = exercicios().filter((e) => !q || (e.nome + ' ' + (e.dica || '')).toLowerCase().includes(q));
    return sheetShell(
      'Adicionar técnicas',
      `
      <div class="search-row">
        <svg class="search-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input class="search" id="picker-q" type="search" placeholder="Buscar técnica ou exercício..." value="${esc(pickerQ)}">
      </div>
      ${
        meus.length
          ? `<div class="sub-title">Meus exercícios</div>
             <div class="tec-list">
               ${meus
                 .map((e) => {
                   const on = b.tecnicas.includes(e.id);
                   const st = tecStatus(e.id);
                   const c = CAT_EX_MAP[e.cat] || CAT_EX[CAT_EX.length - 1];
                   return `
                   <button class="tec-row" data-action="toggle-tec" data-id="${e.id}" data-i="${i}">
                     <i class="status-dot ${st}"></i>
                     <span class="t-body"><h4>${esc(e.nome)}</h4><p>${esc(c.nome)}</p></span>
                     <span class="pick-state"${on ? ' style="color:var(--gold)"' : ''}>${on ? '✓' : '+'}</span>
                   </button>`;
                 })
                 .join('')}
             </div>`
          : ''
      }
      ${meus.length ? '<div class="sub-title">Repertório</div>' : ''}
      <div class="tec-list">
        ${lista
          .map((t) => {
            const on = b.tecnicas.includes(t.id);
            const st = tecStatus(t.id);
            return `
            <button class="tec-row" data-action="toggle-tec" data-id="${t.id}" data-i="${i}">
              <i class="status-dot ${st}"></i>
              <span class="t-body"><h4>${esc(t.nome)}</h4><p>${esc(SUB_NOME[t.sub] || '')}</p></span>
              <span style="font-size:1rem;color:${on ? 'var(--gold)' : 'var(--muted-2)'}">${on ? '✓' : '+'}</span>
            </button>`;
          })
          .join('')}
      </div>
      `,
      `<button class="btn ghost" data-action="novo-exercicio" data-from="picker" data-i="${i}">+ exercício</button>
       <button class="btn primary" data-action="voltar-editor">Pronto (${b.tecnicas.length})</button>`,
      { back: true }
    );
  }

  /* -------------------------------------------------------------- player */
  let P = null;
  const RING_C = 2 * Math.PI * 54;

  function startPlayer(treino) {
    const blocos = (treino.blocos || []).map((b) => Object.assign({ tecnicas: [] }, b));
    if (!blocos.length) return toast('Esse treino não tem blocos.');
    P = {
      nome: treino.nome || 'Treino',
      blocos,
      i: 0,
      phase: 'prep',
      prep: Math.max(0, Number(treino.prep != null ? treino.prep : db.config.prep) || 0) * 1000,
      remain: 0,
      elapsed: 0,
      activeMs: 0,
      doneCount: 0,
      last: performance.now(),
      lastCue: -1,
      finished: false,
      startedAt: Date.now(),
      feitas: new Set(),
    };
    P.remain = P.prep;
    ensureAudio();
    lockScreen();
    $('#player').hidden = false;
    document.body.classList.add('player-open');
    renderPlayer();
    clearInterval(startPlayer._t);
    startPlayer._t = setInterval(tick, 200);
    P.last = performance.now();
  }

  let wakeLock = null;
  function lockScreen() {
    try {
      if ('wakeLock' in navigator && navigator.wakeLock) {
        navigator.wakeLock.request('screen').then((w) => (wakeLock = w)).catch(() => {});
      }
    } catch (e) {}
  }
  function unlockScreen() {
    try { if (wakeLock) wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }

  function renderPlayer() {
    if (!P) return;
    const b = P.blocos[P.i];
    const tp = TIPO[b.tipo] || TIPO.outro;
    const total = somaDur(P.blocos);
    const R = 53;
    const C = 2 * Math.PI * R;
    const root = $('#player');
    root.style.setProperty('--accent', tp.cor);
    const prep = P.phase === 'prep';

    root.innerHTML = `
      <div class="pl-top">
        <div class="pl-name">
          <strong>${esc(P.nome)}</strong>
          <span>${P.i + 1} de ${P.blocos.length}${total ? ' · ' + durText(total) : ''}</span>
        </div>
        <button class="close-btn" data-action="pl-close" aria-label="Encerrar treino">${ICON.x}</button>
      </div>

      <div class="pl-timeline" id="pl-timeline">
        ${P.blocos
          .map((x, idx) => {
            const t = TIPO[x.tipo] || TIPO.outro;
            const cls = idx === P.i ? 'on' : idx < P.i ? 'done' : '';
            return `<span class="seg ${cls}" style="--c:${t.cor};flex-grow:${Math.max(1, x.modo === 'manual' ? 6 : x.dur || 1)}"><i></i></span>`;
          })
          .join('')}
      </div>

      <div class="pl-center">
        <div class="ring-wrap">
          <div class="ring-halo"></div>
          <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
            <defs>
              <linearGradient id="gring" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="${lighten(tp.cor, 0.45)}"/>
                <stop offset="100%" stop-color="${tp.cor}"/>
              </linearGradient>
            </defs>
            <circle class="ring-bg" cx="60" cy="60" r="${R}"/>
            <circle class="ring-fg" id="pl-ring" cx="60" cy="60" r="${R}" stroke="url(#gring)" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${prep ? 0 : C.toFixed(2)}"/>
            <circle class="ring-dot" id="pl-dot" cx="${60 + R}" cy="60" r="3.2"/>
          </svg>
          <div class="ring-inner">
            <span class="badge-tipo" id="pl-badge">${prep ? 'preparação' : esc(tp.nome)}</span>
            <div class="pl-time" id="pl-time">00:00</div>
            <div class="pl-block-name" id="pl-block">${esc(prep ? 'Prepare-se' : b.nome)}${
              !prep && b.reps ? `<span class="reps-inline">${esc(b.reps)}</span>` : ''
            }</div>
            <div class="pl-state" id="pl-state">${prep ? 'começando' : b.modo === 'manual' ? 'livre' : 'tempo'}</div>
          </div>
        </div>
        <p class="pl-foco" id="pl-foco">${esc(prep ? 'Respire. O primeiro bloco começa em instantes.' : b.foco || '')}</p>
        <div class="pl-tecs" id="pl-tecs">
          ${(prep ? [] : b.tecnicas || [])
            .map((id) => tecById(id))
            .filter(Boolean)
            .map((t) => `<span class="tag tec">${esc(t.nome)}</span>`)
            .join('')}
        </div>
      </div>

      <div class="pl-upnext" id="pl-upnext">${upNextText()}</div>

      <div class="pl-controls">
        <button class="ctrl" data-action="pl-prev" aria-label="Bloco anterior">${ICON.prev}</button>
        <button class="ctrl ctrl-main" data-action="pl-toggle" id="pl-toggle" aria-label="Pausar">${ICON.pause}</button>
        <button class="ctrl" data-action="pl-next" aria-label="Próximo bloco">${ICON.next}</button>
      </div>

      <div class="pl-list" id="pl-list">
        ${P.blocos
          .map((x, idx) => {
            const t = TIPO[x.tipo] || TIPO.outro;
            const done = P.feitas.has(idx);
            const on = idx === P.i && P.phase !== 'prep';
            return `<button class="pl-row ${done ? 'done' : ''} ${on ? 'on' : ''}" data-action="pl-jump" data-i="${idx}">
              <span class="n">${idx + 1}</span>
              <span class="rn">${esc(x.nome)}</span>
              ${done ? '<span class="check">✓</span>' : `<span class="rd">${x.modo === 'manual' ? 'livre' : mmss(x.dur || 0)}</span>`}
              <span class="sq" style="--c:${t.cor}"></span>
            </button>`;
          })
          .join('')}
      </div>
    `;
    updatePlayer();
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function upNextText() {
    if (!P) return '';
    const next = P.blocos[P.i + 1];
    if (!next) return 'Último bloco';
    const t = TIPO[next.tipo] || TIPO.outro;
    return `A seguir · <b>${esc(next.nome)}</b> · ${next.modo === 'manual' ? 'livre' : mmss(next.dur || 0)}`;
  }

  function updatePlayer() {
    if (!P) return;
    const b = P.blocos[P.i];
    const timeEl = $('#pl-time');
    if (!timeEl) return;

    let frac = 0;
    let secs = 0;
    if (P.phase === 'prep') {
      secs = Math.ceil(P.remain / 1000);
      frac = P.prep > 0 ? Math.max(0, Math.min(1, P.remain / (P.prep * 1000))) : 0;
    } else if (b.modo === 'manual') {
      secs = Math.floor(P.elapsed / 1000);
      frac = 1;
    } else {
      secs = Math.ceil(P.remain / 1000);
      frac = b.dur ? Math.max(0, Math.min(1, P.remain / (b.dur * 1000))) : 0;
    }

    const label = mmss(secs);
    if (timeEl.textContent !== label) {
      timeEl.textContent = label;
      timeEl.classList.remove('tick');
      void timeEl.offsetWidth;
      timeEl.classList.add('tick');
    }
    const warn = P.phase === 'run' && b.modo !== 'manual' && P.remain <= 3000 && P.remain > 0;
    timeEl.classList.toggle('warn', warn);

    const R = 53;
    const C = 2 * Math.PI * R;
    const ring = $('#pl-ring');
    if (ring) ring.setAttribute('stroke-dashoffset', String(C * (1 - frac)));
    const dot = $('#pl-dot');
    if (dot) dot.setAttribute('transform', `rotate(${(360 * frac).toFixed(1)} 60 60)`);

    const cur = ($('#pl-timeline') || {}).children ? $('#pl-timeline').children[P.i] : null;
    if (cur) {
      const fill = cur.querySelector('i');
      if (fill) fill.style.width = (b.modo === 'manual' ? 100 : (1 - frac) * 100).toFixed(1) + '%';
    }
  }

  function tick() {
    if (!P || P.finished || P.phase === 'paused') return;
    const now = performance.now();
    const dt = Math.max(0, now - P.last);
    P.last = now;
    if (dt > 5000) return; // aba dormindo: ignora salto absurdo

    if (P.phase === 'prep') {
      P.remain -= dt;
      const sp = Math.ceil(P.remain / 1000);
      if (sp <= 3 && sp > 0 && sp !== P.lastCue) {
        P.lastCue = sp;
        cueTick(sp);
        buzz(35);
      }
      if (P.remain <= 0) {
        P.remain = 0;
        beginBlock(0);
        return;
      }
    } else if (P.phase === 'run') {
      const b = P.blocos[P.i];
      P.activeMs += dt;
      if (b.modo === 'manual') {
        P.elapsed += dt;
      } else {
        P.remain -= dt;
        const s = Math.ceil(P.remain / 1000);
        if (s <= 3 && s > 0 && s !== P.lastCue) {
          P.lastCue = s;
          cueTick(s);
          buzz(35);
        }
        if (P.remain <= 0) {
          P.remain = 0;
          updatePlayer();
          completeBlock();
          return;
        }
      }
    }
    updatePlayer();
  }

  function beginBlock(i) {
    if (!P) return;
    P.i = i;
    P.phase = 'run';
    P.lastCue = -1;
    const b = P.blocos[i];
    P.remain = (Number(b.dur) || 0) * 1000;
    P.elapsed = 0;
    P.feitas.delete(i);
    cueBlockStart();
    buzz(45);
    renderPlayer();
    flashBlock();
    P.last = performance.now();
  }

  function completeBlock() {
    if (!P) return;
    P.feitas.add(P.i);
    P.doneCount = Math.max(P.doneCount, P.i + 1);
    cueBlockEnd();
    buzz([40, 60, 40]);
    if (P.i >= P.blocos.length - 1) {
      finishPlayer();
    } else {
      beginBlock(P.i + 1);
    }
  }

  function jumpTo(i) {
    if (!P || i < 0 || i >= P.blocos.length) return;
    P.doneCount = Math.max(P.doneCount, i);
    beginBlock(i);
  }

  function prevBlock() {
    if (!P) return;
    if (P.phase === 'prep') return;
    if (P.i === 0) {
      beginBlock(0);
      return;
    }
    P.feitas.delete(P.i - 1);
    beginBlock(P.i - 1);
  }

  function togglePause() {
    if (!P) return;
    if (P.phase === 'paused') {
      P.phase = P.pausedFrom || 'run';
      P.last = performance.now();
      $('#pl-toggle').innerHTML = pauseIcon();
      const st = $('#pl-state');
      if (st) st.textContent = P.phase === 'prep' ? 'começando' : P.blocos[P.i].modo === 'manual' ? 'livre' : 'tempo';
      $('#player').classList.remove('paused');
    } else {
      P.pausedFrom = P.phase;
      P.phase = 'paused';
      $('#pl-toggle').innerHTML = playIcon();
      const st = $('#pl-state');
      if (st) st.textContent = 'pausado';
      $('#player').classList.add('paused');
      beep(440, 0.08, 0.16);
    }
  }
  const playIcon = () => ICON.play;
  const pauseIcon = () => ICON.pause;

  function finishPlayer() {
    if (!P) return;
    P.finished = true;
    clearInterval(startPlayer._t);
    cueFinish();
    unlockScreen();
    burstConfetti();
    // treino livre / bloco único: se a pessoa treinou, conta como bloco feito
    if (P.blocos.length === 1 && P.activeMs >= 20000) P.feitas.add(0);
    const feitas = [...P.feitas].sort((a, b) => a - b);
    const data = {
      id: uid(),
      treinoId: null,
      nome: P.nome,
      inicio: P.startedAt,
      fim: Date.now(),
      dur: Math.round(P.activeMs / 1000),
      blocos: feitas.length,
      total: P.blocos.length,
      tecnicas: [...new Set(feitas.flatMap((k) => (P.blocos[k] && P.blocos[k].tecnicas) || []))],
    };
    P = null;
    clearInterval(startPlayer._t);
    $('#player').hidden = true;
    $('#player').innerHTML = '';
    document.body.classList.remove('player-open');
    ui.mood = 0;
    openSheet({ type: 'resumo', data });
    render();
  }

  function resumoHtml(d) {
    const minutos = Math.round(d.dur / 60);
    const grande = d.dur < 60 ? d.dur + ' s' : d.dur >= 3600 ? Math.floor(d.dur / 3600) + 'h' + pad2(Math.round((d.dur % 3600) / 60)) : minutos + ' min';
    const pequeno = d.dur < 60 ? d.dur + 's' : d.dur >= 3600 ? Math.floor(d.dur / 3600) + 'h' : minutos + '′';
    return sheetShell(
      'Treino concluído',
      `
      <div class="summary-hero">
        <span class="tag-ippon">sessão registrada</span>
        <div class="big">${grande}</div>
        <p>${esc(d.nome)}</p>
      </div>
      <div class="summary-stats">
        <div style="--i:0"><b>${d.blocos}/${d.total}</b><span>blocos</span></div>
        <div style="--i:1"><b>${d.tecnicas.length}</b><span>técnicas</span></div>
        <div style="--i:2"><b>${pequeno}</b><span>no tatame</span></div>
      </div>

      <div class="flabel">Como foi o treino?</div>
      <div class="mood-row" id="mood-row">
        ${['😖', '😕', '🙂', '😃', '🤩']
          .map((e, i) => `<button class="mood ${ui.mood === i + 1 ? 'on' : ''}" data-action="mood" data-v="${i + 1}">${e}<span>${['duro', 'fraco', 'ok', 'bom', 'ótimo'][i]}</span></button>`)
          .join('')}
      </div>

      <div class="field" style="margin-top:18px;margin-bottom:0">
        <label for="resumo-nota">Anotação rápida (opcional)</label>
        <input id="resumo-nota" type="text" placeholder="Ex.: encaixei bem o seoi, cansaço no fim">
      </div>
      `,
      `
      <button class="btn ghost" data-action="descartar-sessao">Descartar</button>
      <button class="btn primary" data-action="salvar-sessao" data-id="${d.id}">Salvar treino</button>
      `
    );
  }

  /* -------------------------------------------------------------- ações */
  ACTIONS = {
    nav(el) {
      ui.view = el.dataset.view;
      render();
      scrollTop();
    },

    quick(el) {
      const livre = el.dataset.livre === '1';
      const dur = Number(el.dataset.dur) || 0;
      startPlayer({
        nome: el.dataset.nome,
        blocos: [
          {
            id: uid(),
            nome: el.dataset.nome,
            tipo: el.dataset.tipo || 'outro',
            modo: livre || !dur ? 'manual' : 'tempo',
            dur: dur,
            foco: el.dataset.foco || '',
            tecnicas: [],
          },
        ],
      });
    },

    'iniciar-treino'(el) {
      const t = db.treinos.find((x) => x.id === el.dataset.id);
      if (t) startPlayer(t);
    },

    modelo(el) {
      const m = MODELOS[Number(el.dataset.i)];
      if (!m) return;
      const novo = {
        id: uid(),
        nome: m.nome,
        descricao: m.descricao,
        blocos: m.blocos.map((b) => Object.assign({ id: uid(), tecnicas: [] }, b)),
      };
      db.treinos.unshift(novo);
      saveDb();
      toast('Modelo adicionado aos seus treinos');
      startPlayer(novo);
    },

    'novo-treino'() {
      openEditor(null);
    },

    'editar-treino'(el) {
      openEditor(el.dataset.id);
    },

    'fechar-sheet'() {
      closeSheet();
    },

    'voltar-editor'() {
      openSheet({ type: 'editor' });
    },

    'add-bloco'() {
      draft.blocos.push(novoBloco({ nome: 'Bloco ' + (draft.blocos.length + 1), tipo: 'tecnica', dur: 600 }));
      renderSheet();
      const last = $$('#block-list .blk').pop();
      if (last) {
        last.open = true;
        last.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    },

    'blk-dup'(el) {
      const i = Number(el.dataset.i);
      const copia = clone(draft.blocos[i]);
      copia.id = uid();
      draft.blocos.splice(i + 1, 0, copia);
      renderSheet();
    },

    'blk-del'(el) {
      const i = Number(el.dataset.i);
      draft.blocos.splice(i, 1);
      renderSheet();
      if (!draft.blocos.length) toast('Adicione pelo menos um bloco');
    },

    'blk-up'(el) {
      const i = Number(el.dataset.i);
      if (i === 0) return;
      const tmp = draft.blocos[i - 1];
      draft.blocos[i - 1] = draft.blocos[i];
      draft.blocos[i] = tmp;
      renderSheet();
    },

    'blk-down'(el) {
      const i = Number(el.dataset.i);
      if (i >= draft.blocos.length - 1) return;
      const tmp = draft.blocos[i + 1];
      draft.blocos[i + 1] = draft.blocos[i];
      draft.blocos[i] = tmp;
      renderSheet();
    },

    'abrir-picker'(el) {
      pickerQ = '';
      openSheet({ type: 'picker', i: Number(el.dataset.i) });
      setTimeout(() => {
        const inp = $('#picker-q');
        if (inp) inp.focus();
      }, 60);
    },

    'toggle-tec'(el) {
      const id = el.dataset.id;
      const i = Number(el.dataset.i);
      const b = draft.blocos[i];
      if (!b) return;
      b.tecnicas = b.tecnicas || [];
      const pos = b.tecnicas.indexOf(id);
      if (pos >= 0) b.tecnicas.splice(pos, 1);
      else b.tecnicas.push(id);
      // atualização leve (sem perder o scroll do picker)
      const mark = el.querySelector('span:last-child');
      const on = b.tecnicas.includes(id);
      if (mark) {
        mark.textContent = on ? '✓' : '+';
        mark.style.color = on ? 'var(--gold)' : 'var(--muted-2)';
      }
      // só o botão do rodapé: o cabeçalho tem um "voltar" (←) com a mesma ação
      const btn = $('#sheet .sheet-foot [data-action="voltar-editor"]');
      if (btn) btn.textContent = `Pronto (${b.tecnicas.length})`;
    },

    'rm-tec'(el) {
      const i = Number(el.dataset.i);
      const id = el.dataset.tec;
      const b = draft.blocos[i];
      if (!b) return;
      b.tecnicas = (b.tecnicas || []).filter((x) => x !== id);
      renderSheet();
    },

    /* ------------------------------------------- exercícios personalizados */
    'novo-exercicio'(el) {
      const pre = { nome: el.dataset.nome || '', cat: el.dataset.cat || 'forca' };
      if (el.dataset.from === 'picker') {
        pre.from = 'picker';
        pre.i = Number(el.dataset.i);
      }
      novoExercicioSheet(pre);
    },

    'abrir-exercicio'(el) {
      openSheet({ type: 'ex', id: el.dataset.id });
    },

    'ex-sugestao'(el) {
      const inp = $('#ex-nome');
      if (inp) {
        inp.value = el.dataset.nome || '';
        inp.focus();
      }
      $$('#ex-sug .chip').forEach((c) => c.classList.toggle('on', c === el));
    },

    'ex-cat'(el) {
      if (!ui.sheet) return;
      ui.sheet.cat = el.dataset.cat || 'forca';
      $$('#ex-cats .chip').forEach((c) => c.classList.toggle('on', c === el));
      const sug = $('#ex-sug');
      if (sug) {
        sug.innerHTML = (EX_SUGESTOES[ui.sheet.cat] || [])
          .map((x) => `<button class="chip sm" data-action="ex-sugestao" data-nome="${esc(x)}">${esc(x)}</button>`)
          .join('');
      }
    },

    'criar-exercicio'() {
      const nome = (($('#ex-nome') || {}).value || '').trim();
      if (!nome) return toast('Dê um nome ao exercício');
      const cat = (ui.sheet && ui.sheet.cat) || 'forca';
      const dica = (($('#ex-dica') || {}).value || '').trim();
      const e = {
        id: 'cx-' + uid(),
        nome: nome.slice(0, 40),
        cat: CAT_EX_MAP[cat] ? cat : 'outro',
        dica: dica.slice(0, 80),
        criado: Date.now(),
      };
      db.exercicios = [e].concat(exercicios());
      saveDb();
      const s = ui.sheet || {};
      if (s.from === 'picker' && typeof s.i === 'number' && draft && draft.blocos[s.i]) {
        const b = draft.blocos[s.i];
        b.tecnicas = b.tecnicas || [];
        if (!b.tecnicas.includes(e.id)) b.tecnicas.push(e.id);
        openSheet({ type: 'picker', i: s.i });
        toast(e.nome + ' no bloco');
      } else {
        closeSheet();
        render();
        toast(e.nome + ' criado');
      }
    },

    'salvar-exercicio'(el) {
      const e = exercicios().find((x) => x.id === el.dataset.id);
      if (!e) return;
      const nome = (($('#ex-nome') || {}).value || '').trim();
      if (!nome) return toast('Dê um nome ao exercício');
      e.nome = nome.slice(0, 40);
      e.dica = (($('#ex-dica') || {}).value || '').trim().slice(0, 80);
      if (ui.sheet && CAT_EX_MAP[ui.sheet.cat]) e.cat = ui.sheet.cat;
      saveDb();
      closeSheet();
      render();
      toast('Exercício salvo');
    },

    'excluir-exercicio'(el) {
      const id = el.dataset.id;
      const e = exercicios().find((x) => x.id === id);
      confirmAction(el, 'Excluir ' + (e ? e.nome : 'exercício') + '?', () => {
        db.exercicios = exercicios().filter((x) => x.id !== id);
        const limpa = (b) => Object.assign({}, b, { tecnicas: (b.tecnicas || []).filter((x) => x !== id) });
        db.treinos = (db.treinos || []).map((t) => Object.assign({}, t, { blocos: (t.blocos || []).map(limpa) }));
        if (draft) draft.blocos = (draft.blocos || []).map(limpa);
        delete db.tecnicas[id];
        saveDb();
        closeSheet();
        render();
        toast('Exercício excluído');
      });
    },

    'salvar-treino'() {
      draft.nome = (draft.nome || '').trim();
      if (!draft.nome) return toast('Dê um nome ao treino');
      if (!draft.blocos.length) return toast('Adicione pelo menos um bloco');
      draft.prep = Math.max(0, Math.min(60, Number(draft.prep) || 0));
      draft.cor = ACENTOS.some((a) => a.cor === draft.cor) ? draft.cor : '';
      draft.blocos = draft.blocos.map((b) => ({
        id: b.id || uid(),
        nome: (b.nome || '').trim() || 'Bloco',
        tipo: TIPO[b.tipo] ? b.tipo : 'outro',
        modo: b.modo === 'manual' ? 'manual' : 'tempo',
        dur: Math.max(0, Number(b.dur) || 0),
        reps: (b.reps || '').trim().slice(0, 24),
        foco: (b.foco || '').trim(),
        tecnicas: Array.isArray(b.tecnicas) ? b.tecnicas : [],
      }));
      const idx = db.treinos.findIndex((t) => t.id === draft.id);
      if (idx >= 0) db.treinos[idx] = draft;
      else db.treinos.unshift(draft);
      saveDb();
      closeSheet();
      ui.view = 'treinos';
      render();
      toast('Treino salvo');
    },

    'set-cor'(el) {
      if (!draft) return;
      draft.cor = el.dataset.cor;
      $$('#sheet .swatch').forEach((x) => x.classList.toggle('on', x === el));
    },

    'blk-dur'(el) {
      const i = Number(el.dataset.i);
      const sec = Math.max(0, Number(el.dataset.sec) || 0);
      const b = draft && draft.blocos[i];
      if (!b) return;
      b.dur = sec;
      const box = el.closest('.blk');
      if (box) {
        const minEl = box.querySelector('input[data-field="min"]');
        const secEl = box.querySelector('input[data-field="sec"]');
        if (minEl) minEl.value = Math.floor(sec / 60);
        if (secEl) secEl.value = sec % 60;
        const lab = box.querySelector('summary .dur');
        if (lab) lab.textContent = mmss(sec);
        box.querySelectorAll('.dq').forEach((x) => x.classList.toggle('on', Number(x.dataset.sec) === sec));
      }
      const tot = $('.editor-total b');
      if (tot) tot.textContent = durText(somaDur(draft.blocos));
    },

    'blk-rest'(el) {
      const i = Number(el.dataset.i);
      if (!draft || !draft.blocos[i]) return;
      draft.blocos.splice(
        i + 1,
        0,
        novoBloco({ nome: 'Descanso', tipo: 'descanso', modo: 'tempo', dur: 30, foco: 'Respira, bebe água, ajusta a pegada.' })
      );
      renderSheet();
      toast('30s de descanso depois deste bloco');
    },

    embaralhar() {
      if (!draft || draft.blocos.length < 2) return toast('Precisa de pelo menos 2 blocos');
      for (let i = draft.blocos.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const tmp = draft.blocos[i];
        draft.blocos[i] = draft.blocos[j];
        draft.blocos[j] = tmp;
      }
      renderSheet();
      toast('Ordem embaralhada');
    },

    'dup-treino'(el) {
      const id = el.dataset.id || (draft && draft.id);
      const t = db.treinos.find((x) => x.id === id);
      if (!t) return;
      const copia = clone(t);
      copia.id = uid();
      copia.nome = (t.nome || 'Treino').slice(0, 36) + ' · cópia';
      copia.blocos = (copia.blocos || []).map((b) => Object.assign({}, b, { id: uid() }));
      db.treinos.unshift(copia);
      saveDb();
      closeSheet();
      ui.view = 'treinos';
      render();
      toast('Treino duplicado');
    },

    perfil() {
      openSheet({ type: 'perfil' });
    },

    'copiar-chave'() {
      const txt = (db.perfil && db.perfil.chave) || '';
      const ok = () => toast('Chave copiada');
      const manual = () => {
        const el = $('#chave-txt');
        if (el && window.getSelection) {
          const r = document.createRange();
          r.selectNodeContents(el);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        }
        toast('Selecione e copie a chave');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok).catch(manual);
      else manual();
    },

    'sair-perfil'() {
      closeSheet();
      sairDoPerfil();
      toast('Você saiu · seus dados ficaram salvos na chave');
    },

    'gate-criar'() {
      criarPerfil();
    },

    'gate-entrar'() {
      entrarComChave();
    },

    'gate-perfil'(el) {
      if (entrar(el.dataset.chave)) toast('Bem-vindo de volta');
    },

    'gate-importar'() {
      const f = $('#gate-file');
      if (f) f.click();
    },

    'excluir-treino'(el) {
      confirmAction(el, 'Confirmar exclusão', () => {
        db.treinos = db.treinos.filter((t) => t.id !== el.dataset.id);
        saveDb();
        closeSheet();
        ui.view = 'treinos';
        render();
        toast('Treino excluído');
      });
    },

    'abrir-tec'(el) {
      openSheet({ type: 'tec', id: el.dataset.id });
    },

    'set-status'(el) {
      const id = el.dataset.id;
      db.tecnicas[id] = db.tecnicas[id] || { s: 'novo', n: '' };
      db.tecnicas[id].s = el.dataset.s;
      saveDb();
      $$('.status-opt').forEach((b) => b.classList.toggle('on', b === el));
      render();
    },

    'filtro-grupo'(el) {
      ui.grupo = el.dataset.g;
      render();
    },

    mood(el) {
      ui.mood = Number(el.dataset.v);
      $$('#mood-row .mood').forEach((m) => m.classList.toggle('on', m === el));
    },

    'salvar-sessao'(el) {
      const d = ui.sheet && ui.sheet.data;
      if (!d) return;
      const notaEl = $('#resumo-nota');
      db.sessoes.unshift({
        id: d.id,
        treinoId: d.treinoId,
        nome: d.nome,
        inicio: d.inicio,
        fim: Date.now(),
        dur: d.dur,
        blocos: d.blocos,
        total: d.total,
        mood: ui.mood,
        nota: notaEl ? notaEl.value.trim() : '',
        tecnicas: d.tecnicas || [],
      });
      saveDb();
      closeSheet();
      ui.view = 'progresso';
      render();
      scrollTop();
      toast('Treino registrado 💪');
    },

    'descartar-sessao'() {
      closeSheet();
      render();
      toast('Sessão descartada');
    },

    'del-sessao'(el) {
      confirmAction(el, 'Apagar?', () => {
        db.sessoes = db.sessoes.filter((s) => s.id !== el.dataset.id);
        saveDb();
        render();
        toast('Registro apagado');
      });
    },

    exportar() {
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tatame-' + ((db.perfil && db.perfil.chave) || 'backup').replace(/[^A-Z0-9-]/gi, '') + '-' + dayKey(new Date()) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Backup gerado');
    },

    importar() {
      const inp = $('#file-import');
      if (inp) inp.click();
    },

    reset(el) {
      confirmAction(el, 'Apagar tudo mesmo?', () => {
        const chave = db.perfil.chave;
        const nome = db.perfil.nome;
        db = clone(DEFAULT_DB);
        db.perfil = { chave, nome, criado: Date.now() };
        saveDb();
        ui.view = 'treinar';
        render();
        toast('Dados apagados');
      });
    },

    'pl-toggle'() {
      togglePause();
    },
    'pl-next'() {
      if (!P) return;
      if (P.phase === 'prep') {
        P.phase = 'run';
        beginBlock(0);
        return;
      }
      completeBlock();
    },
    'pl-prev'() {
      prevBlock();
    },
    'pl-jump'(el) {
      jumpTo(Number(el.dataset.i));
    },
    'pl-close'() {
      if (!P) return;
      if (P.phase === 'prep' && P.activeMs < 1000) {
        P.finished = true;
        clearInterval(startPlayer._t);
        unlockScreen();
        P = null;
        $('#player').hidden = true;
        $('#player').innerHTML = '';
        document.body.classList.remove('player-open');
        return;
      }
      finishPlayer();
    },
  };

  /* ------------------------------------------------------------- confetti */
  function burstConfetti() {
    const cv = $('#confetti');
    if (!cv) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    cv.width = w;
    cv.height = h;
    cv.style.width = window.innerWidth + 'px';
    cv.style.height = window.innerHeight + 'px';
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const colors = ['#f8e3a6', '#e8c063', '#ff6b57', '#ffffff', '#7fb2ff', '#59d0a4'];
    const parts = Array.from({ length: 120 }, () => ({
      x: w * (0.5 + (Math.random() - 0.5) * 0.42),
      y: h * 0.34 + Math.random() * h * 0.1,
      vx: (Math.random() - 0.5) * 11 * dpr,
      vy: (-7 - Math.random() * 8) * dpr,
      bw: (2.5 + Math.random() * 5) * dpr,
      bh: (4 + Math.random() * 9) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.32,
      c: colors[(Math.random() * colors.length) | 0],
      life: 1,
    }));
    const t0 = performance.now();
    const frame = (t) => {
      if (t - t0 > 4200) { ctx.clearRect(0, 0, w, h); return; }
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      for (const p of parts) {
        p.vy += 0.52 * dpr;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.994;
        p.rot += p.vr;
        p.life -= 0.0058;
        if (p.life <= 0 || p.y > h + 40) continue;
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.bw / 2, -p.bh / 2, p.bw, p.bh);
        ctx.restore();
      }
      if (alive) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    requestAnimationFrame(frame);
  }

  function flashBlock() {
    const host = $('#player');
    if (!P || !host) return;
    const b = P.blocos[P.i];
    const tp = TIPO[b.tipo] || TIPO.outro;
    const el = document.createElement('div');
    el.className = 'pl-flash';
    el.innerHTML = `<span style="color:${lighten(tp.cor, 0.6)}">${esc(b.nome)}</span>`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  /* -------------------------------------------------- confirmação inline */
  function confirmAction(el, label, fn) {
    if (el.dataset.armed === '1') {
      el.dataset.armed = '';
      fn();
      return;
    }
    el.dataset.armed = '1';
    if (!el.dataset.original) el.dataset.original = el.innerHTML;
    el.textContent = label;
    el.classList.add('danger', 'armed');
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      if (el.isConnected) {
        el.innerHTML = el.dataset.original;
        el.classList.remove('armed');
        el.dataset.armed = '';
      }
    }, 3200);
  }

  /* --------------------------------------------------------------- eventos */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'A' || (el.tagName === 'BUTTON' && el.type === 'submit')) e.preventDefault();
    fn(el, e);
  });

  document.addEventListener('click', (e) => {
    if (e.target.id === 'sheet') closeSheet();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target.id === 'gate-chave' || e.target.id === 'gate-nome')) {
      e.preventDefault();
      if (e.target.id === 'gate-chave') entrarComChave();
      else criarPerfil();
      return;
    }
    if (e.key === 'Escape') {
      if (ui.sheet) closeSheet();
      else if (P) ACTIONS['pl-close']();
      return;
    }
    if (!P) return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePause();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      ACTIONS['pl-next']();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prevBlock();
    }
  });

  /* inputs do sheet (editor, picker, técnicas, ajustes) */
  document.addEventListener('input', (e) => {
    const el = e.target;

    // busca de técnicas na view
    if (el.id === 'busca-tec') {
      ui.busca = el.value;
      const pos = el.selectionStart;
      render();
      const again = $('#busca-tec');
      if (again) {
        again.focus();
        try { again.setSelectionRange(pos, pos); } catch (err) {}
      }
      return;
    }

    // busca no picker
    if (el.id === 'picker-q') {
      pickerQ = el.value;
      const pos = el.selectionStart;
      renderSheet();
      const again = $('#picker-q');
      if (again) {
        again.focus();
        try { again.setSelectionRange(pos, pos); } catch (err) {}
      }
      return;
    }

    // anotações de técnica
    if (el.dataset && el.dataset.tecNota) {
      const id = el.dataset.tecNota;
      db.tecnicas[id] = db.tecnicas[id] || { s: 'novo', n: '' };
      db.tecnicas[id].n = el.value;
      saveDb();
      return;
    }

    // ajustes
    if (el.id === 'cfg-prep') {
      db.config.prep = Math.max(0, Math.min(60, Number(el.value) || 0));
      saveDb();
      return;
    }

    // nome do perfil
    if (el.id === 'perfil-nome' && db.perfil) {
      db.perfil.nome = el.value.slice(0, 28);
      saveDb();
      const av = $('#topbar-avatar');
      if (av) av.textContent = initials(db.perfil.nome || 'Judoca');
      return;
    }

    // campos do editor
    if (ui.sheet && ui.sheet.type === 'editor' && el.dataset && el.dataset.field) {
      const campo = el.dataset.field;
      if (!el.closest('.blk') && ['nome', 'descricao', 'prep'].includes(campo)) {
        if (campo === 'prep') draft.prep = Math.max(0, Math.min(60, Number(el.value) || 0));
        else draft[campo] = el.value;
        return;
      }
      const box = el.closest('.blk');
      if (!box) return;
      const i = Number(box.dataset.i);
      const b = draft.blocos[i];
      if (!b) return;

      if (campo === 'min' || campo === 'sec') {
        const durEls = box.querySelectorAll('input[data-field="min"], input[data-field="sec"]');
        const m = Number(durEls[0] ? durEls[0].value : 0) || 0;
        const s = Number(durEls[1] ? durEls[1].value : 0) || 0;
        b.dur = Math.max(0, m * 60 + s);
        const label = box.querySelector('summary .dur');
        if (label) label.textContent = b.modo === 'manual' ? 'livre' : mmss(b.dur);
        const tot = $('.editor-total b');
        if (tot) tot.textContent = durText(somaDur(draft.blocos));
        return;
      }

      b[campo] = el.value;
      if (campo === 'nome') {
        const label = box.querySelector('summary .name');
        if (label) label.textContent = el.value || 'Bloco';
      }
      if (campo === 'tipo') {
        const tp = TIPO[b.tipo] || TIPO.outro;
        const dot = box.querySelector('summary .dot');
        if (dot) dot.style.background = tp.cor;
      }
      if (campo === 'modo') {
        const disabled = b.modo === 'manual';
        box.querySelectorAll('input[data-field="min"], input[data-field="sec"]').forEach((inp) => (inp.disabled = disabled));
        const label = box.querySelector('summary .dur');
        if (label) label.textContent = disabled ? 'livre' : mmss(b.dur);
      }
      return;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'cfg-som') {
      db.config.som = el.checked;
      saveDb();
      if (el.checked) beep(880, 0.1, 0.2);
      return;
    }
    if ((el.id === 'file-import' || el.id === 'gate-file') && el.files && el.files[0]) {
      const file = el.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const p = JSON.parse(String(reader.result));
          if (!p || !Array.isArray(p.treinos)) throw new Error('formato');
          const doArquivo = normalizaChave(p.perfil && p.perfil.chave);
          const chave = doArquivo || (db.perfil && db.perfil.chave) || novaChave();
          const pacote = {
            version: 2,
            perfil: {
              chave,
              nome: (p.perfil && p.perfil.nome) || (db.perfil && db.perfil.nome) || '',
              criado: (p.perfil && p.perfil.criado) || Date.now(),
            },
            treinos: p.treinos,
            sessoes: Array.isArray(p.sessoes) ? p.sessoes : [],
            tecnicas: p.tecnicas || {},
            exercicios: normalizaExercicios(p.exercicios),
            config: Object.assign({}, DEFAULT_DB.config, p.config || {}),
          };
          try { localStorage.setItem(storeKey(chave), JSON.stringify(pacote)); } catch (e) {}
          guardaPerfil({ chave, nome: pacote.perfil.nome, ultimo: Date.now() });
          entrar(chave);
          toast('Backup restaurado · chave ' + chave.slice(7));
        } catch (err) {
          toast('Arquivo inválido');
        }
      };
      reader.readAsText(file);
      el.value = '';
    }
  });

  /* ------------------------------------------------------- ciclo de vida */
  document.addEventListener('visibilitychange', () => {
    if (P && !P.finished) {
      if (document.visibilityState === 'visible') lockScreen();
      P.last = performance.now();
    }
  });

  window.addEventListener('resize', () => updateTabInk());

  window.addEventListener('beforeunload', (e) => {
    // só avisa se o cronômetro está de fato correndo
    if (P && !P.finished && P.phase === 'run') {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* PWA */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  /* -------------------------------------------------------------- start */
  (function boot() {
    let salva = null;
    try { salva = localStorage.getItem(LS_ACTIVE); } catch (e) {}
    const k = normalizaChave(salva);
    if (k && lerPerfis().some((x) => x.chave === k)) {
      entrar(k);
      if (!db.treinos.length && !db.sessoes.length) {
        setTimeout(() => toast('Dica: toque em “Novo treino” para montar o seu'), 1200);
      }
    } else {
      db = clone(DEFAULT_DB);
      render();
      abrirGate();
    }
  })();

  // expõe para depuração leve
  window.Tatame = {
    get db() { return db; },
    get player() { return P; },
    get perfil() { return db.perfil; },
    chave: () => (db.perfil && db.perfil.chave) || null,
    entrar,
    sair: sairDoPerfil,
    novaChave,
  };
})();

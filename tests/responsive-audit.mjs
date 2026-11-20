#!/usr/bin/env node
/* ==========================================================================
   TATAME · auditoria responsiva automatizada
   --------------------------------------------------------------------------
   Percorre todas as larguras alvo × todas as telas/estados, medindo o DOM
   de verdade em um Chrome headless via CDP (sem dependências).

   Uso:
     node tests/responsive-audit.mjs            # audita e compara com baseline
     node tests/responsive-audit.mjs --update   # grava baseline de screenshots
     node tests/responsive-audit.mjs --only=player,gate
     node tests/responsive-audit.mjs --widths=320,390,1440

   Saída: relatório no terminal + tests/last-report.json + screenshots.
   ========================================================================== */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'tests', '.out');
const BASE = join(ROOT, 'tests', 'baseline');
const PORT = 9333;
const URL = process.env.TATAME_URL || 'http://localhost:5178/';

const WIDTHS = [320, 344, 360, 375, 390, 414, 430, 480, 540, 640, 768, 820, 912, 1024, 1280, 1366, 1440, 1600, 1920, 2160, 2560, 3440];
const VIEWS = ['treinar', 'treinos', 'tecnicas', 'progresso'];
const DETAIL_WIDTHS = [320, 390, 768, 1024, 1440, 2560];
/* celular/tablet deitados: altura é o fator limitante */
const LANDSCAPE = [[568, 320], [640, 360], [667, 375], [736, 414], [812, 375], [844, 390], [912, 412], [1024, 600], [1280, 720]];

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const widthsArg = (args.find((a) => a.startsWith('--widths=')) || '').split('=')[1];
const widths = widthsArg ? widthsArg.split(',').map(Number) : WIDTHS;
const states = only ? only.split(',') : VIEWS.concat(['gate', 'player', 'editor', 'perfil', 'picker', 'ex', 'planos']);

/* ------------------------------------------------------------ utilidades */
const chromePath = () => {
  const cands = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return cands.find((p) => existsSync(p));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const heightFor = (w) => (w <= 480 ? 820 : w <= 900 ? 1024 : w <= 1440 ? 900 : 1000);
/* --------------------------------------------------------------------------
   Assinatura perceptual do screenshot: 16x16 de luminância média.
   Comparar bytes de PNG acusa qualquer diferença de antialiasing (e o dígito
   do cronômetro muda a cada execução), o que transformaria a regressão visual
   em ruído. A grade 16x16 só muda quando o layout/composição muda de verdade.
   -------------------------------------------------------------------------- */
function decodePng(buf) {
  let pos = 8;
  let w = 0, h = 0, ct = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1;
  const stride = w * ch;
  const lum = Buffer.alloc(w * h);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    prev = line;
    for (let x = 0; x < w; x++) {
      const i = x * ch;
      lum[y * w + x] = ch >= 3 ? 0.299 * line[i] + 0.587 * line[i + 1] + 0.114 * line[i + 2] : line[i];
    }
  }
  return { w, h, lum };
}

function signature(buf) {
  let img;
  try { img = decodePng(buf); } catch (e) { return createHash('sha1').update(buf).digest('hex').slice(0, 16); }
  const N = 16;
  const cells = [];
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      const x0 = Math.floor((cx * img.w) / N), x1 = Math.floor(((cx + 1) * img.w) / N);
      const y0 = Math.floor((cy * img.h) / N), y1 = Math.floor(((cy + 1) * img.h) / N);
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += img.lum[y * img.w + x]; n++; }
      cells.push(n ? Math.round(sum / n) : 0);
    }
  }
  return cells;
}

/* diferença perceptual: células que mudaram mais que 8 níveis (0–255) */
function visualDiff(a, b) {
  if (typeof a === 'string' || typeof b === 'string') return a === b ? 0 : 999;
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 8) changed++;
  return changed;
}
const LIMITE_CELULAS = 24; // ~9% da grade

async function waitForChrome(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('Chrome não respondeu na porta de debug');
}

/* ------------------------------------------------------------ CDP mínimo */
class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
      }
    };
  }
  send(method, params = {}, timeout = 30000) {
    return new Promise((res, rej) => {
      const id = ++this.id;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('timeout ' + method));
        }
      }, timeout);
    });
  }
  async eval(fn, ...a) {
    const expression = typeof fn === 'string' ? fn : `(${fn})(${a.map((x) => JSON.stringify(x)).join(',')})`;
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || 'eval error');
    return r.result.value;
  }
}

/* ------------------------------------------------------------ medição */
const AUDIT_FN = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const out = { vw, vh, overflowX: Math.max(0, document.documentElement.scrollWidth - vw), offenders: [], smallTap: [], tinyText: [], clippedY: [] };
  const scroller = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const s = getComputedStyle(p);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') return true;
      p = p.parentElement;
    }
    return false;
  };
  const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD']);
  for (const el of document.querySelectorAll('body *')) {
    if (skip.has(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
    if (el.closest('[hidden]')) continue;
    // fora da viewport horizontal
    if (!scroller(el) && !el.closest('.ambient')) {
      if (r.right > vw + 1.5 || r.left < -1.5) {
        out.offenders.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 40), id: el.id || '', l: Math.round(r.left), r: Math.round(r.right) });
      }
    }
    // alvos de toque pequenos
    if (s.pointerEvents !== 'none' && /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)) {
      if (r.width < 24 || r.height < 24) out.smallTap.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
    }
    // texto minúsculo (só quem tem texto próprio)
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (own) {
      const fs = parseFloat(s.fontSize);
      if (fs && fs < 11) out.tinyText.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 30), fs: fs.toFixed(1) });
    }
  }
  // conteúdo verticalmente cortado em containers com overflow
  for (const el of document.querySelectorAll('.sheet-body, .pl-list, #view')) {
    if (!el) continue;
    const s = getComputedStyle(el);
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
      out.clippedY.push({ cls: el.className, scroll: el.scrollHeight, client: el.clientHeight });
    }
  }
  out.dup = (arr) => arr.slice(0, 6);
  out.offenders = out.offenders.slice(0, 8);
  out.smallTap = out.smallTap.slice(0, 6);
  out.tinyText = out.tinyText.slice(0, 6);
  return out;
})()`;

const SEED_FN = (data) => `(() => { localStorage.setItem('tatame.v1:' + ${JSON.stringify(data.chave)}, ${JSON.stringify(JSON.stringify(data.db))}); localStorage.setItem('tatame.chave', ${JSON.stringify(data.chave)}); localStorage.setItem('tatame.perfis', ${JSON.stringify(JSON.stringify([{ chave: data.chave, nome: data.db.perfil.nome, ultimo: Date.now() }]))}); return true; })()`;

/* ------------------------------------------------------------ fixture */
function fixture(chave) {
  const bloco = (i) => ({
    id: 'b' + i,
    nome: ['Mobilidade e aquecimento completo', 'Ukemi (amortecimento)', 'Uchikomi de entrada', 'Nagekomi leve', 'Ne-waza · imobilizações', 'Randori em pé', 'Alongamento'][i % 7],
    tipo: ['aquecimento', 'ukemi', 'uchikomi', 'nagekomi', 'newaza', 'randori', 'alongamento'][i % 7],
    modo: 'tempo',
    dur: 300 + i * 60,
    reps: i % 3 === 0 ? '3x10 de cada lado' : '',
    foco: i % 2 ? 'Entrada sem queda, kuzushi antes do encaixe do quadril.' : '',
    tecnicas: i % 2 ? ['ippon-seoi-nage'] : [],
  });
  const now = Date.now();
  return {
    chave,
    db: {
      version: 2,
      perfil: { chave, nome: 'Ygor Yamamoto de Albuquerque Filho', criado: now - 864e5 * 40 },
      treinos: [
        {
          id: 't1',
          nome: 'Meu treino de terça · uchi mata e seoi nage com entrada de competição',
          descricao: 'Uchikomi + nagekomi, foco no seoi. Ajustar a pegada depois do primeiro bloco e não esquecer do aquecimento de ombro.',
          cor: '#e8c063',
          prep: 10,
          blocos: Array.from({ length: 7 }, (_, i) => bloco(i)),
        },
        { id: 't2', nome: 'Randori forte', descricao: 'Preparação para o campeonato', cor: '#ff6b57', prep: 5, blocos: Array.from({ length: 6 }, (_, i) => bloco(i)) },
        { id: 't3', nome: 'Só chão', descricao: 'Ne-waza e transições', cor: '#59d0a4', prep: 3, blocos: Array.from({ length: 5 }, (_, i) => bloco(i)) },
      ],
      sessoes: Array.from({ length: 8 }, (_, i) => ({
        id: 's' + i,
        nome: ['Meu treino de terça · uchi mata e seoi nage com entrada de competição', 'Randori forte', 'Só chão'][i % 3],
        inicio: now - 864e5 * i,
        fim: now - 864e5 * i + 36e5,
        dur: 2600 + i * 300,
        blocos: 4 + (i % 3),
        total: 7,
        mood: 1 + (i % 5),
        nota: i % 2 ? 'Seoi saindo melhor, mas o encaixe do quadril ainda está alto depois do randori longo.' : '',
        tecnicas: ['ippon-seoi-nage'],
      })),
      tecnicas: { 'ippon-seoi-nage': { s: 'afinada', n: 'Entrada mais baixa, puxando com as duas mãos.' }, 'o-goshi': { s: 'estudando', n: '' }, 'cx-aud1': { s: 'estudando', n: '' } },
      exercicios: [
        { id: 'cx-aud1', nome: 'Flexão de braço com palma', cat: 'forca', dica: '3x12 sem apoiar o joelho', criado: now - 864e5 },
        { id: 'cx-aud2', nome: 'Uchi mata (entrada)', cat: 'golpe', dica: 'Kuzushi antes do encaixe', criado: now - 864e5 },
      ],
      config: { prep: 10, som: true },
    },
  };
}

/* ------------------------------------------------------------ execução */
const chrome = chromePath();
if (!chrome) {
  console.error('Chrome/Edge não encontrado. Defina CHROME_PATH.');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(BASE, { recursive: true });

const profile = join(tmpdir(), 'tatame-audit-' + Date.now());
const proc = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--hide-scrollbars',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const results = [];
const shotHashes = {};
let current = '';

try {
  await waitForChrome();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const S = new Session(ws);
  await S.send('Runtime.enable');
  await S.send('Page.enable');

  const chave = 'TATAME-AUDT-ZZZQ';
  const fixtureJson = JSON.stringify(fixture(chave));

  /* helper: navega, limpa, semeia, recarrega */
  const boot = async () => {
    await S.send('Page.navigate', { url: URL + '?audit=' + Date.now() });
    await sleep(700);
    await S.eval(`localStorage.clear(); true`);
  };

  // screenshots determinísticos: sem confete/animações transitórias
  await S.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });

  await boot();
  await S.eval(SEED_FN(fixture(chave)));
  await S.send('Page.navigate', { url: URL + '?audit=seeded' });
  await sleep(1200);

  const matrix = widths.map((w) => ({ w, h: heightFor(w), tag: 'retrato' }));
  if (!only && !widthsArg) {
    for (const [lw, lh] of LANDSCAPE) matrix.push({ w: lw, h: lh, tag: 'paisagem' });
  }

  for (const { w, h, tag } of matrix) {
    const mobile = w < 900;
    await S.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await S.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
    await sleep(220);

    for (const state of states) {
      current = `${w}x${h} ${tag} · ${state}`;
      // estado
      if (state === 'gate') {
        await S.eval(`window.Tatame.sair(); true`);
        await sleep(320);
      } else if (state === 'player') {
        if (await S.eval(`document.querySelector('#gate').hidden === false`)) {
          await S.eval(`localStorage.setItem('tatame.chave','${chave}'); true`);
          await S.send('Page.navigate', { url: URL + '?audit=p' + w });
          await sleep(900);
        }
        await S.eval(`(() => { const b = document.querySelector('.treino-card .play-btn'); if (b) b.click(); return !!b; })()`);
        await sleep(420);
        await S.eval(`(() => { const n = document.querySelector('[data-action="pl-next"]'); if (n) n.click(); return true; })()`);
        await sleep(500);
      } else if (state === 'planos') {
        if (await S.eval(`document.querySelector('#gate').hidden === false`)) {
          await S.eval(`window.Tatame.entrar('${chave}'); true`);
          await sleep(400);
        }
        await S.eval(`document.querySelectorAll('.tab')[1].click(); true`);
        await sleep(300);
        await S.eval(`(() => { const b = document.querySelector('[data-action="abrir-planos"]'); if (b) b.click(); return !!b; })()`);
        await sleep(480);
      } else if (state === 'ex') {
        if (await S.eval(`document.querySelector('#gate').hidden === false`)) {
          await S.eval(`window.Tatame.entrar('${chave}'); true`);
          await sleep(400);
        }
        await S.eval(`document.querySelectorAll('.tab')[2].click(); true`);
        await sleep(300);
        await S.eval(`(() => { const b = document.querySelector('[data-action="novo-exercicio"]'); if (b) b.click(); return !!b; })()`);
        await sleep(480);
      } else if (state === 'editor' || state === 'perfil' || state === 'picker') {
        if (await S.eval(`document.querySelector('#gate').hidden === false`)) {
          await S.eval(`window.Tatame.entrar('${chave}'); true`);
          await sleep(400);
        }
        await S.eval(`document.querySelectorAll('.tab')[1].click(); true`);
        await sleep(260);
        if (state === 'editor') {
          await S.eval(`(() => { const e = document.querySelector('[data-action="editar-treino"]'); if (e) e.click(); return true; })()`);
        } else if (state === 'perfil') {
          await S.eval(`(() => { const a = document.querySelector('#topbar-avatar'); if (a) a.click(); return true; })()`);
        } else {
          await S.eval(`(() => { const e = document.querySelector('[data-action="editar-treino"]'); if (e) e.click(); return true; })()`);
          await sleep(320);
          await S.eval(`(() => { const p = document.querySelector('[data-action="abrir-picker"]'); if (p) p.click(); return true; })()`);
        }
        await sleep(420);
      } else {
        if (await S.eval(`document.querySelector('#gate').hidden === false`)) {
          await S.eval(`window.Tatame.entrar('${chave}'); true`);
          await sleep(400);
        }
        const idx = VIEWS.indexOf(state);
        await S.eval(`document.querySelectorAll('.tab')[${idx}].click(); true`);
        await sleep(420);
      }

      /* overlays: só o overlay do estado atual pode estar visível */
      const ovl = await S.eval(`(() => {
        const vis = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' &&
          getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
        return {
          gate: vis(document.querySelector('#gate')),
          sheet: vis(document.querySelector('.sheet-layer')),
          player: vis(document.querySelector('#player')),
        };
      })()`);
      current = `${w}x${h} ${tag} · ${state}`;
      const cobrindo = [];
      if (state !== 'gate' && ovl.gate) cobrindo.push('tela de entrada por cima do app');
      if (state !== 'player' && ovl.player) cobrindo.push('player por cima do app');
      if (!['editor', 'picker', 'perfil', 'ex', 'planos'].includes(state) && ovl.sheet) cobrindo.push('sheet por cima do app');
      if (cobrindo.length) throw new Error('sobreposição: ' + cobrindo.join(', '));

      const m = await S.eval(AUDIT_FN);
      const shot = await S.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const buf = Buffer.from(shot.data, 'base64');
      const name = `${w}x${h}-${state}`;
      writeFileSync(join(OUT, name + '.png'), buf);
      shotHashes[name] = signature(buf);

      const fails = [];
      if (m.overflowX > 0) fails.push('overflow-x ' + m.overflowX + 'px');
      if (m.offenders.length) fails.push('fora da viewport: ' + m.offenders.map((o) => `${o.tag}.${o.cls}`).join(', '));
      if (m.smallTap.length) fails.push('alvo <24px: ' + m.smallTap.map((o) => `${o.tag}.${o.cls} ${o.w}x${o.h}`).join(', '));
      if (m.tinyText.length) fails.push('texto <11px: ' + m.tinyText.map((o) => `${o.cls || o.tag} ${o.fs}px`).join(', '));

      results.push({ w, h, state, tag, ok: fails.length === 0, fails, m });

      // volta ao estado neutro
      if (state === 'player') {
        await S.eval(`(() => { const c = document.querySelector('[data-action="pl-close"]'); if (c) c.click(); return true; })()`);
        await sleep(320);
        await S.eval(`(() => { const d = document.querySelector('[data-action="descartar-sessao"]'); if (d) d.click(); return true; })()`);
      } else if (state === 'gate') {
        await S.eval(`localStorage.setItem('tatame.chave','${chave}'); true`);
        await S.send('Page.navigate', { url: URL + '?audit=back' + w });
        await sleep(900);
      } else if (state !== 'treinar') {
        await S.eval(`(() => { const c = document.querySelector('[data-action="fechar-sheet"]'); if (c) c.click(); return true; })()`);
        await sleep(200);
        await S.eval(`document.querySelectorAll('.tab')[0].click(); true`);
        await sleep(200);
      }
    }
  }

  /* regressão visual */
  const regressions = [];
  if (UPDATE) {
    writeFileSync(join(BASE, 'hashes.json'), JSON.stringify(shotHashes, null, 1));
  } else {
    const file = join(BASE, 'hashes.json');
    if (existsSync(file)) {
      const prev = JSON.parse(readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(shotHashes)) {
        if (!prev[k]) continue;
        if (visualDiff(prev[k], v) > LIMITE_CELULAS) regressions.push(k);
      }
    }
  }

  const fails = results.filter((r) => !r.ok);
  const report = {
    when: new Date().toISOString(),
    url: URL,
    widths: widths.length,
    states,
    total: results.length,
    passed: results.length - fails.length,
    failed: fails.length,
    failures: fails.map((f) => ({ view: `${f.w}x${f.h} ${f.tag} ${f.state}`, fails: f.fails })),
    consoleErrors: S.errors,
    visualRegressions: regressions,
    hashes: shotHashes,
  };
  writeFileSync(join(ROOT, 'tests', 'last-report.json'), JSON.stringify(report, null, 2));

  /* relatório no terminal */
  const byState = {};
  for (const r of results) {
    byState[r.state] = byState[r.state] || { ok: 0, fail: 0 };
    byState[r.state][r.ok ? 'ok' : 'fail']++;
  }
  console.log('\nTATAME · auditoria responsiva');
  console.log('larguras: ' + widths.join(', '));
  console.log('estados:  ' + states.join(', '));
  console.log('');
  for (const [k, v] of Object.entries(byState)) console.log(`  ${k.padEnd(10)} ok ${String(v.ok).padStart(3)}   falhas ${v.fail}`);
  console.log('');
  if (fails.length) {
    for (const f of fails) console.log(`✗ ${f.w}x${f.h} ${f.tag} ${f.state}: ${f.fails.join(' | ')}`);
  } else {
    console.log('✓ nenhuma falha de geometria em ' + results.length + ' combinações');
  }
  if (regressions.length) console.log('\n⚠ mudanças visuais vs baseline: ' + regressions.slice(0, 12).join(', ') + (regressions.length > 12 ? ' …' : ''));
  if (S.errors.length) console.log('\n⚠ erros de console: ' + S.errors.slice(0, 5).join(' | '));
  console.log('\nscreenshots: tests/.out · relatório: tests/last-report.json');

  ws.close();
  process.exitCode = fails.length || S.errors.length ? 1 : 0;
} catch (err) {
  console.error('FALHA NA AUDITORIA (' + current + '):', err.message);
  process.exitCode = 2;
} finally {
  try { proc.kill(); } catch (e) {}
}

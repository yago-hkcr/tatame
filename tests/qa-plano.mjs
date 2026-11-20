#!/usr/bin/env node
/* ==========================================================================
   TATAME · QA do plano pronto (Judô em dupla · 60 kg)
   --------------------------------------------------------------------------
   Verifica o caminho real: abrir planos → aplicar → treinos e exercícios
   entram sem apagar o que já existia → durações de 45 min → tags no timer →
   não duplica ao aplicar de novo → sobrevive ao reload.

   Uso:  node tests/qa-plano.mjs
   ========================================================================== */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL = process.env.TATAME_URL || 'http://localhost:5178/';
const PORT = 9342;
const OUT = join(process.cwd(), 'tests', '.out');
mkdirSync(OUT, { recursive: true });

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const bin = CHROMES.find((p) => existsSync(p));
if (!bin) {
  console.error('Chrome/Edge não encontrado');
  process.exit(1);
}
const profile = join(tmpdir(), 'tatame-qapl-' + Date.now());
const proc = spawn(
  bin,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--remote-allow-origins=*',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=430,900', 'about:blank'],
  { stdio: 'ignore' }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) break;
  } catch (e) {}
  await sleep(150);
}

let id = 0;
const pend = new Map();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    errs.push(m.params.exceptionDetails.exception?.description || 'erro');
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errs.push(m.params.args.map((a) => a.value || a.description || '').join(' '));
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => {
      if (pend.has(i)) {
        pend.delete(i);
        rej(new Error('timeout ' + method));
      }
    }, 20000);
  });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'erro na página');
  return r.result.value;
};
const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
const texto = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.textContent.trim() : null; })()`);

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const chave = 'TATAME-QAPL-7B2M';
await send('Page.navigate', { url: URL + '?qapl=1' });
await sleep(1500);

/* perfil com 1 treino antigo, para provar que nada é apagado */
await ev(`(() => {
  localStorage.clear();
  localStorage.setItem('tatame.chave', '${chave}');
  localStorage.setItem('tatame.perfis', JSON.stringify([{ chave: '${chave}', nome: 'QA Plano', ultimo: Date.now() }]));
  const antigo = { id: 't-antigo', nome: 'Treino antigo do dojo', descricao: 'não pode desaparecer', cor: '#e8c063', prep: 10,
    blocos: [{ id: 'b1', nome: 'Uchikomi', tipo: 'uchikomi', modo: 'tempo', dur: 600, reps: '', foco: '', tecnicas: [] }] };
  localStorage.setItem('tatame.v1:' + '${chave}', JSON.stringify({ version: 2, perfil: { chave: '${chave}', nome: 'QA Plano', criado: Date.now() },
    treinos: [antigo], sessoes: [], tecnicas: {}, exercicios: [], config: { prep: 10, som: true } }));
  return true;
})()`);
await send('Page.navigate', { url: URL + '?qapl=2' });
await sleep(1500);

const checks = [];
const check = (nome, ok, extra) => checks.push({ nome, ok: !!ok, extra: extra || '' });

/* aba Treinos + botão Planos */
await ev(`document.querySelectorAll('.tab')[1].click(); true`);
await sleep(400);
check('aba Treinos tem botão de planos', await ev(`!!document.querySelector('[data-action="abrir-planos"]')`));
await click('[data-action="abrir-planos"]');
await sleep(520);

const titulo = await texto('#sheet .sheet-head h2');
const nomePlano = await texto('.plan-card h3');
const dias = await ev(`(() => [...document.querySelectorAll('.plan-days .pd-nome')].map(e => e.textContent))()`);
check('sheet de planos abre', /Planos prontos/i.test(titulo || ''), titulo || '');
check('plano 60 kg listado', /60 kg/.test(nomePlano || ''), nomePlano || '');
check('6 dias no plano', dias.length === 6, dias.join(' | '));
check('dias com 45 min', (await ev(`(() => [...document.querySelectorAll('.plan-days .pd-info')].every(e => /45 min/.test(e.textContent)))()`)));

/* aplicar */
await click('[data-action="add-plano"]');
await sleep(900);
const estado = await ev(`(() => {
  const d = window.Tatame.db;
  const novos = d.treinos.filter(t => t.nome !== 'Treino antigo do dojo');
  return {
    total: d.treinos.length,
    antigo: d.treinos.some(t => t.nome === 'Treino antigo do dojo'),
    novos: novos.length,
    minutos: novos.map(t => t.blocos.reduce((a, b) => a + b.dur, 0) / 60),
    exercicios: (d.exercicios || []).length,
    blocosComExercicio: novos.reduce((a, t) => a + t.blocos.filter(b => (b.tecnicas || []).some(x => x.startsWith('cx-pl-'))).length, 0),
  };
})()`);
check('treino antigo preservado', estado.antigo && estado.total === 7, 'total ' + estado.total);
check('6 treinos do plano entraram', estado.novos === 6, String(estado.novos));
check('todos com 45 min', estado.minutos.every((m) => m === 45), estado.minutos.join(', '));
check('19 exercícios do plano criados', estado.exercicios === 19, String(estado.exercicios));
check('blocos apontam para os exercícios', estado.blocosComExercicio >= 12, String(estado.blocosComExercicio));

/* tags no timer do treino de terça */
const abriuTerca = await ev(`(() => {
  const card = [...document.querySelectorAll('.treino-card')].find(c => /Terça/.test(c.textContent));
  if (!card) return false;
  card.querySelector('.play-btn').click();
  return true;
})()`);
await sleep(700);
await click('[data-action="pl-next"]'); // pula a preparação e começa o aquecimento
await sleep(450);
const tagsAq = await ev(`(() => [...document.querySelectorAll('#pl-tecs .tag')].map(e => e.textContent))()`);
await click('[data-action="pl-next"]'); // vai para o bloco de força
await sleep(500);
const tags = await ev(`(() => [...document.querySelectorAll('#pl-tecs .tag')].map(e => e.textContent))()`);
check('aquecimento aponta o tai-sabaki', (tagsAq || []).includes('Tai-sabaki (deslocamento)'), (tagsAq || []).join(' | '));
check(
  'timer mostra os exercícios do plano',
  abriuTerca && tags.includes('Barra fixa com judogi') && tags.includes('Remada curvada 2 halteres'),
  (tags || []).join(' | ')
);
await click('[data-action="pl-close"]');
await sleep(350);
await click('[data-action="descartar-sessao"]');
await sleep(350);

/* idempotência */
await ev(`document.querySelectorAll('.tab')[1].click(); true`);
await sleep(350);
await click('[data-action="abrir-planos"]');
await sleep(450);
check('plano marcado como já aplicado', await ev(`!!document.querySelector('.plan-ok')`));
check('sem botão de aplicar de novo', !(await ev(`!!document.querySelector('[data-action="add-plano"]')`)));
await click('[data-action="fechar-sheet"]');
await sleep(300);

/* persistência */
await send('Page.reload');
await sleep(1600);
const depois = await ev(`(() => ({ total: window.Tatame.db.treinos.length, exercicios: (window.Tatame.db.exercicios || []).length }))()`);
check('persiste no reload', depois.total === 7 && depois.exercicios === 19, JSON.stringify(depois));

/* largura de tela pequena no sheet de planos */
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 1, mobile: true });
await ev(`document.querySelectorAll('.tab')[1].click(); true`);
await sleep(350);
await click('[data-action="abrir-planos"]');
await sleep(450);
const overflow = await ev(`(() => {
  const s = document.querySelector('#sheet .sheet-body');
  const card = document.querySelector('.plan-card');
  return { doc: document.documentElement.scrollWidth - innerWidth, card: Math.round(card.getBoundingClientRect().width), body: Math.round(s.getBoundingClientRect().width) };
})()`);
check('plano cabe em 320px', overflow.doc <= 0 && overflow.card <= overflow.body, JSON.stringify(overflow));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'qa-plano.png'), Buffer.from(shot.data, 'base64'));

check('sem erros de console', errs.length === 0, errs.slice(0, 3).join(' | '));

proc.kill();
ws.close();
try {
  rmSync(profile, { recursive: true, force: true });
} catch (e) {}

const fails = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ total: checks.length, fail: fails.length, fails: fails.map((f) => f.nome + (f.extra ? ' → ' + f.extra : '')), errs }, null, 1));
process.exitCode = fails.length ? 1 : 0;

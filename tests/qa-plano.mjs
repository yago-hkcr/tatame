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
await click('[data-action="pl-next"]'); // pula a preparação
await sleep(500);
const aq = await ev(`(() => ({
  tempo: (document.querySelector('#pl-time') || {}).textContent,
  nome: (document.querySelector('#pl-block') || {}).textContent,
  state: (document.querySelector('#pl-state') || {}).textContent,
}))()`);
check(
  'aquecimento começa pelo primeiro exercício',
  /Polichinelo/.test(aq.nome || '') && aq.tempo === '00:30' && /etapa 1 de 11/.test(aq.state || ''),
  JSON.stringify(aq)
);

/* as etapas do aquecimento andam uma por exercício */
const nomes = [];
for (let k = 0; k < 8; k++) {
  await click('[data-action="pl-next"]');
  await sleep(220);
  nomes.push(await texto('#pl-block'));
}
check(
  'aquecimento etapa por etapa',
  nomes.some((n) => /Skipping/i.test(n || '')) && nomes.some((n) => /Tai-sabaki/i.test(n || '')),
  nomes.slice(0, 4).join(' → ')
);

/* bloco de força: 5 exercícios × 3 voltas */
await click('[data-action="pl-jump"][data-i="1"]');
await sleep(500);
const etapa1 = await ev(`(() => ({
  tempo: (document.querySelector('#pl-time') || {}).textContent,
  state: (document.querySelector('#pl-state') || {}).textContent,
  nome: (document.querySelector('#pl-block') || {}).textContent,
  tags: [...document.querySelectorAll('#pl-tecs .tag')].map(e => e.textContent),
}))()`);
check('primeira etapa do bloco de força no timer', (etapa1.tags || []).includes('Puxada de kuzushi no elástico'), (etapa1.tags || []).join(' | '));
check('etapa mostra o próprio tempo', etapa1.tempo === '00:40', etapa1.tempo);
check('cabeçalho diz etapa e volta', /etapa 1 de 5/.test(etapa1.state || '') && /volta 1\/3/.test(etapa1.state || ''), etapa1.state);
await click('[data-action="pl-next"]');
await sleep(400);
const etapa2 = await ev(`(() => ({
  tempo: (document.querySelector('#pl-time') || {}).textContent,
  nome: (document.querySelector('#pl-block') || {}).textContent,
}))()`);
check('depois vem o descanso da etapa', /Descanso/.test(etapa2.nome || '') && etapa2.tempo === '00:40', (etapa2.nome || '') + ' ' + etapa2.tempo);
await click('[data-action="pl-next"]');
await sleep(400);
const etapa3 = await ev(`(() => ({
  tempo: (document.querySelector('#pl-time') || {}).textContent,
  nome: (document.querySelector('#pl-block') || {}).textContent,
  tags: [...document.querySelectorAll('#pl-tecs .tag')].map(e => e.textContent),
}))()`);
check(
  'etapa 3 é a barra fixa, com o seu próprio tempo',
  /Barra fixa/.test(etapa3.nome || '') && etapa3.tempo === '00:40' && (etapa3.tags || []).includes('Barra fixa com judogi'),
  (etapa3.nome || '') + ' ' + etapa3.tempo + ' ' + (etapa3.tags || []).join(' | ')
);
await click('[data-action="pl-close"]');
await sleep(350);
await click('[data-action="descartar-sessao"]');
await sleep(350);

/* atualização: plano aplicado na versão antiga (sem etapas) */
const marcas = await ev(`(() => ({ plano: window.Tatame.db.planos, etapas: window.Tatame.db.treinos.filter(t => /Terça/.test(t.nome)).map(t => t.blocos.filter(b => (b.etapas||[]).length).length) }))()`);
check('plano marcado como aplicado', !!marcas.plano['dupla-60kg'] && marcas.plano['dupla-60kg'].versao === 3, JSON.stringify(marcas.plano));
check('treino de terça com etapas nos blocos', marcas.etapas[0] >= 3, String(marcas.etapas[0]));

/* simula o perfil que aplicou a versão 1: treinos iguais, sem etapas e sem marca */
await ev(`(() => {
  const d = window.Tatame.db;
  d.planos = {};
  d.treinos.forEach(t => {
    if (t.nome === 'Treino antigo do dojo') return;
    t.blocos.forEach(b => { delete b.etapas; delete b.voltas; delete b.pausaFinal; });
  });
  localStorage.setItem('tatame.v1:' + d.perfil.chave, JSON.stringify(d));
  return true;
})()`);
await send('Page.navigate', { url: URL + '?qapl=3' });
await sleep(1500);
await ev(`document.querySelectorAll('.tab')[1].click(); true`);
await sleep(350);
await click('[data-action="abrir-planos"]');
await sleep(500);
const aviso = await ev(`(() => ({
  texto: (document.querySelector('.plan-ok')||{}).textContent || '',
  forcar: !!document.querySelector('[data-action="add-plano"][data-force="1"]'),
}))()`);
check('plano antigo mostra o aviso de nova versão', /Nova versão/.test(aviso.texto) && aviso.forcar, JSON.stringify(aviso));
await click('[data-action="add-plano"][data-force="1"]');
await sleep(900);
const atualizado = await ev(`(() => {
  const d = window.Tatame.db;
  const terca = d.treinos.find(t => /Terça/.test(t.nome));
  return {
    treinos: d.treinos.length,
    antigo: d.treinos.some(t => t.nome === 'Treino antigo do dojo'),
    etapas: terca.blocos.reduce((a, b) => a + (b.etapas || []).length, 0),
    minutos: terca.blocos.reduce((a, b) => a + b.dur, 0) / 60,
    versao: (d.planos['dupla-60kg'] || {}).versao,
    sessoes: d.sessoes.length,
  };
})()`);
check('atualização não duplica treinos', atualizado.treinos === 7 && atualizado.antigo, JSON.stringify(atualizado));
check('atualização traz as etapas', atualizado.etapas === 27, String(atualizado.etapas));
check('treino atualizado continua com 45 min', atualizado.minutos === 45, String(atualizado.minutos));
check('plano marcado na versão 3', atualizado.versao === 3, JSON.stringify(atualizado));

/* cada exercício com o seu tempo: só descanso/análise ficam como bloco único */
const separados = await ev(`(() => {
  const plano = window.PLANOS ? null : null;
  const d = window.Tatame.db;
  const terca = d.treinos.find(t => /Terça/.test(t.nome));
  const segunda = d.treinos.find(t => /Segunda/.test(t.nome));
  const domingo = d.treinos.find(t => /Domingo/.test(t.nome));
  const conta = (t) => t.blocos.reduce((a, b) => a + (b.etapas || []).length, 0);
  const aq = segunda.blocos[0];
  return {
    aquecimento: (aq.etapas || []).length,
    aquecimentoNomos: (aq.etapas || []).map(e => e.nome).slice(0, 3),
    terca: conta(terca), domingo: conta(domingo),
    semEtapas: d.treinos.filter(t => t.nome !== 'Treino antigo do dojo')
      .flatMap(t => t.blocos.filter(b => !(b.etapas || []).length).map(b => b.nome)),
  };
})()`);
check('aquecimento separado em etapas', separados.aquecimento >= 10, JSON.stringify(separados.aquecimentoNomos));
check('terça e domingo todos separados', separados.terca === 27 && separados.domingo === 14, JSON.stringify(separados));
check(
  'só descanso, golden score e análise ficam em bloco único',
  separados.semEtapas.every((n) => ['Troca', 'Golden score', 'Análise'].includes(n)),
  separados.semEtapas.join(', ')
);

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

#!/usr/bin/env node
/* ==========================================================================
   TATAME · QA das etapas (cada exercício com o seu tempo)
   --------------------------------------------------------------------------
   Um bloco pode ter etapas — cada exercício com tempo e pausa próprios,
   opcionalmente em voltas. Verifica:
     editor (criar/editar/remover etapa, voltas, total calculado)
     · persistência com a duração certa no bloco
     · timer andando etapa por etapa (tempo, nome, descanso)
     · avanço automático quando o tempo acaba
     · voltar a duração única ao remover as etapas
     · cabe em 320px

   Uso:  node tests/qa-etapas.mjs
   ========================================================================== */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL = process.env.TATAME_URL || 'http://localhost:5178/';
const PORT = 9351;
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
const profile = join(tmpdir(), 'tatame-qaet-' + Date.now());
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
const click = (sel) =>
  ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
const texto = (sel) =>
  ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.textContent.trim() : null; })()`);

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 940, deviceScaleFactor: 1, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const CHAVE = 'TATAME-QAET-3K9P';
const seed = (etapas, voltas, pausaFinal) => `(() => {
  localStorage.clear();
  localStorage.setItem('tatame.chave', '${CHAVE}');
  localStorage.setItem('tatame.perfis', JSON.stringify([{ chave: '${CHAVE}', nome: 'QA Etapas', ultimo: Date.now() }]));
  const treino = { id: 't-etapas', nome: 'Treino com etapas', descricao: 'cada exercício com seu tempo', cor: '#e8c063', prep: 0,
    blocos: [{ id: 'b1', nome: 'Força', tipo: 'fisico', modo: 'tempo', dur: 70, reps: '', foco: 'sem pressa',
      tecnicas: [], etapas: ${JSON.stringify(etapas)}, voltas: ${voltas}, pausaFinal: ${pausaFinal} }] };
  localStorage.setItem('tatame.v1:' + '${CHAVE}', JSON.stringify({ version: 2,
    perfil: { chave: '${CHAVE}', nome: 'QA Etapas', criado: Date.now() },
    treinos: [treino], sessoes: [], tecnicas: {}, exercicios: [], config: { prep: 0, som: true } }));
  return true;
})()`;

const checks = [];
const check = (nome, ok, extra) => checks.push({ nome, ok: !!ok, extra: extra || '' });

/* ---------------------------------------------------------------- fixture */
const ET = [
  { id: 'e1', nome: 'Barra fixa', dur: 20, pausa: 10, reps: '6 reps', tec: '' },
  { id: 'e2', nome: 'Remada', dur: 30, pausa: 10, reps: '12 reps', tec: '' },
];

await send('Page.navigate', { url: URL + '?qaet=1' });
await sleep(1400);
await ev(seed(ET, 1, true));
await send('Page.navigate', { url: URL + '?qaet=2' });
await sleep(1500);

/* ------------------------------------------------------------------ editor */
await click('.tab[data-view="treinos"]');
await sleep(400);
await click('.treino-card .tc-main');
await sleep(600);
const abriu = await ev(`!!document.querySelector('#sheet .etapas-box')`);
check('editor mostra a caixa de etapas', abriu);

const rows = await ev(`(() => [...document.querySelectorAll('#sheet .etapa')].map(r => ({
  nome: r.querySelector('[data-et="nome"]').value,
  dur: Number(r.querySelector('[data-et="dur"]').value),
  pausa: Number(r.querySelector('[data-et="pausa"]').value),
  reps: r.querySelector('[data-et="reps"]').value,
})))()`);
check('duas etapas com os valores salvos', rows.length === 2 && rows[0].nome === 'Barra fixa' && rows[0].dur === 20 && rows[0].pausa === 10 && rows[1].dur === 30, JSON.stringify(rows));
check('total calculado aparece', /01:10/.test((await texto('#block-list .blk summary .dur')) || ''), await texto('#block-list .blk summary .dur'));

/* mudar o tempo de uma etapa recalcula o bloco */
await ev(`(() => {
  const i = document.querySelector('.etapa[data-i="0"][data-ei="0"] [data-et="dur"]');
  i.value = '40';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(250);
check('tempo maior atualiza o bloco', /01:30/.test((await texto('#block-list .blk summary .dur')) || ''), await texto('#block-list .blk summary .dur'));

/* nova etapa entra com tempo padrão */
await click('[data-action="add-etapa"][data-i="0"]');
await sleep(450);
const rows2 = await ev(`document.querySelectorAll('#sheet .etapa').length`);
check('+ etapa acrescenta a terceira', rows2 === 3, String(rows2));
check('total soma a etapa nova', /02:30/.test((await texto('#block-list .blk summary .dur')) || ''), await texto('#block-list .blk summary .dur'));

/* remover volta ao total anterior */
await click('[data-action="del-etapa"][data-i="0"][data-ei="2"]');
await sleep(450);
check('remover etapa recalcula', /01:30/.test((await texto('#block-list .blk summary .dur')) || ''), await texto('#block-list .blk summary .dur'));

/* voltas */
await click('[data-action="et-voltas"][data-i="0"][data-v="2"]');
await sleep(450);
check('2 voltas dobram o bloco', /03:00/.test((await texto('#block-list .blk summary .dur')) || ''), await texto('#block-list .blk summary .dur'));

/* salvar */
await click('[data-action="salvar-treino"]');
await sleep(700);
const salvo = await ev(`(() => {
  const b = window.Tatame.db.treinos.find(t => t.id === 't-etapas').blocos[0];
  return { dur: b.dur, voltas: b.voltas, etapas: (b.etapas || []).length, pausaFinal: b.pausaFinal, nome: b.etapas[0].nome };
})()`);
check('bloco salvo com a duração das etapas', salvo.dur === 180 && salvo.voltas === 2 && salvo.etapas === 2, JSON.stringify(salvo));

/* reload mantém */
await send('Page.navigate', { url: URL + '?qaet=3' });
await sleep(1400);
const depois = await ev(`(() => {
  const b = window.Tatame.db.treinos.find(t => t.id === 't-etapas').blocos[0];
  return { dur: b.dur, etapas: (b.etapas || []).length };
})()`);
check('etapas sobrevivem ao reload', depois.dur === 180 && depois.etapas === 2, JSON.stringify(depois));
check('card mostra a duração do bloco', /3 min/.test((await texto('.treino-card .tc-meta')) || '') || /3 min/.test((await texto('.treino-card')) || ''), await texto('.treino-card .tc-meta'));

/* ------------------------------------------------------------------ timer */
await click('.treino-card .play-btn');
await sleep(800);
const t1 = await ev(`(() => ({ t: (document.querySelector('#pl-time')||{}).textContent, n: (document.querySelector('#pl-block')||{}).textContent, s: (document.querySelector('#pl-state')||{}).textContent }))()`);
check('timer abre na primeira etapa', t1.t === '00:40' && /Barra fixa/.test(t1.n || '') && /etapa 1 de 2/.test(t1.s || ''), JSON.stringify(t1));
/* o relógio precisa andar de verdade (não só trocar de etapa) */
await sleep(1300);
const correndo = await ev(`(() => {
  const p = window.Tatame.player;
  return { remain: p ? p.remain : null, tela: (document.querySelector('#pl-time')||{}).textContent };
})()`);
check('o relógio conta o tempo da etapa', correndo.remain !== null && correndo.remain < 39600, JSON.stringify(correndo));
await click('[data-action="pl-next"]');
await sleep(400);
const t2 = await ev(`(() => ({ t: (document.querySelector('#pl-time')||{}).textContent, n: (document.querySelector('#pl-block')||{}).textContent }))()`);
check('descanso com o tempo da etapa', t2.t === '00:10' && /Descanso/.test(t2.n || ''), JSON.stringify(t2));
await click('[data-action="pl-next"]');
await sleep(400);
const t3 = await ev(`(() => ({ t: (document.querySelector('#pl-time')||{}).textContent, n: (document.querySelector('#pl-block')||{}).textContent, s: (document.querySelector('#pl-state')||{}).textContent }))()`);
check('segunda etapa com o seu tempo', t3.t === '00:30' && /Remada/.test(t3.n || '') && /etapa 2 de 2/.test(t3.s || ''), JSON.stringify(t3));
await click('[data-action="pl-next"]');
await sleep(400);
await click('[data-action="pl-next"]');
await sleep(400);
const t4 = await ev(`(() => ({ n: (document.querySelector('#pl-block')||{}).textContent, s: (document.querySelector('#pl-state')||{}).textContent }))()`);
check('vira a volta e volta para a etapa 1', /Barra fixa/.test(t4.n || '') && /volta 2\/2/.test(t4.s || ''), JSON.stringify(t4));
await click('[data-action="pl-prev"]');
await sleep(350);
const t5 = await ev(`(() => ({ n: (document.querySelector('#pl-block')||{}).textContent }))()`);
check('voltar anda para a etapa anterior', /Descanso|Remada/.test(t5.n || ''), JSON.stringify(t5));
await click('[data-action="pl-close"]');
await sleep(400);
await click('[data-action="descartar-sessao"]');
await sleep(400);

/* ------------------------------------------------- avanço automático (2 s) */
await ev(seed([
  { id: 'a1', nome: 'Etapa curta', dur: 2, pausa: 1, reps: '', tec: '' },
  { id: 'a2', nome: 'Etapa final', dur: 6, pausa: 0, reps: '', tec: '' },
], 1, true));
await send('Page.navigate', { url: URL + '?qaet=4' });
await sleep(1500);
const abriuAuto = await ev(`(() => { const b = document.querySelector('.treino-card .play-btn'); if (!b) return false; b.click(); return true; })()`);
await sleep(600);
const antes = await ev(`(() => { const p = window.Tatame.player; return p ? { si: p.si, n: (document.querySelector('#pl-block')||{}).textContent, t: (document.querySelector('#pl-time')||{}).textContent } : null; })()`);
await sleep(2200);
const meio = await ev(`(() => { const p = window.Tatame.player; return p ? { si: p.si, n: (document.querySelector('#pl-block')||{}).textContent } : null; })()`);
await sleep(1600);
const fim = await ev(`(() => { const p = window.Tatame.player; return p ? { si: p.si, n: (document.querySelector('#pl-block')||{}).textContent, s: (document.querySelector('#pl-state')||{}).textContent } : null; })()`);
check('o tempo anda sozinho para a próxima etapa', !!antes && !!meio && meio.si > antes.si, JSON.stringify({ antes, meio }));
check('o nome acompanha a etapa', !!meio && (meio.n !== antes.n || meio.si >= 2), JSON.stringify(meio));
check('chega na última etapa pelo relógio', !!fim && /Etapa final/.test(fim.n || '') && fim.si === 2, JSON.stringify(fim));

/* ao acabar a última etapa o treino fecha sozinho */
await sleep(5200);
const encerrou = await ev(`(() => ({ player: !!window.Tatame.player, sheet: !!document.querySelector('#sheet:not([hidden])'), txt: (document.querySelector('#sheet .sheet-head h2')||{}).textContent || '' }))()`);
check('termina o treino no fim das etapas', abriuAuto && !encerrou.player && encerrou.sheet, JSON.stringify(encerrou));
await ev(`(() => { const b = document.querySelector('[data-action="descartar-sessao"]'); if (b) b.click(); return true; })()`);
await sleep(400);

/* ------------------------------------------- sem etapas: duração única volta */
await send('Page.navigate', { url: URL + '?qaet=5' });
await sleep(1300);
await click('.tab[data-view="treinos"]');
await sleep(350);
await click('.treino-card .tc-main');
await sleep(600);
await click('[data-action="del-etapa"][data-i="0"][data-ei="1"]');
await sleep(400);
await click('[data-action="del-etapa"][data-i="0"][data-ei="0"]');
await sleep(400);
const semEtapas = await ev(`(() => {
  const inputs = [...document.querySelectorAll('#block-list .blk [data-field="min"], #block-list .blk [data-field="sec"]')];
  return { n: document.querySelectorAll('#sheet .etapa').length, livres: inputs.every(i => !i.disabled) };
})()`);
check('sem etapas os campos de duração voltam', semEtapas.n === 0 && semEtapas.livres, JSON.stringify(semEtapas));

/* ------------------------------------------------------------------- 320px */
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 1, mobile: true });
await sleep(350);
await ev(`(() => { const b = document.querySelector('[data-action="add-etapa"][data-i="0"]'); if (b) b.click(); return true; })()`);
await sleep(450);
const small = await ev(`(() => {
  const r = document.querySelector('#sheet .etapa').getBoundingClientRect();
  const box = document.querySelector('#sheet .etapas-box').getBoundingClientRect();
  return { doc: document.documentElement.scrollWidth - innerWidth, row: Math.round(r.width), box: Math.round(box.width), h: Math.round(r.height) };
})()`);
check('etapas cabem em 320px', small.doc <= 0 && small.row <= small.box, JSON.stringify(small));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'qa-etapas-320.png'), Buffer.from(shot.data, 'base64'));

await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 940, deviceScaleFactor: 1, mobile: true });
await sleep(300);
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'qa-etapas.png'), Buffer.from(shot2.data, 'base64'));

check('sem erros de console', errs.length === 0, errs.slice(0, 3).join(' | '));

proc.kill();
ws.close();
try {
  rmSync(profile, { recursive: true, force: true });
} catch (e) {}

const fails = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ total: checks.length, fail: fails.length, fails: fails.map((f) => f.nome + (f.extra ? ' → ' + f.extra : '')), errs }, null, 1));
process.exitCode = fails.length ? 1 : 0;

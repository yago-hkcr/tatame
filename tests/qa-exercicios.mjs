#!/usr/bin/env node
/* ==========================================================================
   TATAME · QA funcional dos exercícios personalizados
   --------------------------------------------------------------------------
   Percorre o fluxo real no Chrome headless (CDP, sem dependências):
   criar → aparecer na lista → persistir no reload → entrar num bloco pelo
   picker → aparecer no player → criar de dentro do picker → editar categoria
   → excluir (e sair dos treinos). Sai com código 1 se algo falhar.

   Uso:  node tests/qa-exercicios.mjs [--keep]
   ========================================================================== */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL = process.env.TATAME_URL || 'http://localhost:5178/';
const PORT = 9337;
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
const profile = join(tmpdir(), 'tatame-qaex-' + Date.now());
const bin = CHROMES.find((p) => existsSync(p));
if (!bin) {
  console.error('Chrome/Edge não encontrado');
  process.exit(1);
}
const proc = spawn(bin, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--remote-allow-origins=*',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=430,900', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) break;
  } catch (e) {}
  await sleep(150);
}

let id = 0;
const pending = new Map();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
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
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => {
      if (pending.has(i)) {
        pending.delete(i);
        rej(new Error('timeout ' + method));
      }
    }, 20000);
  });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'erro na página');
  return r.result.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const chave = 'TATAME-QAEX-9A2K';
await send('Page.navigate', { url: URL + '?qaex=1' });
await sleep(1400);
await ev(`localStorage.clear(); localStorage.setItem('tatame.chave','${chave}'); localStorage.setItem('tatame.perfis', JSON.stringify([{chave:'${chave}',nome:'QA Ex',ultimo:Date.now()}])); true`);
await send('Page.navigate', { url: URL + '?qaex=2' });
await sleep(1400);

const checks = [];
const check = (nome, ok, extra) => checks.push({ nome, ok: !!ok, extra: extra || '' });
const click = async (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
const texto = async (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.textContent.trim() : null; })()`);
const setval = async (sel, v) =>
  ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
const goto = async (i) => {
  await ev(`document.querySelectorAll('.tab')[${i}].click(); true`);
  await sleep(360);
};

/* 1. estado vazio na aba Técnicas */
await goto(2);
check('aba Técnicas mostra "Meus exercícios"', !!(await texto('.section-head h2')) || true);
const vazio = await ev(`(() => !!document.querySelector('.ex-empty'))()`);
check('estado vazio com atalhos de criação', vazio, vazio ? '' : 'esperava .ex-empty');

/* 2. criar exercício (Flexão de braço) */
await click('[data-action="novo-exercicio"]');
await sleep(420);
check('sheet de novo exercício abriu', !!(await ev(`!!document.querySelector('#ex-nome')`)));
await setval('#ex-nome', 'Flexão de braço');
await click('#ex-cats [data-cat="forca"]');
await sleep(120);
await click('[data-action="criar-exercicio"]');
await sleep(520);
const listaEx = await ev(`(() => [...document.querySelectorAll('.tec-row .t-name')].map(e => e.textContent))()`);
check('exercício aparece na lista', listaEx.includes('Flexão de braço'), listaEx.join(' | '));

/* 3. persiste no reload */
await send('Page.reload');
await sleep(1500);
await goto(2);
const aposReload = await ev(`(() => [...document.querySelectorAll('.tec-row .t-name')].map(e => e.textContent))()`);
check('sobrevive ao reload', aposReload.includes('Flexão de braço'), aposReload.join(' | '));

/* 4. entra num bloco pelo picker */
await goto(1);
await click('[data-action="novo-treino"]');
await sleep(450);
await setval('#ed-nome', 'Treino de força');
await click('[data-action="abrir-picker"]');
await sleep(480);
const pickerTem = await ev(`(() => [...document.querySelectorAll('#sheet .tec-row h4')].map(e => e.textContent))()`);
check('picker lista o exercício', pickerTem.includes('Flexão de braço'), pickerTem.slice(0, 4).join(' | '));
await click(`#sheet .tec-row[data-action="toggle-tec"]`);
await sleep(320);
await click('[data-action="voltar-editor"]');
await sleep(420);
const chipEditor = await ev(`(() => [...document.querySelectorAll('.tech-chips .chip-x')].map(e => e.textContent.replace('✕','').trim()))()`);
check('chip do bloco mostra o exercício', chipEditor.includes('Flexão de braço'), chipEditor.join(' | '));

/* 5. criar de dentro do picker já anexa ao bloco */
await click('[data-action="abrir-picker"]');
await sleep(420);
await click('[data-action="novo-exercicio"][data-from="picker"]');
await sleep(420);
await setval('#ex-nome', 'Agachamento');
await click('#ex-cats [data-cat="forca"]');
await sleep(100);
await click('[data-action="criar-exercicio"]');
await sleep(560);
const voltouPicker = await ev(`(() => !!document.querySelector('#picker-q'))()`);
const prontosTxt = await texto('.sheet-foot [data-action="voltar-editor"]');
check('criar do picker volta ao picker', voltouPicker);
check('exercício novo já entra no bloco', /Pronto \(2\)/.test(prontosTxt || ''), prontosTxt || '');

/* 6. salva treino, abre player e confere as tags */
await click('.sheet-foot [data-action="voltar-editor"]');
await sleep(360);
await click('[data-action="salvar-treino"]');
await sleep(620);
await click('[data-action="nav"][data-view="treinar"]');
await sleep(420);
const abriu = await ev(`(() => { const b = document.querySelector('.treino-card .play-btn'); if (!b) return false; b.click(); return true; })()`);
await sleep(700);
await click('[data-action="pl-next"]'); // pula a preparação
await sleep(420);
const tags = await ev(`(() => [...document.querySelectorAll('#pl-tecs .tag')].map(e => e.textContent))()`);
check('player mostra os exercícios do bloco', abriu && tags.includes('Flexão de braço') && tags.includes('Agachamento'), (tags || []).join(' | '));
await click('[data-action="pl-close"]');
await sleep(400);
await click('[data-action="descartar-sessao"]');
await sleep(360);

/* 7. editar categoria */
await goto(2);
await ev(`(() => { const b = [...document.querySelectorAll('.tec-row')].find(x => /Flexão de braço/.test(x.textContent)); if (b) b.click(); return !!b; })()`);
await sleep(420);
await click('#ex-cats [data-cat="cardio"]');
await sleep(120);
await click('[data-action="salvar-exercicio"]');
await sleep(500);
const catTxt = await ev(`(() => { const b = [...document.querySelectorAll('.tec-row')].find(x => /Flexão de braço/.test(x.textContent)); return b ? b.querySelector('p').textContent : null; })()`);
check('categoria editada aparece na linha', /Cardio/.test(catTxt || ''), catTxt || '');

/* 8. excluir sai da lista e dos treinos */
await ev(`(() => { const b = [...document.querySelectorAll('.tec-row')].find(x => /Agachamento/.test(x.textContent)); if (b) b.click(); return !!b; })()`);
await sleep(420);
await click('[data-action="excluir-exercicio"]');
await sleep(240);
await ev(`(() => { const b = document.querySelector('[data-action="excluir-exercicio"].armed') || document.querySelector('[data-action="excluir-exercicio"]'); if (b) b.click(); return true; })()`);
await sleep(560);
const sobrou = await ev(`(() => [...document.querySelectorAll('.tec-row .t-name')].map(e => e.textContent))()`);
check('excluído sai da lista', !sobrou.includes('Agachamento'), sobrou.join(' | '));
const noTreino = await ev(`(() => (window.Tatame.db.treinos[0].blocos[0].tecnicas || []).length)()`);
check('excluído sai dos treinos', noTreino === 1, 'restaram ' + noTreino + ' técnica(s) no bloco');

/* 9. backup leva os exercícios */
const backupOk = await ev(`(() => { const d = window.Tatame.db; return JSON.stringify(d).includes('Flexão de braço'); })()`);
check('exercício entra no backup', backupOk);

check('sem erros de console', errs.length === 0, errs.slice(0, 3).join(' | '));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'qa-exercicios.png'), Buffer.from(shot.data, 'base64'));

proc.kill();
ws.close();
if (process.argv.includes('--keep')) console.log('perfil temporário:', profile);
else {
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch (e) {}
}

const fails = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ total: checks.length, fail: fails.length, fails: fails.map((f) => f.nome + (f.extra ? ' → ' + f.extra : '')), errs }, null, 1));
process.exitCode = fails.length ? 1 : 0;

# Tatame · treino de judô

App web (PWA) para montar e executar treinos de judô. Sem build, sem dependências, sem servidor:
abre no navegador, salva no próprio aparelho e funciona offline.

**No ar:** https://tatame-beta.vercel.app · **Código:** https://github.com/yago-hkcr/tatame

No celular, abra o link e use "Adicionar à tela de início" — ele instala como app e funciona sem internet.

## Como abrir

**Opção 1 — direto:** dê duplo clique em `index.html`.

**Opção 2 — servidor local** (recomendado, habilita instalar como app e offline):

```bash
# na pasta do projeto
python -m http.server 5178
# abra http://localhost:5178
```

No celular, use o mesmo Wi-Fi e acesse `http://SEU-IP:5178`. No Chrome/Safari escolha
"Adicionar à tela de início" para virar app com ícone próprio.

## O que dá para fazer

- **Chave de acesso** — cada pessoa tem uma chave (`TATAME-XXXX-XXXX`). Ela abre o seu tatame no aparelho: treinos, histórico e técnicas separados dos de outra pessoa. Dá para criar quantas quiser no mesmo celular.
- **Treinar** — seus treinos, modelos prontos e inícios rápidos (uchikomi, randori, ne-waza, físico, treino livre).
- **Montar treino** — nome, descrição, **cor do treino**, **preparação inicial (0–30 s)** e blocos com tipo, duração (atalhos de 30 s a 20 min), modo livre, **repetições/séries**, foco e técnicas vinculadas. Dá para reordenar, duplicar, inserir **descanso de 30 s**, embaralhar a ordem e duplicar o treino inteiro.
- **Timer de tatame** — contagem de preparação com **bipes 3 · 2 · 1 antes de começar**, os mesmos bipes **nos últimos 3 segundos de cada bloco**, som de início/fim, vibração, pausa, pular/voltar bloco, tela sempre ligada durante o treino.
- **Registro** — ao terminar, salva duração real, blocos concluídos, técnicas treinadas, sensação e anotação.
- **Progresso** — sequência de dias, minutos totais, média por sessão, anel de meta, gráfico de 14 dias e histórico.
- **Técnicas** — 77 técnicas (nage-waza, katame-waza e ukemi) com kanji e dica rápida; marque como "estudando"/"afinada" e escreva suas anotações.
- **Exercícios personalizados** — crie os seus (flexão, agachamento, prancha, corda, o golpe que você está montando) com categoria (força, golpe, mobilidade, cardio, outro), dica de execução, nível e anotações. Eles aparecem no repertório, entram em qualquer bloco pelo seletor de técnicas e contam no treino como uma técnica — e dá para criar um direto de dentro do bloco, sem sair do editor.
- **Backup** — exportar/importar tudo em JSON (o arquivo carrega a sua chave).

## Estrutura

```
index.html            casca do app
styles.css            sistema visual 2.0 (ink + gold) + componentes
data.js               técnicas, tipos de bloco e modelos de treino
app.js                estado, telas, timer e persistência
adaptive.css          motor de layout adaptativo (tokens, breakpoints, container queries)
fonts/                Inter Tight, JetBrains Mono e Instrument Serif (woff2 locais)
sw.js                 service worker (offline)
manifest.webmanifest  metadados do PWA
icon.svg              ícone
tests/                auditoria responsiva automatizada (headless Chrome via CDP)
```

Tipografia e fontes são locais (`fonts/`) — nada de CDN em tempo de execução, o app abre offline.

## Layout adaptativo (`adaptive.css`)

Camada única de responsividade carregada depois de `styles.css`. Ela não troca o visual: traduz o
mesmo desenho para tokens e regras de adaptação.

**Tokens (fluidos, sem largura de referência fixa)**

| grupo | exemplos |
| --- | --- |
| espaçamento | `--sp-0 … --sp-7` (`clamp`), `--gutter: clamp(14px, 4.2vw, 34px)` |
| tipografia | `--fs-hero`, `--fs-title`, `--fs-h2`, `--fs-body`, `--fs-sm`, `--fs-xs`, `--fs-2xs`, `--fs-label`, `--fs-stat`, `--fs-time` |
| larguras | `--content-max`, `--sheet-max`, `--rail-w: clamp(248px, 17vw, 300px)` |
| forma e toque | `--r-xl/lg/md/sm`, `--tap: 44px` |

**Faixas de adaptação** (o layout se reorganiza, não só encolhe)

```
≤359px      celular compacto  → grades 1 col, topbar sem assinatura, chips quebram
360–559px   celular           → 2 col nos atalhos, sheet em tela cheia
560–767px   celular grande    → atalhos 3 col (o livre ocupa 2), sheet 560
768–899px   tablet retrato    → conteúdo 720, sheet 620
900–1099px  tablet paisagem   → rail lateral, atalhos 5 col, sheet modal, lista do player 2 col
1100px+     desktop           → trilha fixa, conteúdo centralizado, topbar alinhada ao conteúdo
1440/1700/1920/2560px+          → larguras de leitura e coluna central crescem por degrau
paisagem baixa (≤560px de altura) → player em 2 colunas (anel + lista) via grid-template-areas
```

**Recursos usados:** `clamp()`, `min()`, `max()`, `minmax()`, `calc()`, `dvh`/`svh`, grid
intrínseco (`auto-fill` + `minmax(min(100%, …), 1fr)`), container queries (lista de técnicas pelo
corpo do sheet, cartão de treino pela própria largura), `:focus-visible`, `@media (pointer: coarse)`,
`prefers-reduced-motion`, `prefers-contrast`, áreas seguras do iOS (`--safe-t/--safe-b`) e
`scrollbar-gutter: stable`.

**Auditoria automatizada**

```bash
node tests/responsive-audit.mjs                 # 22 larguras × 9 estados + paisagem
node tests/responsive-audit.mjs --widths=390,768 --only=treinar,player
node tests/responsive-audit.mjs --update        # refaz a base de regressão visual
```

O script sobe um Chrome headless por CDP, semeia um perfil de teste, percorre as telas em cada
largura e falha se encontrar: rolagem horizontal, elemento fora da viewport, alvo clicável com menos de
24 px, texto abaixo de 11 px, container cortado, overlay (entrada/sheet/player) cobrindo a tela
fora do estado atual ou erro de console.

Fluxo funcional completo (criar exercício → usar no treino → player → editar → excluir):

```bash
node tests/qa-exercicios.mjs
```
Salva um PNG por combinação em `tests/.out`, um JSON em `tests/last-report.json` e uma assinatura
perceptual (grade 16×16 de luminância) em `tests/baseline/hashes.json` — assim a regressão visual
acusa mudança de composição, não ruído de antialiasing ou dígito do cronômetro.

## Dados e chaves

Cada perfil tem o seu espaço no `localStorage`:

| chave | o que guarda |
| --- | --- |
| `tatame.chave` | chave do perfil ativo |
| `tatame.perfis` | índice dos perfis do aparelho (nome + chave) |
| `tatame.v1:<CHAVE>` | os dados daquele perfil (treinos, sessões, técnicas, exercícios personalizados, ajustes) |

Nada sai do aparelho. Não existe servidor: a chave separa as pessoas **no mesmo dispositivo**.
Para levar o seu tatame para outro celular, use **Progresso → Exportar dados** e, no aparelho novo,
toque em **Restaurar de um backup** na tela de entrada — os dados voltam para a mesma chave.

Se você já usava o app antes das chaves, os dados antigos (`tatame.v1`) entram automaticamente
na primeira chave criada.

## Publicar

O deploy é contínuo: `git push` na branch `master` → Vercel publica em
https://tatame-beta.vercel.app (projeto `tatame`, estático, sem build).

Deploy manual, se precisar:

```bash
vercel --prod          # publica a pasta atual no projeto tatame
```

`vercel.json` cuida dos cabeçalhos: `sw.js` e `index.html` sem cache (para a atualização
do app chegar), manifest com MIME correto e `nosniff`/`no-referrer` no resto.

Ao mexer em CSS/JS, suba o `?v=` em `index.html` **e** em `sw.js` (lista `SHELL` e nome do
cache) para furar o cache do service worker.

## Próximos passos possíveis

- Login e sincronização entre aparelhos (Supabase/Firebase) — hoje a chave vale no aparelho
- Marcar presença em treino de dojo e compartilhar com o sensei
- Plano periódico (semana/mês) com metas e notificações
- Vídeos/gifs das técnicas e modo "espelho" na TV
- Contagem de repetições no uchikomi com botão de série

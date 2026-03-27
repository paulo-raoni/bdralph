# LEARNINGS — bdralph

Lições consolidadas de desenvolvimento. Fonte: agentic-factory-core (M0–M53) + sessões bdralph (M0–M2).
Cada entrada tem: o que aconteceu, o que aprendemos, e quando aplicável — o fix ou padrão adotado.

---

## 1. Ambiente e infraestrutura

### L-ENV-01 — Scripts bash criados no Windows chegam com CRLF

**O que aconteceu:** `llm-delegate.sh` criado no Windows e commitado com `\r\n`. Ao rodar no container Linux, `set -euo pipefail` falhou com "invalid option name" — o `\r` era interpretado como parte do nome da opção.

**O que aprendemos:** Scripts bash criados ou editados no Windows sempre chegam com CRLF. Verificar com `file script.sh` — se mostrar "with CRLF line terminators", corrigir antes de commitar.

**Fix:** `sed -i 's/\r//' script.sh` ou garantir que o editor salve em LF.

---

### L-ENV-02 — `remoteEnv` e `containerEnv` são inconsistentes para env vars de API

**O que aconteceu:** Múltiplas tentativas de injetar chaves de API via `remoteEnv`, `containerEnv`, `runArgs --env-file`, e `.bashrc` — nenhuma confiável dependendo de quando o VS Code abre em relação ao rebuild.

**O que aprendemos:** A única abordagem confiável é `.devcontainer/setup.sh` sourcing o `.env` para `/etc/environment` no início. `containerEnv` e `remoteEnv` são inconsistentes.

**Padrão adotado:** `setup.sh` copia `.env` para `/etc/environment`. `.devcontainer/.env.example` documenta as variáveis necessárias.

---

### L-ENV-03 — `~/.local/bin` não está no PATH automaticamente após install do Claude Code

**O que aconteceu:** `setup.sh` instalou o Claude Code via curl com sucesso, mas `claude --version` retornava `command not found` porque `~/.local/bin` não estava no `PATH` da sessão corrente.

**O que aprendemos:** O installer adiciona ao `~/.bashrc` mas isso não afeta a sessão que está rodando o `postCreateCommand`. Precisar exportar inline também.

**Fix:** No `setup.sh`, adicionar `export PATH="$HOME/.local/bin:$PATH"` tanto no `~/.bashrc` (persistência) quanto executar inline na mesma sessão.

---

### L-ENV-04 — `package.json` ausente aborta o `postCreateCommand` inteiro

**O que aconteceu:** `npm install` no `setup.sh` usa `set -e` — sem `package.json` o comando falha e o setup para completamente, deixando Claude Code, gh CLI e git identity sem configurar.

**O que aprendemos:** O `package.json` precisa existir antes do primeiro rebuild do devcontainer, ou o `npm install` precisa ser protegido.

**Fix:** Criar `package.json` mínimo antes do primeiro rebuild, ou usar `[ -f package.json ] && npm install || true`.

---

### L-ENV-05 — `node` para JSON escape — não `python3`

**O que aconteceu:** Versão original de `llm-delegate.sh` usava `python3` para escapar o prompt antes de passar ao JSON. A imagem `typescript-node:1-22-bookworm` não tem `python3` garantido.

**O que aprendemos:** Usar `node` para escape JSON — sempre disponível nessa imagem por definição.

---

### L-ENV-06 — `curl` sem timeout e com `-f` são armadilhas combinadas

**O que aconteceu:** Dois problemas independentes mas relacionados. (1) `curl` sem `--max-time` pode travar indefinidamente. (2) `-f` faz `curl` falhar silenciosamente em HTTP 4xx/5xx descartando o body — diagnóstico de erro fica impossível.

**O que aprendemos:** Para chamadas a APIs externas, nunca usar `-f`. Capturar body e status code separadamente.

**Padrão adotado:** `curl -s --max-time 30 -o /tmp/response.json -w "%{http_code}"` — body em arquivo separado, status code capturado, timeout explícito.

---

### L-ENV-07 — Arquivo `.md` gerado pelo Claude Code CLI pode vir em UTF-16LE

**O que aconteceu:** O Claude Code CLI criou `README.md` em encoding UTF-16LE. GitHub não renderizou como Markdown. `git diff` tratou como binário.

**O que aprendemos:** Verificar encoding de arquivos `.md` gerados pelo CLI, especialmente em devcontainers com locale não-padrão.

**Fix:** `iconv -f UTF-16LE -t UTF-8 arquivo.md > arquivo.md.tmp && mv arquivo.md.tmp arquivo.md`

---

## 2. Scripts bash — armadilhas e padrões

### L-BASH-01 — `local` é no-op fora de funções bash

**O que aconteceu:** `local l4_single_prompt="..."` usado dentro do main loop (fora de uma função). Em bash, `local` só é válido dentro de funções — fora delas é aceito sem erro mas não tem efeito de escopo.

**O que aprendemos:** `local` em bash é escopo de função, não de bloco. Usar atribuição simples fora de funções.

---

### L-BASH-02 — Variáveis de iteradores de funções colisão com o loop principal

**O que aconteceu:** `get_active_reviewer` usava `i` como iterador interno, colidindo com o iterador `i` do loop principal. O loop nunca avançava — resetava a cada chamada da função.

**O que aprendemos:** Em bash, variáveis dentro de funções não são isoladas por padrão (`local` não declarado = global). Usar nomes específicos para iteradores internos de funções.

**Padrão adotado no bdralph:** `_reviewer_idx` para iteradores internos de funções.

---

### L-BASH-03 — Strings com aspas, barras ou newlines quebram `node -e` via `set -e`

**O que aconteceu:** Feedback do reviewer contendo aspas, barras ou newlines quebrava o `node -e` usado para logging JSON, matando o script via `set -e`.

**O que aprendemos:** Sanitizar strings antes de passar para `node -e`.

**Fix:** `echo "$VAR" | tr -d '\000-\031' | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' '`

---

### L-BASH-04 — Semântica invertida em funções de status bash

**O que aconteceu:** `cost_guard_is_blocked` retorna `0` quando o provider está bloqueado e `1` quando não está — o oposto da convenção bash (0 = sucesso/true). O código usa `if ! cost_guard_is_blocked` para compensar.

**O que aprendemos:** Quando uma função tem semântica invertida por design, documentar isso explicitamente no código. Nunca "corrigir" sem atualizar todos os callers — quebraria silenciosamente.

**Padrão adotado:** Comentário explícito em `cost-guard.sh`. Constraint explícita em prompts de implementação que tocam essa função.

---

### L-BASH-05 — Setar variáveis de resultado antes de funções que as sobrescrevem é dead code

**O que aconteceu:** `PIPELINE_LAYERS="L1+single"` era setado antes de chamar `run_single_review()`, mas essa função sobrescrevia o valor com `"none"` internamente. O assignment era dead code.

**O que aprendemos:** Setar variáveis de resultado **depois** de funções que as sobrescrevem internamente, nunca antes.

---

### L-BASH-06 — `git add .` ou `git add -A` no worker pode commitar arquivos de runtime

**O que aconteceu:** O worker fazia `git add .` para commitar suas mudanças — e incluía acidentalmente os arquivos de runtime do ralph loop (`work-complete.txt`, `review-result.txt`, etc.), mesmo com `.gitignore` correto. `git add` com path explícito ou glob bypassa `.gitignore`.

**O que aprendemos:** Workers que operam em repositórios com arquivos de runtime devem sempre fazer `git add` explícito por path, nunca `git add .` ou `git add -A`. `.gitignore` não protege contra `git add` explícito.

**Padrão adotado no bdralph:** SAFETY CONSTRAINTS do worker no `ralph-loop.sh` proíbem explicitamente `git add .` e `git add -A`.

---

### L-BASH-07 — `.gitignore` não afeta arquivos já rastreados pelo git

**O que aconteceu:** Arquivo de runtime estava no índice git desde antes do `.gitignore` ser configurado. O `.gitignore` não tinha efeito — o arquivo continuava aparecendo como modified a cada execução do loop.

**O que aprendemos:** `.gitignore` só funciona para arquivos *não rastreados*. Para parar de rastrear um arquivo que já está no índice: `git rm --cached <arquivo>` + commit. O arquivo continua existindo localmente mas sai do rastreamento.

---

### L-BASH-08 — `local` dentro de main loop body causa erro de sintaxe em bash

**O que aconteceu:** O addendum do M3 instruía `local _l4s_feedback=...` dentro do
main loop body (fora de qualquer função). Bash retorna erro:
"local: can only be used in a function".

**O que aprendemos:** `local` só é válido dentro de funções bash. No main loop body,
sempre usar atribuição simples. Para evitar colisão de nomes com variáveis de funções
que já usam o mesmo nome, prefixar com underscore (`_l4s_feedback` em vez de
`l4_feedback`).

---

### L-BASH-09 — `ls` com glob sem match retorna exit 2 sob `pipefail`

**O que aconteceu:** `ls "$TRACES_DIR"/l4-iteration-*.json 2>/dev/null` retornava
exit code 2 quando nenhum arquivo existia (glob sem match). Com `set -euo pipefail`,
isso matava o script silenciosamente na iteração 2+ quando não havia L4 traces.
O `2>/dev/null` suprima o stderr mas não o exit code.

**O que aprendemos:** Sob `set -euo pipefail`, `ls` com glob que não encontra arquivos
retorna exit 2, não 0. O fix correto é envolver em `{ ls ... || true; }` para absorver
o exit não-zero antes do pipe. Alternativa: usar `find` ou verificar com
`[ -d "$dir" ] && ls ...` antes.

---

## 3. Testes — padrões e anti-padrões

### L-TEST-01 — Teardown de testes nunca deve usar `rm -rf` em diretórios com arquivos tracked

**O que aconteceu:** `rm -rf artifacts/ralph/` no teardown dos testes deletava o `.gitignore` dentro do diretório, que é tracked pelo git. O `ralph-loop.sh` recriava o diretório com `mkdir -p` mas não restaurava o `.gitignore`.

**O que aprendemos:** Teardown de testes deve remover seletivamente os arquivos runtime conhecidos, preservando arquivos tracked.

**Fix:** Listar explicitamente os arquivos a remover no teardown em vez de usar `rm -rf` no diretório pai.

---

### L-TEST-02 — `__dirname` não existe em módulos ESNext — usar `fileURLToPath`

**O que aconteceu:** Testes usavam `__dirname` diretamente. Com `"module": "ESNext"` no tsconfig, `__dirname` não existe em ESM.

**O que aprendemos:** Em projetos ESM, sempre usar `fileURLToPath(import.meta.url)` + `path.dirname()`.

**Padrão adotado no bdralph:** Todos os arquivos de teste usam `fileURLToPath`. Verificar antes de entregar qualquer prompt de teste.

---

### L-TEST-03 — Enforcement de env vars obrigatórias vai no arquivo de teste, não no config do Vitest

**O que aconteceu:** Prompt inicial colocava o enforcement de `BDRALPH_E2E_MODE` no `vitest.e2e.config.ts`. O Vitest carrega o config antes dos testes — erros no config aparecem como crashes genéricos sem mensagem clara.

**O que aprendemos:** Enforcement de env vars obrigatórias vai no topo do arquivo de teste com `if (!process.env.VAR) throw new Error("...")`. O config deve ser limpo.

---

### L-TEST-04 — node-pty: sempre esperar pelo prompt antes do próximo comando

**O que aconteceu:** Testes enviavam comandos sequencialmente sem esperar pelo prompt do processo. Os inputs chegavam fora de ordem e os testes eram não-determinísticos.

**O que aprendemos:** Com node-pty e readline interativo, sempre esperar pelo prompt do processo antes de enviar o próximo comando. Sem a espera, o readline buffer mistura inputs de comandos diferentes.

**Padrão adotado no bdralph:** `waitFor(terminal, PROMPT)` → `terminal.write(command + '\r')` → `waitFor(terminal, expectedOutput)`.

---

### L-TEST-05 — Flakiness tem causa real — investigar antes de aceitar timeout bumps

**O que aconteceu:** Codex aumentou timeouts em testes sem justificativa. Antes de aceitar, foi questionada a causa.

**O que aprendemos:** `npx tsx` tem custo real de bootstrap (~6–14s por subprocess) — isso justifica alguns ajustes. Mas aumentar para `180s` em testes de `1.4s` é mascaramento. Timeout bumps precisam de diagnóstico explícito antes de serem aceitos.

---

### L-TEST-06 — Verificar `make_zip.py` a cada milestone que adiciona novos diretórios

**O que aconteceu:** M1b criou três novos diretórios (`bin/`, `tests/cli/`, `tests/fixtures/mock-bin/`). O `make_zip.py` os capturou automaticamente — mas isso só foi confirmado verificando o script. Em outros casos, tipos de arquivo novos foram incluídos acidentalmente (zip de referência na raiz).

**O que aprendemos:** A cada milestone que adiciona diretórios ou tipos de arquivo novos, verificar se `make_zip.py` os captura ou exclui intencionalmente. Não assumir — ler o script.

---

### L-TEST-07 — Testes que testam o dispatch isolado não cobrem features do loop principal

**O que aconteceu:** Testes de uma feature do REPL chamavam `session.dispatch()` individualmente. Isso testava que o dispatch funciona — o que já era verdade antes do PR. A feature real (processamento no loop de `start()`) ficou sem cobertura. A extensão rejeitou o PR.

**O que aprendemos:** Sempre perguntar: "este teste falha se eu reverter a mudança?" Features que modificam um loop devem ser testadas exercitando o loop com input real, não as funções internas isoladamente.

---

### L-TEST-08 — Assertions que contradizem decisões de design falham mesmo com implementação correta

**O que aconteceu:** T-ITER-04 originalmente assertava
`toContain("mock strategy from previous iteration")` no stdout do loop. A assertion
estava correta para um sistema que injeta o conteúdo do iteration-log no prompt —
mas M4-05 decide que o loop passa o PATH, não o conteúdo. A assertion teria falhado
sempre, mesmo com implementação perfeita.

**O que aprendemos:** Antes de escrever assertions de teste, verificar as decisions do
milestone para confirmar o comportamento exato. Assertions que testam o que o sistema
DEVERIA fazer segundo o design do implementador — não o que as decisions dizem — são a
fonte mais comum de testes que passam com implementação errada ou falham com
implementação correta.

---

### L-TEST-09 — Teste com workaround documenta o bug mas não o resolve

**O que aconteceu:** T-BLOCKED-01 foi entregue com `--max 1` e um comentário
explicando que `--max 2` causava crash — "a separate bug to investigate". O teste
passou, o bug ficou documentado apenas no comentário, e o fix só veio num PR
separado depois.

**O que aprendemos:** Quando um teste usa um workaround para contornar um bug,
o bug deve ser registrado imediatamente como issue no BACKLOG.md ou como PR de fix
antes de mergear o teste. Um comentário no código não é rastreamento — some no
próximo contexto.

---

## 4. Loop e review pipeline

### L-LOOP-01 — Bloco de ancoragem é crítico para o worker não meta-raciocinar

**O que aconteceu:** O CLI do Claude Code recebeu o prompt completo do loop. Ao ler referências ao próprio loop, o worker foi checar se havia processos `ralph-loop` rodando, concluiu que não havia, e começou a implementar a tarefa diretamente — ignorando completamente o loop.

**O que aprendemos:** O worker precisa de um bloco de ancoragem explícito no início do prompt, antes de qualquer instrução de tarefa. Sem ele, o worker entra em modo de meta-raciocínio.

**Padrão adotado no bdralph:** CLAUDE.md documenta o contrato do executor. Implementado desde M0.

---

### L-LOOP-02 — Governance files no prompt do loop travam o review pipeline

**O que aconteceu:** Um prompt incluía steps para editar sensitive paths (`CLAUDE.md`, `docs/decisions/`, `docs/PROGRESS.md`, `docs/BACKLOG.md`, `.githooks/`, `src/loop/`). O L1 detectou sensitive paths e escalou para L4. O L2 ficou bloqueando por "inconsistência na lista de arquivos" porque o worker não conseguia executar os steps mas o summary afirmava que havia tentado. O loop consumiu todas as iterações sem convergir.

**O que aprendemos:** Nunca incluir edição de sensitive paths dentro do prompt do loop. O review pipeline não sabe distinguir "worker foi impedido por regra válida" de "worker errou" — e bloqueia.

**Fix:** Extrair steps de sensitive paths e executar via Claude Code CLI direto após o loop terminar, em prompt separado.

---

### L-LOOP-03 — L2 não distingue "impedimento por regra válida" de "erro do worker"

**O que aconteceu:** L2 emitiu FAIL repetido porque o worker afirmou no summary que havia "skipped" steps por safety constraints. O L2 interpretou como falha de protocolo.

**O que aprendemos:** L2 é verificador de protocolo — não tem raciocínio sobre *por que* algo foi pulado. Quando o motivo é uma restrição válida documentada, o L2 ainda bloqueia. Limitação arquitetural documentada, a resolver em M5 (contextual L2).

---

### L-LOOP-04 — SHIP-on-failure guard com grep simples dispara falso positivo em negações

**O que aconteceu:** O worker escrevia "no permission issues were encountered" no summary. O guard detectou "permission issues" e forçou REVISE — travando o loop.

**O que aprendemos:** Guards de detecção de falha baseados em grep simples são frágeis. Precisam de context-aware matching com detecção de negação.

**Fix:** Verificar se a frase de falha é precedida por palavras de negação (no, not, never, without, fixed, resolved) dentro de um raio de caracteres. Implementar via `grep -ivE "negation_pattern"`. Relevante para M5.

---

### L-LOOP-05 — L2 dispara falso positivo quando summary contém output de CI

**O que aconteceu:** Quando o worker incluía output de CI, nomes de arquivos de log ou template literals no summary, o L2 interpretava como claims de modificação de arquivos — e falhava porque esses nomes não estavam na lista verificada do L1.

**O que aprendemos:** Prompts de review que verificam "consistência de claims" são frágeis quando o summary contém texto livre. O critério correto é verificar escopo de arquivos (os arquivos modificados fazem sentido para a tarefa?), não consistência textual entre summary e lista de arquivos. Relevante para M5.

---

### L-LOOP-06 — Reviewer único sem contexto de governance é insuficiente

**O que aconteceu:** Um reviewer barato aprovou em uma única revisão três falhas graves: governance violation, guardrail fake, e operator confirmation ausente. O problema não era o modelo ser barato — era não ter contexto arquitetural para distinguir implementação real de implementação que compila mas não faz nada.

**O que aprendemos:** O reviewer L4 precisa receber documentos de governance injetados no prompt (CLAUDE.md, PROGRESS.md) para julgar compliance arquitetural, não só qualidade de código.

**Padrão adotado no bdralph:** Pipeline L1–L4 com L4 recebendo `_build_governance_context()` injetado. Implementado desde M1a.

---

### L-LOOP-07 — Ralph Loop não é para velocidade — threshold mínimo de uso

**O que aconteceu:** Primeiros testes com tarefas triviais (escrever um comentário de uma linha). Loop demorou 3+ minutos para algo que levaria 10 segundos no Claude Code direto.

**O que aprendemos:** Ralph Loop não é para velocidade — é para autonomia em tarefas longas com iteração e revisão. Threshold correto: tarefas estimadas em mais de 5 minutos de implementação direta.

---

### L-LOOP-08 — Campo interno do L2 vazando para o worker via feedback

**O que aconteceu:** O mock delegate (e potencialmente LLMs reais) retorna uma linha
`CLASSIFICATION: <value>` após o resultado do review. Essa linha não era filtrada antes
de ser escrita em `review-feedback.txt`. Na iteração 2+, o worker lia o feedback
com `CLASSIFICATION: failure` embutido, causando falha silenciosa no `node -e` que
constrói o work prompt (exit code 2).

**O que aprendemos:** Campos de metadados internos de layers (como `CLASSIFICATION:`)
devem ser extraídos e descartados do feedback antes de qualquer escrita em estado
compartilhado. O worker nunca deve ver metadados do reviewer — apenas feedback
acionável. Fix: `sed '/^CLASSIFICATION:/d'` no pipeline de construção do
`FEEDBACK_TEXT`, antes da sanitização de caracteres de controle.

---

## 5. Prompts e execução do executor

### L-PROMPT-01 — Flags sempre após as aspas do prompt, nunca antes

**O que aconteceu:** Prompts gerados com `bash ralph-loop.sh --worker sonnet "..."` — flags antes das aspas — causam parsing incorreto no script.

**O que aprendemos:** Flags devem vir sempre APÓS as aspas de fechamento do prompt.

**Correto:** `bash src/loop/ralph-loop.sh "..." --worker sonnet --max 10`

---

### L-PROMPT-02 — Backticks aninhados corrompem prompts — usar delimitadores alternativos

**O que aconteceu:** Prompts com blocos de código dentro de blocos de código chegavam corrompidos ao executor. Partes do conteúdo escapavam das caixas de formatação.

**O que aprendemos:** Para prompts com conteúdo de arquivo a ser inserido, usar delimitadores nomeados em vez de backticks aninhados.

**Padrão adotado:** `=== CONTENT START ===` / `=== CONTENT END ===`. Prompts longos ou com code blocks internos são salvos como `.md` e passados com `< prompt.md`.

---

### L-PROMPT-03 — Diagramas ASCII em prompts chegam quebrados — usar Mermaid

**O que aconteceu:** Diagramas ASCII incluídos em prompts para o executor não sobreviveram à transmissão — alinhamento quebrado, colunas deslocadas.

**O que aprendemos:** Nunca incluir diagramas ASCII em prompts. Descrever o fluxo em prosa e pedir Mermaid quando necessário. O GitHub renderiza Mermaid nativamente em `.md`.

---

### L-PROMPT-04 — Prompts entregues em partes para o operador montar causam retrabalho

**O que aconteceu:** Prompt entregue em partes separadas esperando que o operador montasse. O resultado ficou incompleto e o operador teve dificuldade na montagem.

**O que aprendemos:** Prompts para o executor devem ser entregues completos e prontos para colar — nunca em partes. Especialmente para executor com contexto zerado, onde todo o contexto precisa estar inline.

---

### L-PROMPT-05 — Contexto preservado no executor elimina project context do prompt

**O que aconteceu:** Fix enviado ao executor com contexto preservado da sessão anterior. O prompt ficou curto e direto, sem repetir project context ou lista de arquivos para ler.

**O que aprendemos:** Prompts para executor com contexto preservado não precisam do bloco de project context nem da lista "leia primeiro". Contexto zerado exige tudo; contexto preservado exige apenas a instrução.

---

### L-PROMPT-06 — Prompt de fix deve incluir commit e push explícitos

**O que aconteceu:** Primeiro prompt de fix não incluía commit e push. O operador teve que pedir explicitamente. Ciclo perdido.

**O que aprendemos:** Todo prompt de fix em branch aberta deve incluir explicitamente: gates CI + `git add` (por arquivo) + `git commit -m "..."` + `git push origin <branch>`.

---

### L-PROMPT-07 — Verificação de gates já executados não precisa ser repetida no PR

**O que aconteceu:** Após o loop completar com gates passando, o executor perguntou se devia rodar todos os gates novamente antes de criar a branch e abrir o PR.

**O que aprendemos:** Se os gates já foram verificados e documentados no output do loop, não repetir. O prompt para o executor deve ser explícito: "CI gates já foram verificados — não rodar novamente".

---

### L-PROMPT-08 — Prompts com code blocks aninhados construídos iterativamente ficam inconsistentes

**O que aconteceu:** Prompts construídos com sed/append acumularam instruções redundantes e estrutura inconsistente.

**O que aprendemos:** Quando a estrutura do prompt ficar complexa, reescrever o arquivo limpo com Python em vez de continuar appendando. Uma única edição consolidada é sempre melhor que edições incrementais com sed.

---

### L-PROMPT-09 — Sensitive paths precisam estar explícitos no prompt, não só no CLAUDE.md

**O que aconteceu:** Executor modificou `docs/PROGRESS.md` como parte natural da entrega porque o prompt não proibia explicitamente — apenas o CLAUDE.md proibia.

**O que aprendemos:** O executor não lê o CLAUDE.md com a mesma atenção quando está em modo de execução. Sensitive paths precisam ser listados explicitamente no prompt de implementação com "do not touch".

---

### L-PROMPT-10 — Antes de gerar prompt de fix, ler código + testes + tipos que o código usa

**O que aconteceu:** Primeiro draft de um prompt de fix não mencionava testes existentes que verificavam contratos de interface. Após o fix, esses testes quebrariam porque o contrato mudou. O prompt precisou ser reescrito após ler os testes.

**O que aprendemos:** Antes de gerar qualquer prompt de fix: (1) ler o código a mudar, (2) ler os testes existentes que tocam esse código, (3) ler os tipos que o código usa. Testes que verificam contratos de interface são os que mais quebram em refactors.

---

### L-PROMPT-11 — Verificação completa antes de declarar prompt pronto

**O que aconteceu:** O prompt do M3 foi declarado pronto duas vezes antes de
estar realmente completo. Cada rodada de verificação encontrou um problema real:
(1) addendum fora do lugar com `local` fora de função, (2) sequências de mock com
número errado de chamadas para pipeline mode, (3) bloco de comentário de rascunho
poluindo o teste T-TRACE-07.

**O que aprendemos:** Antes de declarar um prompt pronto, fazer leitura completa do
arquivo e verificar: estrutura linear coerente, sem appends fora de ordem, variáveis
com escopo correto (`local` dentro de funções, plain assignment no main loop),
sequências de mock matematicamente corretas para o número de layers × iterações.

---

## 6. Fluxo de PR e governança

### L-PR-01 — Branch sempre antes de commitar — nunca assumir que o executor vai criar

**O que aconteceu:** Após aprovar o plano, o executor commitou diretamente na main sem criar branch. Detectado antes do push, revertido com `git branch` + `git reset`.

**O que aprendemos:** O executor pode commitar na main local se não for explicitamente instruído a criar branch primeiro. A instrução deve ser o primeiro passo do prompt: "Create branch X from main".

---

### L-PR-02 — `pre-push hook` bloqueia push direto na main — é real e funciona

**O que aconteceu:** Claude Code CLI commitou na main local e tentou `git push origin main`. O pre-push hook bloqueou. O CLI se recuperou criando branch e abrindo PR — mas esse comportamento não é garantido.

**O que aprendemos:** Nunca incluir `git checkout main` seguido de operações de escrita em prompts. O hook bloqueia o push mas o estado local fica inconsistente (commits órfãos na main local). Recovery via cherry-pick.

---

### L-PR-03 — Prompt de revisão da extensão é uma entrega explícita, não passo implícito

**O que aconteceu:** O operador esperava o prompt de revisão pronto. Sem ele, a extensão não tem contexto suficiente para saber o que checar.

**O que aprendemos:** O prompt de revisão é uma entrega. Deve ser gerado explicitamente com foco nos pontos de risco da implementação — nunca um genérico "revise tudo".

---

### L-PR-04 — Revisão deve ser das changes locais na branch, não do PR no GitHub

**O que aconteceu:** Primeiro prompt de revisão pedia para a extensão revisar o PR no GitHub. Operador corrigiu.

**O que aprendemos:** A extensão opera no devcontainer onde o código está. Revisar `git diff main` ou arquivos diretamente é mais preciso e não depende do GitHub.

---

### L-PR-05 — Sensitive path decisions sempre em prompt separado pós-merge

**O que aconteceu:** As decisions de M1b (`docs/decisions/M1b.md`, `docs/DECISIONS.md`) são sensitive paths. O prompt de implementação não pode incluí-las. Precisou de segundo prompt e segundo PR após o merge do PR de implementação.

**O que aprendemos:** Este é design intencional. Fluxo correto: implementação → merge → prompt de decisions → merge. Nunca colapsar os dois em um PR.

---

### L-PR-06 — "Não-bloqueantes cosméticos" também bloqueiam neste projeto

**O que aconteceu:** A extensão apontou dois issues cosméticos como "não-bloqueantes". O operador exigiu correção antes do merge.

**O que aprendemos:** Não existe "não-bloqueante cosmético" neste projeto. Qualquer issue identificado em review deve ser corrigido antes do merge, independente da severidade. Débito zero é a política.

---

### L-PR-07 — Milestones não fecham sem critérios manuais executados

**O que aconteceu:** Dois milestones tinham testes manuais explícitos nos critérios de aceite. Foram marcados como complete sem execução desses testes. Problemas só apareceram durante o primeiro teste real.

**O que aprendemos:** Critério de aceite com teste manual precisa ser executado antes do milestone fechar, não depois. "Milestone completado" significa todos os gate criteria passando — incluindo manuais.

---

### L-PR-08 — PR number deve ser confirmado, nunca inferido

**O que aconteceu:** PR registrado no PROGRESS com número inferido sequencialmente a partir do anterior. O número estava errado.

**O que aprendemos:** Nunca inferir número de PR. Sempre confirmar via output do `gh pr create` ou URL do GitHub antes de registrar. Alternativa: commitar com `"pr": 0` e corrigir após abertura do PR.

---

### L-PR-09 — Handoff deve ser auditado ativamente, não declarado completo por memória

**O que aconteceu:** Handoff declarado completo duas vezes antes de estar realmente completo. Cada rodada de auditoria encontrou problemas: status desatualizado, bloco de markdown não fechado, estrutura errada, sensitive paths ausentes, contagem de testes incorreta.

**O que aprendemos:** O handoff só está completo após leitura linha a linha comparando com o estado real da sessão. "Está completo?" dispara uma leitura ativa — não uma confirmação de memória.

---

### L-PR-10 — Interromper geração de arquivo deixa arquivo parcial corrompido

**O que aconteceu:** Operador enviou mensagem enquanto o arquivo estava sendo gerado. O arquivo foi criado com conteúdo parcial. Na próxima tentativa, `create_file` falhou com "file already exists".

**O que aprendemos:** Se a geração for interrompida, verificar o conteúdo do arquivo antes de tentar novamente. Nunca usar `str_replace` em arquivo parcialmente gerado sem antes confirmar o conteúdo. Pode ser necessário deletar e recriar.

---

### L-PR-11 — README como spec antes de implementar evita retrabalho

**O que aconteceu:** O README foi escrito primeiro descrevendo o estado alvo, revisado pela extensão que identificou inconsistências com o código atual, e só então a implementação começou. Isso evitou que o executor implementasse uma arquitetura diferente da desejada.

**O que aprendemos:** Para mudanças arquiteturais complexas: escrever o README do estado alvo → revisar com extensão → implementar. O README serve como spec que todos (humano, extensão, CLI) podem referenciar.

---

### L-PR-12 — Fix descoberto na branch vai na mesma PR, não em PR separado

**O que aconteceu:** O executor reportou flakiness de testes ao entregar M4. A primeira
resposta foi gerar um prompt de fix separado (novo PR). O operador questionou e a
solução correta (adicionar o fix na branch ativa antes do merge) foi imediatamente
óbvia.

**O que aprendemos:** Quando um issue é descoberto antes do merge de uma branch, o fix
vai na mesma branch/PR. Um PR separado só faz sentido se o issue for encontrado depois
do merge.

---

## 7. Painel Ink e UI

### L-INK-01 — ESM e `yoga-layout`: `src/loop/ink/package.json` com `"type": "module"`

**O que aconteceu:** `yoga-layout` (dependência do Ink) é ESM puro com top-level await — incompatível com CJS. `tsx` determina o formato de output pelo `package.json` mais próximo na hierarquia.

**O que aprendemos:** O fix correto é criar `src/loop/ink/package.json` com `"type": "module"` para que `tsx` encontre esse arquivo antes do raiz e compile como ESM. NÃO adicionar `"type": "module"` ao `package.json` raiz — o bash loop usa `node -e "require(...)"` extensivamente.

---

### L-INK-02 — `setsid` + `kill -- -$PID` para matar o process group inteiro do Ink

**O que aconteceu:** `kill "$PID"` matava apenas o processo pai do tsx — worker threads filhos ficavam vivos.

**O que aprendemos:** Spawnar com `setsid` para criar novo process group, matar com `kill -- -"$PID"`. `setsid` disponível em Ubuntu/Debian por default.

---

### L-INK-03 — `/dev/tty` explícito para o render do Ink funcionar corretamente

**O que aconteceu:** Quando spawned com `>/dev/tty`, `process.stdout` não é o mesmo fd que `/dev/tty`. Resultado: frames se acumulavam em vez de substituir (layout duplicado).

**O que aprendemos:** Passar `openSync("/dev/tty", "w")` explicitamente para `render()` do Ink. Sem isso, Ink usa `process.stdout` que pode não corresponder ao tty fd correto.

---

### L-INK-04 — Layout do painel: ordem das prioridades visuais é imutável

**O que aconteceu:** Primeira versão do layout colocava loop no topo por ser "o processo principal". Operador corrigiu: chats (alertas + Second Mind) ficam no topo porque é onde o operador presta atenção e toma decisões.

**O que aprendemos:** Prioridade visual no terminal segue onde o operador olha para decidir, não onde o processo mais importante roda.

**Ordem imutável:** Alertas → Second Mind → Loop.

---

### L-INK-05 — Painel tem dois eixos de responsividade independentes: largura e altura

**O que aconteceu:** Planejamento inicial do painel considerava só largura. Cenário real no VSCode: terminal tem ~20 linhas de altura e ~80 colunas — altura é tão crítica quanto largura.

**O que aprendemos:** Layout precisa de dois eixos de adaptação independentes. Abaixo de determinada altura, colapsar para modo minimalista independente da largura. O loop sempre tem prioridade de espaço — o resto colapsa para dar espaço a ele.

---

### L-INK-06 — node-pty no devcontainer headless: compilação nativa, verificar disponibilidade

**O que aconteceu:** Devcontainer headless não tem `/dev/tty` — smokes manuais de painel Ink não funcionam. `node-pty` cria pty virtual e resolve o problema. Mas é compilação nativa — pode não compilar em todos os ambientes.

**O que aprendemos:** Verificar se `node-pty` compila no ambiente antes de assumir disponibilidade. Alternativa se falhar: `@replit/node-pty` (binários pré-compilados).

---

## 8. Design do sistema — decisões descartadas

### L-DESIGN-01 — Modo agnóstico: executor agnóstico, não provider agnóstico

**O que aconteceu:** Proposta de modo onde worker e Second Mind rodariam via API de LLM diretamente, sem Claude Code CLI.

**O que aprendemos:** LLM via API não tem agência real no sistema de arquivos — não consegue ler arquivos, escrever, rodar comandos, fazer commit. Um worker via API só devolve texto. O modo agnóstico correto é "executor agnóstico" (múltiplos CLIs de agente: Claude Code, Codex, Aider), não "provider agnóstico" (múltiplos LLMs via API).

**Codex como candidato:** Codex da OpenAI tem agência real no sistema de arquivos. Aider é opção open source madura. Ambos são candidatos viáveis para milestone experimental.

---

### L-DESIGN-02 — Continuous Awareness Mode: descartado

**O que aconteceu:** Planejamento anterior propôs Second Mind rodando continuamente mesmo quando o loop está idle — "permanent architectural awareness layer".

**O que aprendemos:** Second Mind ativo permanente consome tokens constantemente sem benefício proporcional. O padrão correto é sob demanda — ativado por trigger explícito (operador, threshold de iterações, sinal do L4). Custo controlado, resultado equivalente.

---

### L-DESIGN-03 — Gas Town: worker isolado, watchdog externo determinístico

**O que aconteceu:** Surgiu a ideia de injetar snapshot do estado dos outros loops no contexto do worker para evitar trabalho duplicado.

**O que aprendemos:** Isso cria bias de raciocínio — worker pode evitar abordagens válidas por ter visto falha de outro loop. A independência dos worktrees vira ilusão. A solução correta é watchdog determinístico (bash puro, custo zero) que monitora externamente e acorda o Second Mind apenas quando detecta conflito real. Worker permanece sempre isolado.

---

### L-DESIGN-04 — Playground estável, fixtures E2E programáticas e descartáveis

**O que aconteceu:** Primeira ideia foi criar um playground com gaps e bugs intencionais para o loop consertar. Problema: depois de consertado, precisaria re-introduzir gaps manualmente — overhead constante, não escala.

**O que aprendemos:** Playground deve ser correto e estável (para testes manuais do operador e referência). Fixtures E2E são snapshots degradados criados e destruídos programaticamente por cada roteiro. O loop trabalha sobre a fixture, nunca sobre o playground original. Dois propósitos, dois artefatos distintos.

---

### L-DESIGN-05 — Indexação RAG para decisões: DECISIONS.md como índice leve

**O que aconteceu:** Proposta de um único `DECISIONS.md` para todas as decisões. Risco: arquivo cresce sem limite, executor paga tokens para carregar decisões irrelevantes de milestones anteriores.

**O que aprendemos:** `DECISIONS.md` como índice leve (uma linha por decisão + link), `docs/decisions/MN.md` como detalhe por milestone. Executor lê o índice sempre, lê o detalhe só quando relevante. Mesmo princípio de um RAG — não joga o corpus inteiro no contexto.

**Padrão adotado no bdralph:** Implementado desde M0.

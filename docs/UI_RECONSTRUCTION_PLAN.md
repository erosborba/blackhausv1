# Plano de Reconstrução de UI/UX — Lumihaus

Autor: design+eng handoff
Data: 2026-04-20
Status: **rascunho para aprovação** — nenhuma linha de código nova antes do OK.

Referência visual: `C:\projetos\exemplos\blackhausv1-handoff\blackhausv1\project\hifi-dark\`
(tokens.css 207 linhas, components.css 788 linhas, index.html 1396 linhas cobrindo 6 telas).

---

## 0. Filosofia e escopo

Isto **não é retoque estético**. É uma troca de espinha dorsal de UI:

- Hoje: 8 rotas admin (`/admin/*`) em inline styles, cada uma auto-contida,
  sem componentização, sem sistema de tokens, sem noção de perfil.
- Alvo: produto real, com **shell unificado** (sidebar + topbar + áreas),
  **biblioteca de primitivos** (Button, Chip, Card, Avatar, Orb, Kbd, Dot,
  Placeholder, Score, Bubble, SourceChip, TimelineMarker), **2 perfis** (admin
  vs corretor) com route gating e feature flags, **navegação pensada como IA**
  (prioridade → contexto → decisão → feedback loop).

O mockup cobre 6 telas. As 8 rotas atuais viram **11 rotas** reorganizadas
com 2 shells (admin full + corretor lite) e 1 shell mobile (PWA).

---

## 1. Inventário das telas-mockup e intenção de cada

| # | Tela            | Intenção                                                                                                   | Quem usa |
|---|-----------------|-----------------------------------------------------------------------------------------------------------|----------|
| S1 | Inbox Cockpit  | Cockpit de atendimento: priority rail + conversa + contexto lateral. Onde se passa 80% do tempo.         | admin, corretor |
| S2 | Gestor KPIs    | Saúde operacional: tempo 1ª resposta, % atendido por IA, conversão por corretor, alertas.                | admin only |
| S3 | Empreendimentos| Biblioteca editorial de empreendimentos: tipologias, unit-matrix por andar, FAQ IA, docs processados.   | admin, corretor (read-only) |
| S4 | HITL Daily Brief | Resumo narrativo da manhã com decisões pendentes. "Bom dia, Ana. Sua noite rendeu 3 visitas..."        | admin, corretor |
| S5 | Mobile PWA     | Versão phone do brief + swipe-stack de decisões + agenda + conversas.                                    | admin, corretor |
| S6 | Handoff Review | Tela dedicada de takeover: orb quente + diff do rascunho IA + decision radio + commit bar (add FAQ).    | admin, corretor |

### 1.1 Mapeamento mockup → funções reais existentes

| Tela     | Função real hoje                                      | Gap a fechar |
|----------|-------------------------------------------------------|--------------|
| S1 Inbox | `/admin/leads` (inbox-client.tsx): lista + thread    | Priority rail (ordenação por score × urgência), "Jornada do lead" tab, HUD de 3 ações sugeridas, source-bar por bubble, composer "devolver pra IA", ⌘K command palette. |
| S2 Gestor| `/admin/funnel` (agregação in-memory, cap 2k leads) | Sparklines por KPI, alertas operacionais (9 sem retorno / 4 visitas sem confirmação), detecção de gargalo textual, conversão por corretor (requer `agent_id` em leads). |
| S3 Empre | `/admin/empreendimentos` + `[id]/detail-client.tsx`  | Tipologias visuais (cards com m² + avail), unit-matrix por andar (requer tabela `unidades`), FAQ IA (`empreendimentos_faqs` existe, expor), docs processados timeline, "Enviar para lead" handoff. |
| S4 Brief | `src/lib/brief.ts` (existe! gera narrativa)          | Rota dedicada `/brief`, TTS opcional (ouvir resumo), decision-cards conectados a ações reais, agenda hoje (requer `visits`). |
| S5 Mobile| não existe                                             | PWA manifest, shell phone separado, swipe-stack gesture lib (framer-motion já presente), service worker. |
| S6 Handoff | `/admin/leads/[id]` sidebar tem handoff-card, mas no flux normal | Rota `/handoff/[leadId]` com diff IA-suggested vs user-edited, confidence meter (requer `handoff_confidence` em state), "add ao FAQ" (precisa route que persiste em `empreendimentos_faqs`). |

### 1.2 Rotas atuais → rotas alvo

| Rota atual              | Rota alvo                  | Perfil    | Nota |
|-------------------------|----------------------------|-----------|------|
| `/admin/leads`          | `/inbox`                   | admin+corretor | Shell unificado, mas filtro "meus leads" default pra corretor. |
| `/admin/leads/[id]`     | `/inbox/[id]`              | admin+corretor | — |
| `/admin/funnel`         | `/gestor`                  | admin only | Renomeia pra refletir persona (Gestor da operação). Funnel vira aba interna. |
| `/admin/empreendimentos`| `/empreendimentos`         | admin+corretor | Corretor: read-only (sem edit, sem novo, sem import PDF). |
| `/admin/empreendimentos/[id]` | `/empreendimentos/[id]` | ambos | Aba "Editar" gated por role. |
| `/admin/empreendimentos/new`  | `/empreendimentos/new`  | admin only | — |
| `/admin/configuracoes`  | `/ajustes`                 | admin only | Inclui settings de IA, custos, thresholds. |
| `/admin/drafts`         | `/revisao`                 | admin only | Bia rascunhos + draft learnings. |
| `/admin/usage`          | `/ajustes/usage` (sub-aba) | admin only | Não merece rota top-level — sub-aba de Ajustes. |
| `/admin/cleanup`        | `/ajustes/manutencao`      | admin only | Mesmo critério. |
| `/admin/follow-ups`     | `/agenda` (aba "Follow-ups") | ambos | Novo `/agenda` com tabs [Hoje, Follow-ups, Visitas]. |
| (novo)                  | `/brief`                   | admin+corretor | HITL Daily Brief — landing page matinal. |
| (novo)                  | `/handoff/[leadId]`        | admin+corretor | Review dedicada de takeover. |
| (novo)                  | `/pipeline`                | admin+corretor | Vista kanban do funil (S2 mostra só gestão; `/pipeline` é operacional). |

**Total**: 8 rotas admin existentes → 11 rotas alvo. `/usage` e `/cleanup`
descem a sub-rotas. `/leads` vira `/inbox`. 3 rotas novas: `/brief`,
`/handoff/[id]`, `/pipeline`.

---

## 2. Fundação (Phase 0) — tokens, role system, shell

### 2.1 Design tokens (`src/design/tokens.ts` + `src/design/tokens.css`)

Exporta de ambos os lados (CSS custom properties pra estilos, TS constants
pra logic/inline quando necessário). Tokens copiados 1:1 de
`hifi-dark/tokens.css`:

```ts
// src/design/tokens.ts
export const color = {
  bg: "#0e1624",
  surface: "#152136",
  surfaceHi: "#1b2a44",
  ink: "#eaf1ff",
  ink2: "#c7d2e6",
  ink3: "#8ea0bf",
  blue: "#4aa3ff",
  hot: "#ff7a59",
  warm: "#ffc861",
  ok: "#34d399",
  // ...
};
export const radius = { sm: 8, md: 14, lg: 20, xl: 28 };
export const shadow = {
  neu: "...",
  neuSm: "...",
  in: "...",
  glow: "...",
};
```

O `tokens.css` vira `@import` em `app/globals.css`. Todo componente passa a
usar `var(--bg)`, `var(--sh-neu)`, etc. Zero inline style com hex fixo.

### 2.2 Sistema de perfis (`src/lib/auth/role.ts`)

```ts
export type Role = "admin" | "corretor";

export type Permission =
  | "inbox.view_all"        // admin vê todos; corretor só os dele
  | "inbox.reassign"
  | "empreendimentos.edit"
  | "empreendimentos.import"
  | "gestor.view"
  | "ajustes.view"
  | "ajustes.costs"          // vê ai_usage_log, preços
  | "ajustes.ia_config"      // edita thresholds, prompts
  | "revisao.view"           // drafts + draft_learnings
  | "handoff.add_to_faq"
  | "pipeline.move_stage";

const PERMS: Record<Role, Set<Permission>> = {
  admin: new Set<Permission>([/* todas */]),
  corretor: new Set<Permission>([
    "inbox.reassign", "handoff.add_to_faq",
    // NÃO inclui: ajustes.*, revisao.*, empreendimentos.edit|import, gestor.view
  ]),
};

export function can(role: Role, p: Permission): boolean { ... }
```

Context provider `<RoleProvider value={role}>` no root do app shell. Hook
`useCan(permission)` pra gate condicional de UI. Middleware (`middleware.ts`)
checa role via cookie/Supabase Auth antes de resolver rotas — mesmo quem
souber a URL `/gestor` sendo corretor toma 403.

> Hoje não há auth (TECH_DEBT 🔴 item 1). Esta reconstrução **pressupõe** que
> auth seja resolvida em paralelo (magic link Supabase). Sem auth, role fica
> stub lido de `system_settings.current_role` pra dev.

### 2.3 Feature flags (`src/lib/flags.ts`)

Simples no início — `system_settings.feature_flags JSONB` → hook
`useFlag("mobile_pwa")`. Permite lançar S5 mobile gradualmente, esconder
`/brief` durante beta, etc. Sem SaaS externo.

### 2.4 Shell (`src/components/shell/`)

```
shell/
  AppShell.tsx         # CSS grid 84px | 1fr | (sidebar | main)
  Sidebar.tsx          # 48×48 items neumórficos, badge, glow no ativo
  Topbar.tsx           # crumbs + search ⌘K + IA-chip + Novo
  CommandPalette.tsx   # ⌘K overlay
  MobileShell.tsx      # phone-frame + tabbar (4 abas: Inbox/Leads/Agenda/Gestor)
```

`AppShell` recebe `nav={[...items]}` filtrado por `can(role, perm)`. Item
escondido = rota não renderizada no sidebar; `middleware.ts` ainda bloqueia
acesso direto.

### 2.5 Biblioteca de primitivos (`src/components/ui/`)

Extraídos dos mockups, tipados, com variantes documentadas:

- `Button` — variants: `default | primary | ghost | icon`, sizes `sm | md | lg`
- `Chip` — variants: `default | ghost | solid | hot | warm | cool | ok | blue-soft`
- `Dot` — status indicators com glow opcional
- `Avatar` — size `sm | md | lg`, variant `default | blue`, fallback iniciais
- `Card` — variants: `default | neu | inset`
- `Kbd` — keyboard shortcut rendering
- `Placeholder` — skeleton hachurado neumórfico
- `Orb` — animated AI presence (breath/think/asking/idle); já vem pronto em components.css
- `ScoreRing` — conic-gradient ring 0–100
- `SourceChip` — chip clicável com gap visual (source-bar)
- `Bubble` — variants: `them | me | ai | ai-stuck` + `SourceBar` inline
- `TimelineMarker` — variants: `ia | human | lead | system`
- `Sparkline` — mini line chart SVG
- `Meter` — barra horizontal com cor condicional

Todos passam por Storybook simples (`pages/_design/*.tsx` ou MDX) — **não
obrigatório no Phase 0**, mas recomendado antes de Phase 2.

---

## 3. Arquitetura de rotas e layouts

```
src/app/
  (shell)/                     # group com AppShell layout
    layout.tsx                 # <AppShell nav={navForRole(role)}>
    inbox/
      layout.tsx               # 3-col shell (list | thread | context)
      page.tsx                 # conv-list + empty state
      [id]/
        page.tsx               # thread + context pane
    brief/
      page.tsx                 # HITL landing (admin+corretor)
    gestor/
      page.tsx                 # KPIs + alertas                    [admin only]
    pipeline/
      page.tsx                 # kanban
    empreendimentos/
      page.tsx                 # lista + preview split
      [id]/
        page.tsx               # detalhe (edit gated por role)
      new/
        page.tsx               # [admin only]
    agenda/
      page.tsx                 # tabs [Hoje, Follow-ups, Visitas]
    handoff/
      [leadId]/
        page.tsx               # review dedicada
    revisao/
      page.tsx                 # drafts + learnings               [admin only]
    ajustes/
      layout.tsx               # tabs [IA, Custos, Manutenção, Perfis]
      page.tsx                 # IA config                         [admin only]
      usage/page.tsx           # custos                            [admin only]
      manutencao/page.tsx      # cleanup                           [admin only]

  (mobile)/                    # group com MobileShell
    layout.tsx
    m/
      brief/page.tsx
      decisions/page.tsx       # swipe-stack
      inbox/page.tsx
      agenda/page.tsx

  api/...                      # inalterado
  globals.css                  # @import tokens.css
```

`middleware.ts`: detecta `/ajustes`, `/gestor`, `/revisao`,
`/empreendimentos/new` → exige `role === "admin"`. Detecta user-agent mobile
em `/brief` → redirect 307 pra `/m/brief` (flag-gated).

---

## 4. Dados e APIs — gaps a fechar

Pra o mockup **funcionar de verdade** (não só bonito), precisamos:

| Feature visual                         | Dado/API faltando                                                              | Solução |
|----------------------------------------|--------------------------------------------------------------------------------|---------|
| ScoreRing do lead (72)                 | `leads.score` (0–100)                                                          | Migration + cálculo no `router` node (heurística: stage + mensagens + objeções). |
| Priority rail "hot/warm/cool"          | mesmo `score` + `urgency` (já existe em handoff)                              | View SQL `v_priority_rail`. |
| Source-bar por bubble                  | `messages.sources JSONB` — quais chunks RAG geraram a resposta                 | Migration + `answer` node salva `retrieval_trace`. |
| HUD de 3 ações sugeridas               | endpoint `/api/leads/[id]/suggested-actions` que consulta copilot              | `src/lib/copilot.ts` já existe, falta expor como route. |
| "Jornada do lead" tab                  | `lead_events` timeline                                                          | Migration `lead_events (lead_id, kind, payload, at)` + INSERT em cada transição. |
| Conversão por corretor                 | `leads.agent_id` FK + `agents` table                                           | Migration + backfill single-agent. |
| Alertas operacionais (sem retorno, visitas sem confirmação) | views SQL agregadas                           | `v_ops_alerts` — refresh via cron curto. |
| Unit-matrix por andar                  | `unidades (empreendimento_id, andar, numero, tipologia_id, status, preco)`    | Migration. Status enum: `avail | reserved | sold`. |
| Tipologias visuais                     | extrair de `empreendimentos.tipologias JSONB` (já existe)                     | ok, só faltam componentes. |
| Agenda hoje                            | `visits (lead_id, agent_id, scheduled_at, status, empreendimento_id)`         | Migration. |
| Decisions queue (brief + swipe-stack)  | endpoint `/api/brief/decisions` agregando: `handoffQueue` + follow-ups urgentes + novos FAQs sugeridos + visitas sem confirmação | Novo route. |
| Handoff confidence (41%/70%)           | `langgraph state.handoff_confidence` (router calcula quando decide escalar)   | Já existe parcial em `handoff.ts`; expor no state. |
| "Add ao FAQ" no commit-bar             | endpoint POST `/api/empreendimentos/[id]/faqs`                                | `empreendimentos_faqs` table existe, falta route. |
| Feedback do corretor (TECH_DEBT Tier 3 #1) | `handoff_feedback` table                                                  | Migration + UI no thread-client. |

**Prioridade migrations** (por fase):
- Phase 1: `leads.score`, `lead_events`, `messages.sources`
- Phase 2: `handoff_feedback`, `handoff_confidence` state
- Phase 3: `unidades`, `visits`, `agents`

---

## 5. Plano faseado

Cada fase termina com checkpoint: screenshot + typecheck verde + "aprovar/ajustar".

### **Phase 0 — Fundação** (~2 dias)
1. `src/design/tokens.ts` + `tokens.css` importado em globals.
2. `src/components/ui/*` — 12 primitivos com props tipadas, zero lógica de negócio.
3. `src/lib/auth/role.ts` + `RoleProvider` + `useCan` (stub role via `system_settings`).
4. `src/components/shell/AppShell.tsx` + `Sidebar` + `Topbar` + `CommandPalette` (skeleton).
5. `src/app/(shell)/layout.tsx` consumindo tudo.
6. Migrar 1 rota trivial (`/ajustes` ex-configuracoes) pra o shell novo como smoke test.

**Critério**: shell renderiza, sidebar filtra por role stub, typecheck verde.

### **Phase 1 — Inbox Cockpit** (~3 dias, maior ROI)
1. Migrations: `leads.score`, `messages.sources`, `lead_events`.
2. Cálculo de score no `router` node.
3. `answer` node grava `sources` em `messages`.
4. Priority rail component + endpoint.
5. Nova `/inbox` + `/inbox/[id]` com 3-col, bubble rica, source-bar, score ring.
6. HUD de 3 sugestões (consume `copilot.ts`).
7. Command palette ⌘K funcional (search leads + shortcuts).
8. Deprecar `/admin/leads` (redirect).

**Critério**: todas as interações do admin hoje em `/admin/leads` continuam
funcionando; ganhos visíveis: score, provenance, priority rail.

### **Phase 2 — Handoff + Brief + Gestor** (~4 dias)
1. `/handoff/[leadId]` — diff rascunho + decision radio + commit bar ("add ao FAQ" → endpoint real).
2. `/brief` — consome `src/lib/brief.ts` (já gera narrativa); decision-cards clicáveis.
3. `/gestor` — migra `/admin/funnel` + adiciona sparklines + alertas operacionais + conversão por corretor (usa agent_id quando existir; senão "single agent" placeholder).
4. Migration `handoff_feedback` + UI no thread (Tier 3 #1 do TECH_DEBT).

**Critério**: ciclo completo "brief manhã → handoff review → feedback" funciona ponta-a-ponta.

### **Phase 3 — Empreendimentos + Pipeline + Agenda** (~4 dias)
1. Migrations: `unidades`, `visits`, `agents`.
2. `/empreendimentos` split view + tipologia cards + unit-matrix.
3. `/empreendimentos/[id]` com tabs (Visão, Tipologias, Unidades, FAQs IA, Docs).
4. `/pipeline` kanban (drag-between-stages com optimistic update).
5. `/agenda` com tabs Hoje / Follow-ups / Visitas.
6. Tools reais do agente (TECH_DEBT Tier 3 #4 fase 1): `check_availability`, `schedule_visit`.

**Critério**: corretor consegue receber brief, revisar handoff, puxar tabela
de unidades disponíveis, agendar visita — tudo de dentro do app.

### **Phase 4 — Mobile PWA + Polimento** (~3 dias)
1. PWA manifest + service worker + ícones.
2. `(mobile)` route group com `MobileShell`.
3. Swipe-stack (`framer-motion`) com gesture conectado às decisions.
4. Phone tabbar 4 abas.
5. Acessibilidade pass (focus rings, aria-labels, prefers-reduced-motion).
6. Empty states + loading skeletons + error boundaries em tudo.

**Critério**: Lighthouse PWA > 90; keyboard nav em todas rotas desktop.

### **Phase 5 — Corretor profile hardening** ✅ (concluído 2026-04-21)
1. ✅ Auth Supabase magic-link (fecha TECH_DEBT 🔴 #1).
   - `@supabase/ssr` server client (`src/lib/auth/supabase-server.ts`) + `getSession()` helper.
   - `/login` com magic-link, `/api/auth/send|callback|logout`.
   - `getCurrentRole()` lê sessão real → agent.role; fallback pro stub só quando `BH_ALLOW_ROLE_STUB=1` em dev.
2. ✅ `agents` table → relação agent ↔ user.
   - Migration `20260421000001_phase5_auth.sql` adiciona `agents.user_id uuid references auth.users(id)`.
   - Trigger `on_auth_user_created_link_agent` amarra auto por email (ci) no INSERT em auth.users.
   - Backfill idempotente pra auth.users pré-existentes.
3. ✅ Inbox filtrado por `assigned_agent_id` quando role=corretor.
   - `inbox_items(search_text, p_agent_id)` agora filtra server-side.
   - `/inbox`, `/m/inbox`, `/inbox/[id]`, `/api/inbox/list` passam `p_agent_id` quando role=corretor.
4. ✅ Middleware auth gate.
   - `src/middleware.ts`: sem sessão → redirect pra `/login?next=<path>`.
   - Paths públicos: `/login`, `/api/auth/*`, `/api/webhook/*`, `/api/cron/*`, `/api/handoff/*`, `/handoff/*`.
   - Guard server-side `requirePermission()` / `requireAdmin()` pra defesa em profundidade.
5. ✅ UserChip no rodapé da Sidebar com dropdown {nome, email, role, sair}.

**Deploy notes**:
- Aplicar migration: `supabase db push` (ou via SQL editor) — cria `agents.user_id` + trigger + `current_agent()` RPC.
- Cadastrar corretor: inserir em `agents(name, email, role='corretor', active=true)` via `/ajustes` ou seed.
- Prod: setar **NÃO** `BH_ALLOW_ROLE_STUB`; em dev deixar `BH_ALLOW_ROLE_STUB=1` pra contornar login durante hot-reload.

**Total**: ~18 dias de trabalho contínuo. Cada fase é auto-contida e pode ser pausada.

---

## 6. Princípios não-negociáveis

1. **Zero inline styles novos.** Todo estilo via token CSS ou className.
2. **Zero duplicação de copy.** `HANDOFF_REASON_LABEL`, `URGENCY_STYLE` etc. migram pra `src/lib/handoff-copy.ts` (fecha TECH_DEBT 🟢 item 1) na Phase 0.
3. **Role é dado, não patch.** `can(role, perm)` em todo gate; nunca `if (pathname.startsWith("/admin"))`.
4. **Estado tem 4 formas visuais sempre.** loading, empty, error, success — nenhuma rota ship sem as 4.
5. **Mockup é verdade visual, código atual é verdade funcional.** Quando conflito → **escolhe melhor produto**, documenta decisão no PR.
6. **Nada de `@ts-ignore` novo.** Se tipar der trabalho, faz.

---

## 7. Decisões travadas (2026-04-20)

1. **Auth**: fica pra **Phase 5**. Durante Phase 0–4 o role é lido de
   `system_settings.current_role` (stub dev). `middleware.ts` já prepara o
   shape do gate — só troca a fonte na Phase 5.

2. **`/admin/*` durante migração**: sim, continua acessível com banner
   "versão clássica" até Phase 2 fechar. Deprecia na Phase 3.

3. **Corretor NÃO vê custo/usage**: confirmado. Nenhum R$ na UI do corretor.
   Brief pode agregar ações ("IA atendeu 18 leads") mas sem valor monetário.

4. **Score calculado no router node**: +50ms por mensagem é aceitável —
   contexto já está quente.

5. **Mobile PWA**: só brief + decisions + inbox + agenda. Empreendimentos e
   gestor ficam desktop-only.

---

## 8. Próximo passo concreto

Aguardo seu OK no plano. Quando aprovar, começo **Phase 0** com:

1. Criar `src/design/tokens.ts` + `src/design/tokens.css`.
2. Criar `src/components/ui/` com os 12 primitivos.
3. Criar `src/lib/auth/role.ts` + `RoleProvider`.
4. Criar `src/components/shell/AppShell.tsx` + `Sidebar` + `Topbar`.
5. Migrar `/admin/configuracoes` → `/ajustes` como smoke test.
6. Typecheck verde + screenshot + checkpoint.

Se algum item das decisões pendentes tiver resposta diferente da minha
recomendação, ajusto o plano antes de começar.

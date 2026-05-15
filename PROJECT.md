# Kawalec Command Center — projekt-specific context

Aplikacja OM standalone, single-tenant agencyjny. Migracja z Twenty CRM, MCP server jako single source of truth dla agentów AI.

**Source of truth:** [`/.ai/specs/PRD.md`](.ai/specs/PRD.md) (v0.1, 2026-05-15)
**Aktualna faza:** Faza 1 — CRM Foundation + Migracja z Twenty + MCP
**Status:** scaffold gotowy, przed `yarn setup`

## Decyzje produktowe (z PRD §6, zatwierdzone 2026-05-15)

| # | Decyzja | Wartość |
|---|---------|---------|
| D1 | Notatki (Twenty → OM) | Task typu `note` (status: done) |
| D2 | Default AI model | **Google Gemini** (3 Flash gdy dostępny, fallback `gemini-2.5-flash`). ENV: `OM_AI_PROVIDER=google`, `OM_AI_MODEL=google/gemini-3-flash`, klucz `GOOGLE_GENERATIVE_AI_API_KEY`. Anthropic Sonnet 4.6 jako secondary fallback. |
| D3 | Mutation Approval (MCP) | ON domyślnie. Per-tool override w settings dla zaufanych operacji. |
| D4 | Język UI | PL (jeśli OM ma locale `pl`; w innym razie EN z PL terminologią w copy). |
| D5 | Timezone | `Europe/Warsaw` w UI, UTC w bazie. |
| D6 | Waluta domyślna | PLN. Multi-currency włączone (EUR/USD dla klientów zagranicznych). |
| D7 | Domena produkcyjna | `cc.kawalec.pl` |
| D8 | NIP/REGON walidacja + GUS lookup | **Faza 5** (z fakturowaniem). W Fazie 1 nie dodajemy. |
| D9 | Email sync (Gmail/IMAP → timeline) | **Nie w Fazie 1.** Plan: Faza 2.5. |
| D10 | Repo GitHub | `kawalec/command-center` (private) |
| D11 | Importer Twenty CRM | Claude pisze (CLI `mercato migration:import-twenty`) |
| D12 | Userzy startowi | 1-3 (admin + 1-2 account_managers — listę emaili dostarczyć przed deployem). |

## Architektura — kluczowe ograniczenia (z PRD §2.2)

- **Zero modyfikacji `node_modules/@open-mercato/core`.** Pakiety to dependency, nie ruszamy.
- **Cała customizacja w `src/modules/` z `from: '@app'`** w `src/modules.ts`.
- **Eject** tylko gdy musimy zmienić wewnętrzny model danych modułu core (na razie nie planujemy).
- **Side-effecty przez Event Bus** (`createModuleEvents`, subscribers).
- **Write'y przez Command Pattern** (audit log + undo/redo dostajemy za darmo).
- **RBAC feature-based.** Nie używamy `requireRoles` — tylko `requireFeatures` z `acl.ts` (immutable IDs).
- **Encje per moduł, migracje per moduł.**

## Włączone moduły (`src/modules.ts`)

Z presetu `crm` + dodane dla Fazy 1: `sales`, `tasks`, `attachments`, `integrations`.

Pełna lista: `auth`, `directory`, `configs`, `entities`, `query_index`, `api_docs`, `audit_logs`, `notifications`, `dashboards`, `events`, `customers`, `sales`, `tasks`, `attachments`, `integrations`, `dictionaries`, `feature_toggles`, `ai_assistant`.

## Pipeline (do skonfigurowania w setup.ts overlaya)

Sales pipeline z 7 stages: **Lead → Qualified → Discovery → Proposal → Negotiation → Won / Lost**.

## Dictionaries (do skonfigurowania)

- **Lead source:** Inbound form / Outbound / Referral / LinkedIn / Konferencja / Inne
- **Industry:** SaaS / E-commerce / Fintech / Healthtech / Edtech / Inne
- **Tech stack** (custom field na company, multi-select): JS/TS / Python / Go / .NET / PHP / Java / Inne
- **Deal type** (custom field na opportunity): Fixed price / T&M / Retainer / Discovery

## Custom fields (do dodania w setup.ts)

- `customers.Company`: `arr` (CURRENCY), `icp` (BOOLEAN), `tech_stack` (multi-select), `linkedin` (TEXT)
- `sales.Opportunity`: `deal_type` (SELECT z dictionaries)

## Role (RBAC, feature-based)

| Rola | Uprawnienia |
|------|-------------|
| `admin` | Wszystko |
| `account_manager` | Pełny CRUD na customers/sales/tasks. Wszystkie deale (nie tylko swoje). Attachments RWD. Read-only na konfigurację. |
| `member` | Read-only na CRM. CRUD na własne taski. Bez dostępu do konfiguracji. |

## Faza 1 — Definition of Done (z PRD §5)

- [ ] OM stoi na `kawalec-vps` pod `cc.kawalec.pl` przez HTTPS
- [ ] Admin może się zalogować, drugi user (account_manager) widzi CRM
- [ ] Pipeline 7 stages skonfigurowany
- [ ] Dictionaries skonfigurowane (lead source / industry / tech stack / deal type)
- [ ] Custom fields działają (ARR, ICP, tech stack, deal type)
- [ ] Dane z Twenty zaimportowane (companies, people, opportunities, tasks, notes); spot-check 20 rekordów OK
- [ ] MCP odpowiada na external request z auth tokenem
- [ ] `docs/mcp-setup.md` napisany, przetestowany z Claude Desktop (1 read + 1 write z approvalem)
- [ ] Backup bazy + storage skonfigurowany i przetestowany (restore na lokalu)
- [ ] 12 smoke testów manualnych z PRD §4.8.1 przechodzi

## Komendy przydatne

```bash
yarn setup            # full bootstrap (deps + .env + db:migrate + initialize + dev)
yarn dev              # dev server (compact splash on :4000, app on :3000)
yarn db:migrate       # run migrations
yarn db:greenfield    # reset + recreate DB
yarn generate         # regenerate module artifacts
yarn mercato init --no-examples       # seed tenant
yarn mercato user:create              # create user
```

## Linki

- PRD: [`/.ai/specs/PRD.md`](.ai/specs/PRD.md)
- OM Reference repo (lokalnie, do eksploracji): `/Users/dawid/clienty/open mercato/open-mercato-ezd-main/`
- OM docs: https://docs.openmercato.com
- OM GitHub: https://github.com/open-mercato/open-mercato

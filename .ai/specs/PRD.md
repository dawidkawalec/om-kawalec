# PRD: Command Center na Open Mercato

> Centralne miejsce dowodzenia dla agencji software house: CRM (migracja z Twenty), wiadomości, taski, projekty, support tickets, raportowanie, billing. Wszystko w jednym OM, spięte z agentami AI przez MCP. Single source of truth.

**Wersja:** 0.1 (draft)
**Data:** 2026-05-15
**Autor:** Tomasz (PM), Claude (consulting)
**Status:** propozycja do akceptacji przed startem Fazy 1
**Docelowy executor:** Claude Code w lokalnym repo OM

---

## 1. Kontekst i cel

### 1.1. Problem

Agencja prowadzi działalność rozproszoną po wielu zewnętrznych systemach (Twenty CRM dla leadów, mail dla komunikacji, ad-hoc narzędzia dla projektów i wyników). Brak jednego miejsca z którego widzę leady, projekty, faktury i pracę zespołu. Każdy system ma własne konto, własny UI, własne API, własne reguły. Agenty AI nie mają jednego endpointu z którego mogą czytać i pisać dane operacyjne.

### 1.2. Cel docelowy

Jeden system - Open Mercato - jako single source of truth dla operacji agencyjnych. Zewnętrzne narzędzia (Twenty CRM, inne) zostają zaorane po migracji. Praca zespołu, leady, klienci, projekty, taski, support, faktury, raporty - wszystko w OM. Każdy z tych obszarów dostępny dla agentów AI przez MCP server wbudowany w OM.

### 1.3. Cel Fazy 1 (MVP)

Działający CRM w OM z importem danych z Twenty, team z dostępami, MCP server włączony i opisany jak go podpiąć do Claude Desktop / Claude Code / innych klientów. Reszta (projekty, support, billing) - kolejne fazy.

### 1.4. Non-goals (poza zakresem całego PRD na ten moment)

- Marketing automation, drip campaigns, lead scoring ML
- Telefonia / VoIP wbudowany (do rozważenia później przez integracje, nie w OM core)
- Pełna księgowość, JPK, KSeF (planowane w Fazie 5, ale nie zastępujemy biura rachunkowego)
- Multi-tenancy w sensie SaaS na sprzedaż (OM ma multi-tenant ale my używamy jako single-tenant agencyjny)

---

## 2. Stack i decyzje architektoniczne

### 2.1. Platforma

**Open Mercato** (https://github.com/open-mercato/open-mercato) jako framework bazowy. Wersja: najnowsza stabilna z `main`.

Stack:
- Next.js (App Router) + TypeScript
- PostgreSQL + MikroORM
- Awilix DI
- zod + bcryptjs + JWT
- MIT license

### 2.2. Konwencja modyfikacji

Trzymamy się Open Mercato Overlay Pattern bez wyjątków:

- **Zero modyfikacji core.** `packages/core/*` traktowane jak npm dependency, nie ruszamy.
- **Cała customizacja w `src/modules/` aplikacji** (overlay) oznaczona `from: '@app'`.
- **Eject** tylko gdy musimy zmienić wewnętrzny model danych modułu core - na razie nie planujemy.
- **Side-effecty przez Event Bus** (np. `customers.deal.created` -> automatyczne taski powitalne).
- **Write'y przez Command Pattern** (audit log + undo/redo dostajemy za darmo).
- **Multi-tenancy automatyczna** - choć używamy single-tenant, nie obchodzimy filtra org/tenant.
- **Encje per moduł, migracje per moduł.**

### 2.3. Hosting i infrastruktura

- VPS: **Hetzner, instancja `kawalec-vps`** (Claude Code zna kontekst)
- Postgres: lokalnie na VPS w Dockerze (na start) lub managed Postgres jeśli skala wymusi
- Storage załączników: lokalnie na VPS (`apps/mercato/storage/`) - OM ma to ogarnięte natywnie
- Reverse proxy: nginx / Caddy
- TLS: Let's Encrypt
- Backup: pg_dump + storage tarball, cronem na zewnętrzne S3-compatible (do uzupełnienia)
- Domena: do ustalenia (sugestia: `cc.kawalec.pl` lub podobnie - "command center")

### 2.4. Agenty AI

- OM ma wbudowany MCP server (`packages/ai-assistant`)
- MCP eksponuje narzędzia CRUD i search z każdego modułu który deklaruje `ai-tools.ts`
- Modele AI konfigurowalne per moduł (`OM_AI_<MODULE>_MODEL`) - Anthropic / OpenAI / Google
- Mutacje przechodzą przez "mutation approval" workflow (`ai_pending_actions`) - AI proponuje, człowiek zatwierdza w UI

---

## 3. Fazy rozwoju

Każda faza ma osobny SPEC w `.ai/specs/SPEC-YYYY-MM-DD-<nazwa>.md`. SPEC powstaje **na start fazy**, nie z wyprzedzeniem (specy potrafią się dezaktualizować jak długo leżą).

### Faza 1 - CRM Foundation + Migracja + MCP (start)

**Cel:** Działający CRM w OM z importem danych z Twenty, team z dostępami, MCP server włączony i udokumentowany.

**Zakres:**
- Setup OM na Hetznerze (`create-mercato-app`, init, deploy)
- Konfiguracja modułów core: `customers`, `sales`, `tasks`, `attachments`, `auth`, `directory`, `ai_assistant`
- Konfiguracja Pipeline (stages), Dictionaries (źródła leadów, branże, statusy)
- Team setup: użytkownicy, role (admin / account-manager / member)
- Migracja danych z Twenty (jednorazowy import: companies, people, opportunities, tasks, notes)
- MCP server włączony, autoryzowany, opisany w `docs/mcp-setup.md` - instrukcja jak podpiąć Claude Desktop / Claude Code / Cursor
- Smoke testy end-to-end: lead -> deal -> won -> task -> notatka -> załącznik

**Definition of Done:** Faza 1.

**Szacunek:** 5-10 dni roboczych solo z asystą AI (zakładając doświadczonego developera).

**SPEC:** `SPEC-2026-05-15-crm-foundation.md` (do napisania osobno po akceptacji PRD)

### Faza 2 - Support Tickets

**Cel:** Wewnętrzny system zgłoszeń od klientów (lub klientów wewnętrznych) z SLA, statusami, przypisaniami.

**Zakres (high-level):**
- Własny moduł `support_tickets` w `src/modules/support_tickets/` (z `from: '@app'`)
- Encje: `Ticket`, `TicketComment`, `TicketAttachment`, `TicketSLA`
- Powiązania z `customers.company` i `customers.person` (zgłaszający)
- Powiązania z `sales.opportunity` (opcjonalnie - ticket do dealu)
- Pipeline ticketów: New -> Triage -> In Progress -> Waiting on customer -> Resolved -> Closed
- Priorytety: Low / Normal / High / Urgent (Urgent -> notyfikacja na Slack/mail)
- SLA: pierwszy odpowiedź X godzin, rozwiązanie Y godzin, zależnie od priorytetu i typu klienta
- Customer Portal (OM ma `customer_accounts` module) - klient loguje się i widzi swoje tickety, dodaje komentarze
- Inbound email -> ticket (Faza 2.5, opcjonalnie - wymaga `data_sync` lub własnego mail-poller adaptera)
- AI agent dla support: triage automatyczny, sugestie odpowiedzi, klasyfikacja priorytetu

**Definition of Done:** Mogę założyć ticket z UI i z MCP, klient może go zobaczyć w portalu i odpowiedzieć, SLA są mierzone i widać je w dashboardzie.

**SPEC:** `SPEC-YYYY-MM-DD-support-tickets.md`

### Faza 3 - Projects & Tasks

**Cel:** Projekty klienckie z taskami, sub-taskami, milestones, przypisaniami do ludzi z zespołu.

**Zakres (high-level):**
- Własny moduł `projects` w `src/modules/projects/`
- Encje: `Project`, `Milestone`, `ProjectTask` (osobne od `tasks` core, bo inny use case - task projektowy ma estymację, log godzin, dependencies)
- Powiązanie: `Project` -> `customers.company` (klient) i `sales.opportunity` (z kontraktu) wymagane
- Statusy projektu: Planned -> Active -> On hold -> Completed -> Cancelled
- Task board (Kanban) + lista + Gantt (jeśli starczy czasu - lib `frappe-gantt` lub podobna)
- Subtasks, dependencies (blocks/blocked-by)
- Assignees z `auth.user`
- Estymacja w godzinach, log realizacji
- Integracja z `tasks` core (lub osobno - decyzja w SPEC-u Fazy 3)
- AI agent dla projektu: status report, "co zostało do końca sprintu", risk detection

**Definition of Done:** Tworzę projekt z UI / MCP, dodaję milestones i taski, przypisuję ludziom, widzę progress, wszystko spięte z dealem.

**SPEC:** `SPEC-YYYY-MM-DD-projects.md`

### Faza 4 - Time Tracking & Raporty

**Cel:** Rejestrowanie czasu pracy ludzi na projektach/taskach, raporty do klienta i wewnętrzne KPI.

**Zakres (high-level):**
- Własny moduł `timetracking` w `src/modules/timetracking/`
- Encje: `TimeEntry` (user, project/task ref, start/end lub duration, billable y/n, rate snapshot)
- UI: timer w topbarze (start/stop) + ręczne wpisy + import z toggl/clockify CSV (Faza 4.5)
- Polityka stawek: rate per user per project (overridable per task), domyślny rate z user profile
- Raporty:
  - **Per projekt:** ile godzin wpadło, marża (godziny x rate vs budżet), burndown
  - **Per człowiek:** utilization, billable vs non-billable, wykres tygodniowy
  - **Per klient:** ile godzin w okresie, rozbicie na projekty
- Eksport raportów: PDF (do faktury), CSV (do dalszej obróbki)
- AI agent: tygodniowe podsumowanie dla zespołu, alert "X jest pod-utylizowany", "Projekt Y jedzie po budżecie"

**Definition of Done:** Loguję czas, widzę raport tygodniowy, eksportuję raport miesięczny dla klienta.

**SPEC:** `SPEC-YYYY-MM-DD-timetracking.md`

### Faza 5 - Billing & Faktury

**Cel:** Generowanie faktur na bazie projektów i loga czasu, ewidencja kosztów, marża per projekt.

**Zakres (high-level):**
- Wykorzystujemy OM core `sales` module (Quote/Order/Invoice flow) jako bazę
- Overlay rozszerzający Invoice o:
  - Polskie pola: NIP klienta, NIP wystawcy, miejsce wystawienia, sposób płatności PL
  - Walidacja NIP (algorytm GUS) i lookup z GUS API (autouzupełnienie firmy)
  - Numerator faktury z konfigurowalnym wzorem (FV/{YYYY}/{MM}/{n})
  - Generowanie PDF faktury (lib `pdfkit` lub `puppeteer` -> HTML template)
- Encja `Expense` (koszty) w osobnym module lub w `billing`
- Raport "marża per projekt" = przychody (faktury) - koszty (expense) - koszt pracy (timetracking x rate)
- KSeF integration (Faza 5.5 lub osobno, do decyzji - może okazać się że łatwiej zostawić biuru rachunkowemu)
- AI agent: "wystaw fakturę za marzec dla X", draft faktury z log timetrackingu

**Decyzja architektoniczna do podjęcia w SPEC-u:** overlay core `sales` czy własny moduł `billing_pl`. Domyślnie overlay, bo dostajemy Quote/Order/Invoice za darmo.

**Definition of Done:** Z timetrackingu klikam "wystaw fakturę", dostaję draft PDF zgodny z PL, koryguję, akceptuję, klient dostaje mailem.

**SPEC:** `SPEC-YYYY-MM-DD-billing.md`

### Faza 6 (opcjonalna) - Dashboard "Command Center" i widgety zbiorcze

**Cel:** Strona startowa która zbiera wszystko: leady tygodnia, projekty na czerwono, niezafakturowane godziny, otwarte tickety, top deals w pipeline, KPI zespołu.

OM ma natywnie Dashboard Analytics Widgets - układamy własną stronę z widgetami z każdego z modułów. To overlay, nie nowy moduł.

---

## 4. Faza 1 - szczegółowy zakres

### 4.1. Setup repo i deployment

#### 4.1.1. Stworzenie aplikacji

```bash
npx create-mercato-app command-center
cd command-center
yarn setup
yarn mercato init --no-examples
```

Repo trafia do GitHuba (prywatne) - nazwa do ustalenia (sugestia: `kawalec/command-center`).

Branche zgodnie z OM convention: `main`, `develop`, `feat/<nazwa>`.

#### 4.1.2. Deploy na Hetzner

VPS `kawalec-vps`:
- Dokumentacja deploya w `docs/deployment.md`
- docker-compose dla: Postgres, OM app, nginx, certbot
- Variable `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `OM_AI_DEFAULT_MODEL`, `OM_AI_ANTHROPIC_API_KEY` (lub OpenAI)
- Migracja bazy: `yarn db:migrate`
- Setup tenant initial: `yarn mercato init` -> jeden tenant "Kawalec Agency", jedna organizacja root "Kawalec"

### 4.2. Moduły core które używamy w Fazie 1

Wszystkie z `packages/core/`, bez modyfikacji:

| Moduł | Po co | Stan |
|-------|-------|------|
| `directory` | Tenant + organizacje (drzewo) | używamy default |
| `auth` | Logowanie, role, RBAC | konfigurujemy role |
| `customers` | Person, Company, deal-agnostic kontakty | używamy + konfig dictionaries |
| `sales` | Opportunity (deal), Pipeline, stages | używamy + konfig pipeline |
| `tasks` | Taski podpięte pod cokolwiek (deal, person, company) | używamy default |
| `attachments` | Załączniki do encji | używamy default |
| `ai_assistant` | MCP server + agent infrastructure | włączamy + konfigurujemy klucz API |
| `integrations` | Registry integracji (na przyszłość) | włączamy, pusty |
| `notifications` | In-app notyfikacje | używamy default |
| `audit` (jeśli jest w core) | Audit log | włączamy |

### 4.3. Konfiguracja Pipeline i Dictionaries

#### 4.3.1. Pipeline "Sales" (domyślny)

Stages (do potwierdzenia / dopasowania do Twojego flow):

1. **Lead** - kontakt wpadł, nie zakwalifikowany
2. **Qualified** - rozmowa była, jest sens dalej
3. **Discovery** - zbieramy wymagania
4. **Proposal** - wysłaliśmy ofertę
5. **Negotiation** - rozmowy o warunkach
6. **Won** (Closed Won) - podpisane
7. **Lost** (Closed Lost) - nie wyszło

Konfigurowalne w `/backend/sales/pipelines` (UI OM) lub seedem w `setup.ts` overlaya.

#### 4.3.2. Dictionaries

- **Lead source** (źródło): Inbound form / Outbound / Referral / LinkedIn / Konferencja / Inne
- **Industry** (branża): SaaS / E-commerce / Fintech / Healthtech / Edtech / Inne
- **Tech stack** (stack klienta - custom field na company): JS/TS, Python, Go, .NET, PHP, Java, Inne (multi-select)
- **Deal type** (typ kontraktu - custom field na opportunity): Fixed price / T&M / Retainer / Discovery

Custom fieldy dodawane w setup.ts overlaya (zgodnie z OM Custom Fields DSL: `cf.text`, `cf.select`, etc.). Patrz `packages/core/AGENTS.md → Custom Fields`.

### 4.4. Team i RBAC

#### 4.4.1. Role

| Rola | Uprawnienia (high-level) |
|------|--------------------------|
| `admin` | Wszystko - zarządzanie userami, rolami, konfiguracja modułów, dostęp do wszystkich danych |
| `account_manager` | Pełny CRUD na `customers`, `sales`, `tasks`. Widzi wszystkie deale (nie tylko swoje). RWD attachments. Read-only na konfigurację. |
| `member` | Read-only na CRM (kontakty, deale). CRUD na własne taski. Bez dostępu do konfiguracji. |

W kolejnych fazach dojdą uprawnienia per moduł (tickets-agent, project-manager, finance, etc.). Wszystko przez `packages/core/auth` feature-based RBAC z `acl.ts`. **Nie używamy `requireRoles`** - tylko `requireFeatures` (immutable IDs).

#### 4.4.2. Użytkownicy startowi

W Fazie 1 zakładamy 1-3 użytkowników (Ty + max 2 osoby z zespołu). Pełna lista do dostarczenia przed deploymentem (email + rola). Hasła startowe generowane przez `yarn mercato user:create` (lub w UI po pierwszym loginie admina).

### 4.5. Migracja z Twenty CRM

#### 4.5.1. Co migrujemy

Z analizy schematu Twenty (vanilla, bez customów) - obiekty do migracji:

| Twenty | Open Mercato | Notatki |
|--------|--------------|---------|
| `company` | `customers.Company` | name, address, domainName -> website, employees, annualRecurringRevenue -> custom field ARR (CURRENCY), idealCustomerProfile -> custom field ICP (BOOLEAN), linkedinLink -> social[linkedin] |
| `person` | `customers.Person` | name (FULL_NAME -> first/last split), emails (EMAILS -> multiple), phones (PHONES -> multiple), jobTitle, company (RELATION), city, linkedinLink, xLink |
| `opportunity` | `sales.Opportunity` (deal) | name, amount (CURRENCY -> deal_amount + currency), closeDate, stage (SELECT -> mapping na nasze stages), company, pointOfContact -> primaryContact, owner -> assignee |
| `task` | `tasks.Task` | title, body (RICH_TEXT_V2 -> markdown lub HTML), dueAt, status, assignee, **taskTargets** (relation polimorficzny do person/company/opportunity) -> entity_id + entity_type w OM |
| `note` | OM nie ma dedykowanej encji "Note" - **trzy opcje:** (a) jako `tasks.Task` z typem "note" / status "done", (b) jako attachment markdown, (c) własna mini-encja `note` w overlay. Rekomendacja: **(a)** dla MVP. | noteTargets analogicznie jak taskTargets |
| `workflow` | Pomijamy - to definicje workflow Twenty, nie aplikujemy 1:1 do OM Workflows | - |
| `dashboard` | Pomijamy - skonfigurujemy własne widgety | - |

Mapowanie stage Twenty -> OM Pipeline:
- (oczekuje informacji jakie masz stages w Twenty - sprawdzimy w SPEC-u Fazy 1; domyślne stage'e Twenty to: New -> Qualified -> Demo -> Proposal -> Won/Lost - mapuje się 1:1)

#### 4.5.2. Jak migrujemy

**Sam zrobisz technicznie**, więc PRD opisuje tylko podejście rekomendowane, nie generujemy kodu importera w ramach Fazy 1.

Rekomendowane podejście:

1. **Export z Twenty:** REST API Twenty (`GET /rest/people`, `GET /rest/companies`, etc.) -> JSON-y do plików lokalnie
2. **Skrypt importowy w OM:** CLI command w `src/modules/_migration/cli/import-twenty.ts` (overlay), wywołanie `yarn mercato migration:import-twenty --input ./dump`
3. **Transformacja + insert przez Command Bus** (nie raw em.persist, bo chcemy audit log i undo)
4. **Walidacja:** liczbowo (X firm w Twenty -> X firm w OM), spot-check na kilku rekordach
5. **Cutover:** wykonujemy jednorazowo na produkcji w okienku serwisowym; backup OM bazy przed startem

#### 4.5.3. Co NIE migrujemy

- Workflow definitions z Twenty
- Dashboardy z Twenty
- Logi audytowe Twenty (createdBy/updatedBy z `ACTOR` - mapujemy na system-user "imported-from-twenty" jeśli nie da się sparować po emailu)
- Historia zmian (Twenty version history -> OM version history nie syncujemy, importowane rekordy są snapshotem z dnia migracji)

### 4.6. MCP Server - włączenie i dokumentacja

#### 4.6.1. Włączenie

MCP server jest częścią `ai_assistant` module w OM core. Włączenie:

- ENV: `OM_MCP_ENABLED=true`, `OM_MCP_AUTH_TOKEN=<długi-losowy>`, `OM_AI_ANTHROPIC_API_KEY=<klucz>`
- Endpoint: `https://<hostname>/api/mcp` (dokładny path do potwierdzenia z `packages/ai-assistant/AGENTS.md`)
- Two-tier auth: session token (JWT z OM) + dedykowany MCP auth token

Domyślnie MCP eksponuje narzędzia z modułów które deklarują `ai-tools.ts`. Dla `customers`, `sales`, `tasks` to powinno działać z core. Sprawdzenie i ew. uzupełnienie - na poziomie SPEC-u Fazy 1.

#### 4.6.2. Mutation Approval

Domyślnie włączone: AI nie pisze do bazy bezpośrednio, generuje `ai_pending_actions` które admin akceptuje w UI. Konfigurowalne per moduł w settings.

Dla Fazy 1: **włączone domyślnie** (bezpieczniej). W kolejnych fazach możemy luzować per tool (np. "AI może tworzyć notatki bez approvala, ale nie usuwać dealów").

#### 4.6.3. Dokumentacja podłączenia - `docs/mcp-setup.md`

Plik wygenerowany w ramach Fazy 1 zawiera:

- **Claude Desktop:** konfiguracja w `claude_desktop_config.json` (sekcja `mcpServers`)
- **Claude Code (CLI):** konfiguracja w `.mcp.json` w projekcie (`servers.command-center.url` + auth)
- **Cursor:** odpowiednik konfiguracji Cursor MCP
- **Inne klienty MCP** (Continue, etc.) - link do oficjalnej OM dokumentacji
- **Test connection:** komenda CLI która sprawdza czy MCP odpowiada (`yarn mercato mcp:test`)
- **Lista dostępnych narzędzi** (auto-generowane z `ai-tools.ts` wszystkich włączonych modułów)
- **Przykładowe prompty:** "pokaż otwarte deale w stage'u Proposal", "stwórz nowy lead z notatek", "ile firm z branży SaaS mamy"

### 4.7. UI Fazy 1

Bez customizacji UI. Używamy defaultowych stron OM:

- `/backend/customers/companies` - lista firm
- `/backend/customers/people` - lista kontaktów
- `/backend/sales/opportunities` - pipeline (Kanban view)
- `/backend/tasks` - moje taski + wszystkie taski
- `/backend/ai-assistant` - chat z AI agent (alternatywa do MCP, dla osób bez Claude Desktop)
- `/backend/users` - zarządzanie zespołem (admin only)
- `/backend/settings/pipelines` - konfiguracja pipeline
- `/backend/settings/dictionaries` - słowniki

Strona startowa (dashboard): default OM. Custom widgety w Fazie 6.

### 4.8. Testy Fazy 1

#### 4.8.1. Smoke testy manualne

Lista scenariuszy do przejścia przed uznaniem Fazy 1 za DONE:

1. Loguję się jako admin, widzę puste/zaimportowane dashboardy
2. Tworzę firmę ręcznie z UI -> firma na liście
3. Tworzę kontakt powiązany z firmą -> widać w detalu firmy
4. Tworzę dealu (opportunity) podpięty pod firmę i kontakt -> widać w pipeline
5. Przesuwam dealu między stage'ami drag-and-dropem -> stage się zmienia
6. Dodaję task podpięty pod dealu -> task widoczny w detalu dealu i w "moje taski"
7. Dodaję notatkę (jako task typu note) -> widoczna w timeline
8. Dodaję załącznik (PDF oferty) do dealu -> widoczny w detalu i można pobrać
9. Zapraszam drugiego użytkownika z rolą account_manager -> może się zalogować, widzi deale ale nie ustawienia
10. Z Claude Desktop wywołuję MCP narzędzie "list_opportunities_by_stage" -> dostaję listę
11. Z Claude Desktop wywołuję "create_lead" -> dostaję pending action -> akceptuję w UI -> lead utworzony
12. Spot-check 20 losowych rekordów po migracji z Twenty - dane się zgadzają

#### 4.8.2. Testy automatyczne

W Fazie 1 nie piszemy nowych testów (używamy core'owych modułów, OM ma już własne testy CRM). Dla skryptu migracyjnego: unit test dla mapperów (Twenty -> OM) dla każdego typu encji.

### 4.9. Konfiguracja AI

- Provider: Anthropic (Claude Sonnet 4 lub nowszy domyślnie)
- Per-module override przez ENV: `OM_AI_CUSTOMERS_MODEL=claude-opus-4-7` (jeśli chcemy lepszy model dla customer-related agentów)
- Klucz API: w secretach (`.env.production`, nie w repo)
- Loop budgets: domyślne OM (do dostrojenia po wstępnym używaniu)

---

## 5. Akceptacja Fazy 1 (Definition of Done)

Faza 1 jest skończona kiedy:

- [ ] OM stoi na `kawalec-vps`, dostępny pod ustaloną domeną przez HTTPS
- [ ] Admin może się zalogować
- [ ] Drugi użytkownik (account_manager) może się zalogować i widzieć CRM
- [ ] Pipeline ma skonfigurowane stages (7 sztuk z 4.3.1)
- [ ] Dictionaries skonfigurowane (lead source, industry, tech stack, deal type)
- [ ] Custom fieldy na company i opportunity działają (ARR, ICP, tech stack, deal type)
- [ ] Dane z Twenty zaimportowane (companies, people, opportunities, tasks, notes), spot-check na 20 rekordach przeszedł
- [ ] MCP server odpowiada na zewnętrzny request z poprawnym auth tokenem
- [ ] `docs/mcp-setup.md` napisany, przetestowany z Claude Desktop minimum jedno narzędzie (read) i jedno z approvalem (write)
- [ ] Backup bazy + storage skonfigurowany i przetestowany (restore na lokalu)
- [ ] Wszystkie 12 smoke testów manualnych z 4.8.1 przechodzi

---

## 6. Decyzje otwarte do potwierdzenia

Lista rzeczy które domyślnie zdecydowałem - poproszę o potwierdzenie/korektę przed startem SPEC-u Fazy 1:

| # | Decyzja | Default | Alternatywa |
|---|---------|---------|-------------|
| D1 | Note jako task typu "note" | Tak | Własny moduł `notes` (overkill na MVP) |
| D2 | Default model AI | Claude Sonnet 4 | Opus dla droższych operacji, Haiku dla tanich |
| D3 | Mutation Approval włączony domyślnie | Tak (bezpieczniej) | Wyłączony dla zaufanych narzędzi |
| D4 | Język UI | PL (jeśli OM ma PL locale - sprawdzić) | EN (default OM) |
| D5 | Strefa czasowa | Europe/Warsaw | UTC w bazie, PL w UI - default OM |
| D6 | Waluta domyślna | PLN | EUR / USD też włączone (multi-currency w OM core) |
| D7 | Domena | `cc.kawalec.pl` (sugestia) | Inna do ustalenia |
| D8 | NIP/REGON walidacja na company | **Faza 5** (z fakturowaniem) | Już w Fazie 1 jako custom field bez walidacji |
| D9 | Email sync (Gmail/IMAP -> timeline) | NIE w Fazie 1, do Fazy 2.5 lub osobny moduł | Tak, jeśli okaże się że jest gotowy konektor |
| D10 | Repo GitHub | Prywatne `kawalec/command-center` | Inne |
| D11 | Migracja - sam piszesz importer | Tak | Claude Code pisze importer w ramach Fazy 1 (dodaje ~2 dni) |
| D12 | Liczba użytkowników startowych | 1-3 | Inna |

---

## 7. Ryzyka i mitigacje

| Ryzyko | Prawdopodobieństwo | Wpływ | Mitigacja |
|--------|--------------------|-------|-----------|
| OM ma jakąś niedoróbkę w `customers` która wymusi eject lub overlay | Średnie | Średni | Eject jest mechanizmem natywnym OM, koszt 1-2 dni. SPEC Fazy 1 sprawdza to przed deployem. |
| MCP server nie eksponuje wszystkich potrzebnych narzędzi | Wysokie | Niski | Każdy moduł core ma `ai-tools.ts`. Brakujące dopisujemy w overlay (1 dzień na moduł). |
| Migracja z Twenty - utracone relacje | Średnie | Wysoki | Importer w trybie dry-run przed prod. Walidacja liczbowa + spot-check. Backup OM przed importem. |
| Wybór złego modelu AI (drogi/wolny) | Niskie | Średni | Per-module ENV override - łatwo przełączyć. |
| Mutation approval zbyt uciążliwy | Średnie | Niski | Konfigurowalny per tool. Wyłączamy dla zaufanych operacji jak "create note". |
| Hetzner kawalec-vps za słaby | Niskie | Średni | OM stack lekki, ale jak coś - upgrade planu Hetzner to 5 min. Postgres można potem wynieść na managed. |

---

## 8. Co dalej (po akceptacji PRD)

1. **Ty:** akceptujesz PRD lub korygujesz decyzje D1-D12
2. **Ja:** piszę `SPEC-2026-05-15-crm-foundation.md` w formacie OM (Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, UI/UX, Configuration, Alternatives Considered, Acceptance Criteria)
3. **Ty:** wrzucasz SPEC + ten PRD do Claude Code w lokalnym repo, Claude Code wykonuje Fazę 1 etap po etapie
4. Po skończeniu Fazy 1 - retrospekcja, korekta PRD dla Fazy 2, SPEC Fazy 2

---

## 9. Słownik

- **OM** - Open Mercato
- **Overlay** - mechanizm OM nadpisywania zachowania core bez modyfikacji core
- **Eject** - skopiowanie modułu core do lokalnego `src/modules/` z odłączeniem od npm
- **MCP** - Model Context Protocol, sposób w jaki agenty AI rozmawiają z aplikacjami
- **UMES** - Unified Module Event System, event bus OM
- **CRUD factory** - generator endpointów REST CRUD w OM
- **DI** - Dependency Injection (Awilix w OM)
- **ACL** - Access Control List, RBAC w OM
- **Deal / Opportunity** - synonim, OM używa "Opportunity" w core
- **Account Manager** - rola w zespole, NIE konto bankowe

---

*Koniec PRD v0.1*
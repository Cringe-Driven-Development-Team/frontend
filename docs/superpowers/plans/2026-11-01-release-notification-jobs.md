# Independent Release Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner must choose the execution method before implementation.

**Goal:** Доставлять алерты enqueue и готовности выпуска независимо от долгой сверки Scrumban в текущем PR #134.

**Architecture:** Разделить существующий `Release status` на независимые jobs `notifications` и `board`. Общая проверка источника сохраняется; единственным писателем журнала остаётся notifications. Для готовности выделяется существующий каталог публикаций/PR/production без чтения issues; текущее событие доставляется до восстановления остальных.

**Tech Stack:** Bun/TypeScript, существующие GitHub REST/GraphQL helpers, GitHub Actions и Telegram Bot API; без новых зависимостей или хранилищ.

**Spec:** `docs/superpowers/specs/2026-11-01-release-notification-jobs-design.md`.

## Global Constraints

- Две jobs без `needs` и workflow-level concurrency. `notifications` использует существующую группу `release-automation`; `board` — `release-board`; обе `cancel-in-progress: false`.
- Enqueue не читает Project API, issues, release-artifacts или production; текущий исходный PR получает приоритет.
- Ready подтверждается успешными артефактами и доверенным CI run. Падение course-sync не отменяет публикацию; уже выкаченный SHA подавляется и после rollback.
- Только notifications пишет baseline и журнал. Board получает Project PAT без Telegram token, notifications — Telegram token без Project PAT.
- Сохраняются baseline, ключи `queue:<event ID>`/`ready:<SHA>`, неизменяемый payload, статусы доставки, запрет автоматического повтора неоднозначной отправки и подхват вытесненных событий.
- Summary готовится до отправки сообщения. Исправление тестового Summary в `75cd34e` сохраняется.
- Алгоритм обхода карточек `board.ts`, правила статусов, CD/Rollback и формат сообщений не меняются. Мерж и настоящая рассылка не входят в реализацию.

## Review Focus

1. Enqueue при наличии старого pending ready не вызывает даже проверку production — Tasks 1–2.
2. Процесс доски завис/потерял Project PAT: уведомления не получают ни зависимости, ни её секретов — Task 3.
3. Повтор/вытеснение run и два enqueue одного PR не создают дублей и не теряют события — Task 2.
4. Частично заданный production payload, чужой Actions run, несколько digest и несколько страниц истории не принимаются за корректную публикацию — Task 1.
5. Сбой подготовки recovery или доски не блокирует уже подготовленное текущее сообщение; неизвестная доставка не повторяется — Tasks 2–3.

## Карта файлов

- `github.ts`, `catalog.ts`, `catalog.test.ts`, `test/fixture.ts`: чтение raw Deployments до запросов статусов и каталог без issues.
- `source.ts` (новый): прежняя проверка репозитория/ref/event/Actions API, общая для двух обработчиков.
- `notification-sync.ts` (новый): перенесённые queue/ready helpers и фазы current/recover.
- `journal.ts`, `journal.test.ts`: выбор вида/ключа доставки; проверка уже выкаченного ready без issues.
- `sync.ts`, `sync.test.ts`: только согласование доски с проверкой источника.
- `notification-sync.test.ts` (перенос сценариев из прежнего `sync.test.ts`): события, восстановление и доставка на HTTP boundary.
- `index.ts`, `release-status.yml`, `workflows.test.ts`, `docs/release.md`: CLI, две jobs, права/секреты и эксплуатация.

### Task 1: Каталог выпусков без чтения задач

**Files:** `scripts/release/github.ts`, `catalog.ts`, `catalog.test.ts`, `test/fixture.ts`.

**Interfaces:**

- Produces `listDeploymentRecords<P>(environment: string, sha?: string): Promise<Omit<Deployment<P>, 'state'>[]>` в `github.ts` — существующая пагинация, нормализация payload и сортировка без запросов статусов.
- Produces `export type ReleaseCatalog = Omit<ReleaseSnapshot, 'issues'>` и `readReleaseCatalog(repoDir: string): Promise<ReleaseCatalog>` в `catalog.ts`.
- Existing `listDeployments<P>` и `readReleaseSnapshot(repoDir)` сохраняют интерфейс и проверки; snapshot дополняет общий каталог через существующий `issuesForPRs`.

- [ ] **1. Добавить тесты в `catalog.test.ts`.** На текущем Git/HTTP fixture проверить:

    ```ts
    const catalog = await readReleaseCatalog(f.dir);
    expect(catalog.published.find((r) => r.sha === f.b)?.prNumbers).toEqual([1, 2]);
    expect([...catalog.deployed]).toEqual([1]);
    expect(f.requests.some((r) => String(r.body?.query).includes('LinkedIssues'))).toBe(false);
    ```

    Добавить автоматический production record с `payload: {}` и id 99: каталог не запрашивает `/deployments/99/statuses`, но сохраняет валидные успешные выкатки. Частичный payload `{action:'deploy'}` с успешным статусом по-прежнему вызывает ошибку. Закрепить прежние случаи разных digest, недоверенного run, вложенного PR, rollback и пагинации через нового потребителя; полный snapshot по-прежнему возвращает issues. Сбой статусов выбранной BFF-записи не маскируется как отсутствие выкатки.

- [ ] **2. RED:** `bun test scripts/release/catalog.test.ts` — новые проверки падают до появления нового читателя.
- [ ] **3. Реализовать читатели.** Вынести raw-часть `listDeployments` в `listDeploymentRecords`; прежний helper добавляет статусы как раньше. В `readReleaseCatalog` перенести существующую подготовку published/prs/deployed/deployedShas. Для production сначала читать raw records и исключать только прежнюю категорию без action/run/image_ref; для остальных читать последний статус через существующий `api`. Все прежние проверки успешного production против опубликованного образа/ассетов и доверенного run остаются. Не менять `board.ts` и читателей CD/retention.
- [ ] **4. GREEN:** `bun test scripts/release/catalog.test.ts scripts/release/board.test.ts scripts/release/sync.test.ts scripts/release/journal.test.ts` — все проходят.
- [ ] **5. Commit:** `refactor(release): read release catalog without issue queries`.

### Task 2: Приоритетная подготовка и доставка уведомлений

**Files:** new `scripts/release/source.ts`, new `notification-sync.ts`, `journal.ts`, `sync.ts`; tests `notification-sync.test.ts`, `journal.test.ts`.

**Interfaces:**

- `source.ts`: `export type AutomationSource = { kind: 'queue'; number: number; updatedAt: string } | { kind: 'workflow'; run: TrustedRun } | { kind: 'manual' }`; `readAutomationSource(): Promise<AutomationSource | undefined>`. Undefined означает неподходящее событие, ошибки доверенной проверки выбрасываются.
- `notification-sync.ts`: `prepareNotifications(repoDir: string, phase: 'current' | 'recover'): Promise<NotificationResult>`; `NotificationResult = { allowed: boolean; prepared: number; kind: 'queue' | 'ready' | 'all'; firstKey?: string; errors: string[] }`.
- `journal.ts`: `sendPending(repoDir: string, kind?: Notice['kind'], key?: string): Promise<DeliveryResult>`. Без kind/key — прежний drain всех pending; kind выбирает вид, key ограничивает единственным сообщением. Фильтр выполняется до обработки состояния и production-проверки других видов. Проверка stale ready использует `readReleaseCatalog`, не snapshot с issues.
- Existing `prepareAutomation` временно сохраняется до Task 3, используя общий source-validator; его окончательное разделение выполняется в Task 3. Обработчики не дублируют проверку доверия.

- [ ] **1. Перенести notification-сценарии прежнего `sync.test.ts` в `notification-sync.test.ts`, сохранив реальный HTTP fixture.** Добавить проверки поведения:
    - `current` enqueue создаёт только ключ события исходного PR; `sendPending(dir,'queue',key)` доставляет его при наличии старого pending ready, не запрашивая production/release-artifacts, LinkedIssues или Project API.
    - Несколько enqueue этого PR имеют разные event IDs; source updatedAt выбирает первое подходящее событие текущего enqueue. Следующая `recover` подхватывает остальные события, включая другого PR; повтор не добавляет POST Telegram. Задержка появления timeline сохраняет существующие пять попыток по 2 секунды.
    - `current` доверенного CI готовит только его публикацию до recovery старой, независимо от порядка pending receipts. CI без готовых артефактов не создаёт ready. Несовпадающий source run не становится источником текущего сообщения.
    - `recover` после CI/ручного запуска читает все страницы и догоняет публикации/queue events после baseline; очередь с вытесненным run восстанавливается по timeline. На enqueue recovery обрабатывает только queue.
    - Project API возвращает 403 и LinkedIssues запрещён: current/recover ready и доставка проходят. В сохранённом Summary есть весь состав PR и точный URL CI.
    - Готовый SHA, уже входивший в production до rollback, получает inactive без Telegram. Сбой подготовки recovery не влияет на ранее доставленный current.
    - Все прежние сценарии ложного source, другой ref/repo/fork, merge_group вместо push, повторов, GraphQL errors и неоднозначной доставки остаются.
      В `journal.test.ts` закрепить фильтр на наблюдаемом результате: queue отправлен, ready остаётся pending, production не читался; последующий выбор ready применяет прежнюю проверку stale. Старые tests unknown delivery/failed success write/429 остаются зелёными.
- [ ] **2. RED:** `bun test scripts/release/notification-sync.test.ts scripts/release/journal.test.ts` — новые пути и фильтр падают до реализации.
- [ ] **3. Реализовать общий source-validator и notification-фазы.** Перенести прежние проверки и queue/ready helpers, сохранив baseline и валидацию. Current enqueue читает только timeline исходного PR/идентичность main queue и журнал; current CI использует Task 1 и совпадение публикации с `run.sha`/`run.url`. Для manual/CD/Rollback текущего нового сообщения нет; recovery остаётся доступен. Перед подготовкой текущего ready вычислять новые PR относительно более ранних публикаций, как раньше, а не менять состав ради приоритета. Recovery готовит остальные события. Только notifications вызывает `ensureBaseline`/`prepareNotice`; общий валидатор не пишет ничего.
- [ ] **4. Реализовать фильтр доставки.** Сохранить ключи, исходный payload и переходы journal; заменить только ненужный snapshot на каталог Task 1. Фильтрация queue исключает обращения к production по чужому pending ready. Не добавлять новый транспорт или автоматический retry неизвестного исхода.
- [ ] **5. GREEN:** `bun test scripts/release/notification-sync.test.ts scripts/release/journal.test.ts scripts/release/catalog.test.ts scripts/release/sync.test.ts` — все проходят.
- [ ] **6. Commit:** `feat(release): prepare and deliver notification events independently`.

### Task 3: Две jobs, отдельная доска и CLI

**Files:** `.github/workflows/release-status.yml`, `scripts/release/index.ts`, `sync.ts`, `sync.test.ts`, `notification-sync.test.ts`, `workflows.test.ts`, `docs/release.md`.

**Interfaces:**

- `sync.ts`: `reconcileBoard(repoDir: string): Promise<{allowed: boolean; board: BoardResult | null; errors: string[]}>`; вместо старого смешанного `prepareAutomation`.
- CLI `sync` вызывает только `reconcileBoard`; `prepare-notifications <current|recover>` вызывает Task 2 и выводит `allowed`, `kind`, `first_key` через существующий `output`; `notify-pending [all|queue|ready] [key]` передаёт выбранный вид/ключ в journal. Unknown phase/kind и несовместимый key prefix отклоняются до отправки.

- [ ] **1. Написать RED-тесты CLI/workflow и board entrypoint.** Parsed YAML должен давать:

    ```ts
    expect(config.concurrency).toBeUndefined();
    expect(config.jobs.notifications.needs).toBeUndefined();
    expect(config.jobs.board.needs).toBeUndefined();
    expect(config.jobs.notifications.concurrency.group).toBe('release-automation');
    expect(config.jobs.board.concurrency.group).toBe('release-board');
    ```

    Проверить `cancel-in-progress: false` у обеих jobs, main/full checkout/persist-credentials:false, отсутствие Project PAT у notifications и Telegram token у board. Board исключён на enqueue. На HTTP boundary при ошибке/заблокированном Project API notifications доставляет сообщение, board отдельно возвращает свою ошибку; board никогда не создаёт baseline/notice и не вызывает Telegram.
    CLI-тест на настоящем локальном HTTP server выполняет current → адресную доставку → recover → drain; до адресной доставки recovery не запускался, Summary уже существует. Повтор не дублирует Telegram. Проверить отказ на invalid source/phase/kind/key и запрет отправки при `allowed=false`. Сохранить `notify-summary.test.ts` и полный прогон с sentinel-файлом унаследованного Summary.

- [ ] **2. RED:** `bun test scripts/release/workflows.test.ts scripts/release/sync.test.ts scripts/release/notification-sync.test.ts` — новые контракты jobs/CLI не выполняются.
- [ ] **3. Сделать `sync.ts` только обработчиком доски.** Проверить source; queue → allowed:false без чтения каталога/Project API. Для CI/CD/Rollback/manual прочитать прежний snapshot и выполнить `syncBoard`; сохранить ошибки и trust guard. Удалить старую смешанную оркестрацию и её устаревший экспорт/CLI-вызов.
- [ ] **4. Подключить CLI и jobs.** В notifications шаги: `prepare-notifications current` → адресный `notify-pending "$KIND" "$NOTICE_KEY"` → `prepare-notifications recover` → drain соответствующего вида. Source из outputs передавать через env с shell quoting. Primary send только при allowed:true и непустом first_key; recovery/drain использовать `always()` с проверкой allowed, чтобы ошибка current/подготовки части событий не скрыла независимые pending. Summary каждого prepare публикуется до следующего send. В board один вызов `sync`. Нет глобальной concurrency/needs; notifications retains `deployments: write`, board достаточно `deployments: read` и Project PAT. Сохраняются содержательные read permissions и vars/секреты каждой job, production flag, timeout и все существующие события workflow. В обоих jobs main checkout, без head PR и без environment production.
- [ ] **5. Обновить `docs/release.md`.** Описать две независимые jobs/очереди, current/recover, подхват вытесненных событий и отдельные ошибки; убрать обещание общей сериализации доски и сообщений. Сам алгоритм доски не меняется. При первом переходе незавершённый старый workflow ещё может удерживать существующую группу notifications; никаких особых legacy-веток не добавлять.
- [ ] **6. Финальные проверки:** `bun run check`, `bun run test`, `bun run build`, `/home/oleg/go/bin/actionlint .github/workflows/release-status.yml`, `git diff --check` — exit 0. Полный suite с временным `GITHUB_STEP_SUMMARY` сохраняет sentinel неизменным. Сверить diff с `e3b327f58f8ef929afe0403ed7c7487abba2c48d`: только согласованный scope и существующий фикс Summary.
- [ ] **7. Commit:** `feat(release): run board reconciliation beside notification delivery`.

## Завершение

- Существующий изолированный worktree `/home/oleg/2026_H2/frontend-web-101`, branch `web-133`; не создавать новый checkout. Начальный commit расширения `0465c92` уже содержит исправление Summary и утверждённый дизайн.
- Способ выполнения этого плана выбирает владелец. После выбора следовать ledger/TDD/ревью соответствующего skill без повторного запроса между задачами.
- После финального ревью обновить существующий PR #134, `Closes #133`, убрать draft и дождаться CI актуального head. Не открывать другой PR и не терять исходную регрессионную проверку.
- Merge, ручной запуск workflows и реальные сообщения — только по указанию владельца.

## Самопроверка плана

Все положения спеки распределены между Tasks 1–3; каждый Review Focus закреплён тестом. Никакой оптимизации цикла `syncBoard`, нового хранилища, API-совместимости или требований uptime. Две очереди независимы; единственный писатель delivery journal сохранён.

Группу notifications оставляем прежней, чтобы не разделить писателей при завершении старых запусков. Область concurrency у workflow и jobs общая в репозитории: [GitHub Docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

# Deployment Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method must be chosen by the owner before implementation.

**Goal:** Показывать задачи и PR изменившейся части выпуска, краткий Health Check и названия PR в уведомлении о начале CD.

**Architecture:** Переиспользовать REST-чтение merged PR и GraphQL закрывающих связей из `catalog.ts`; определять разницу через все страницы GitHub Compare API. `notify.ts` формирует текст и существующую Telegram-клавиатуру, а полный состав пишет в Summary текущего шага. Чтение всей истории Deployments для каждого сообщения не требуется.

**Tech Stack:** Bun, TypeScript, существующие GitHub REST/GraphQL helpers, Telegram Bot API, GitHub Actions; без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-11-01-deployment-notification-design.md`.

## Global Constraints

- `Health Check ✅` / `Health Check ❌` / `Health Check ⚪` выбирается по `RELEASE_HEALTH_STATUS`, независимо от общего результата job.
- Один PR: «PR»; 2–6: «PR #N» по две в строке; более шести: только «Все PR выпуска» → текущий run `#summary`.
- Итог: задачи со ссылками; начало CD: названия PR со ссылками вместо SHA. SHA остаётся в полном отчёте и итоге.
- PR сортируются по номеру; задачи объединяются по GitHub node ID с сохранением всех `prNumbers`. PR без задачи остаётся видимым под своим названием.
- CD показывает добавленные PR; Rollback — удалённые. Неизвестный состав не превращается в пустой.
- Ошибка GitHub/отчёта не скрывает результат выкатки. Состояние переключения и этап сбоя сохраняются.
- Меняются только сообщения, чтение их состава, необходимые read permissions и документация. Без новой выкатки, записи на доску, новых хранилищ или редактирования старых сообщений.

## Review Focus

1. PR на второй странице compare/merged PR или issue на следующей GraphQL-странице не теряется — Task 1.
2. HTTP 200 с GraphQL errors или частично прочитанный состав не выглядит как «PR нет» — Tasks 1–2.
3. Summary недоступен: результат отправляется, не появляется кнопка на несуществующий полный отчёт — Task 2.
4. HTML/Markdown в названии, эмодзи и длинный список сохраняют корректные ссылки, бюджет Telegram и полный отчёт — Tasks 2–3.
5. Health check успешен, но retention упал, либо проверка skipped/cancelled: бейдж отражает именно проверку и не скрывает этап сбоя — Task 2.

## Карта файлов

- `scripts/release/catalog.ts`: общие чтения PR/issues и новый запрос состава между двумя SHA; прежний snapshot продолжает работать.
- `scripts/release/test/fixture.ts`, `catalog.test.ts`: пагинация Compare API, названия PR, реальные Git-диапазоны и HTTP boundary.
- `scripts/release/notify.ts`, `notify.test.ts`: формат обоих сообщений, Summary, длина, кнопки, безопасный fallback.
- `.github/workflows/cd.yml`, `rollback.yml`, `scripts/release/workflows.test.ts`: права чтения PR/issues; передача предыдущего SHA в начало CD.
- `docs/release.md`: фактический формат сообщений и расположение полного списка.

### Task 1: Состав PR и задач между версиями

**Interfaces:**

- Consumes: `api<T>(path, init?)`, `graphql<T>(query, variables, token)`, `checkSha(value)`, текущие `MergedPR` и `LinkedIssue`.
- Produces in `catalog.ts`: `export interface PRChanges { prs: (MergedPR & { title: string })[]; issues: LinkedIssue[]; compareUrl: string }` и `export async function readPRChanges(baseSha: string, headSha: string): Promise<PRChanges>`.
- Private shared helpers: `mergedPRs(): Promise<(MergedPR & { title: string })[]>`, `issuesForPRs(numbers: number[]): Promise<LinkedIssue[]>`; оба используются и новым запросом, и `readReleaseSnapshot`.

- [x] **1. Добавить тесты в `catalog.test.ts` и расширить HTTP fixture.**
      В `fixture.ts` добавить `title: 'PR N'` для PR; Compare API fixture возвращает страницы SHA из настоящего `git rev-list --reverse BASE..HEAD` тестового репозитория. Использовать существующий `f.extra` для ошибок и необычных страниц.
      Основные assertions:

    ```ts
    const changes = await readPRChanges(f.a, f.b);
    expect(changes.prs.map((pr) => pr.number)).toEqual([2]);
    expect(changes.prs[0]?.title).toBe('PR 2');
    expect(changes.issues[0]?.prNumbers).toEqual([2]);
    expect(changes.compareUrl).toBe(`https://github.com/${REPO}/compare/${f.a}...${f.b}`);
    expect((await readPRChanges(f.a, f.a)).prs).toEqual([]);
    ```

    Отдельные тесты: `root..b` включает [1, 2], исключает outside PR [3]; подставленные сообщения коммитов и base ветки не влияют на выбор. 101 compare commit и 101 merged PR требуют следующей страницы; несколько GraphQL-страниц читаются полностью. Общая issue двух PR получает `prNumbers: [1, 2]`, несколько issues одного PR сохраняются; PR без issues сохраняет title/url. Invalid SHA отклоняется до HTTP; HTTP failure и GraphQL errors отклоняют `readPRChanges`.

- [x] **2. Запустить RED:** `bun test scripts/release/catalog.test.ts` — новые тесты падают из-за отсутствия `readPRChanges`; старые остаются зелёными.
- [x] **3. Реализовать чтение в `catalog.ts`.** Вынести существующие циклы PR и объединения issues в указанные private helpers; сохранить проверки номера PR, пагинацию и исключение unmerged записей. Snapshot по-прежнему фильтрует merged SHA по достижимости из `origin/main`. Новый запрос валидирует оба SHA, собирает SHA всех страниц `/compare/BASE...HEAD?per_page=100&page=N`, выбирает PR по `mergeSha`, сортирует по номеру и читает связи только выбранных PR. Пустая страница до достижения заявленного `total_commits` считается неполным ответом, а не успехом. Не вызывать `readReleaseSnapshot` для построения сообщения и не разбирать текст merge-коммитов.
- [x] **4. Запустить GREEN:** `bun test scripts/release/catalog.test.ts scripts/release/board.test.ts scripts/release/sync.test.ts scripts/release/journal.test.ts` — все тесты проходят, прежняя логика доски/публикации сохранена.
- [x] **5. Коммит:** `feat(release): read PR and issue changes between release versions`.

### Task 2: Итог, Health Check, кнопки и полный отчёт

**Interfaces:**

- Consumes: `readPRChanges(baseSha, headSha): Promise<PRChanges>` из Task 1; текущие `sendTelegram`, `button`, `escape`, `runUrl`.
- Produces: прежний `notify(what: string, status: string, sha?: string): Promise<void>` с новым итогом; private `changes(base: string | undefined, head: string | undefined): Promise<{ data?: PRChanges; reportUrl?: string }>` для использования также в Task 3.
- `changes` пишет полный Markdown-отчёт через `GITHUB_STEP_SUMMARY`; `reportUrl` возвращает только после успешной записи, как `${runUrl()}#summary`. При недоступных SHA/data пишет помеченный неполный отчёт, если файл доступен, и возвращает `data: undefined`. Ошибки чтения и записи обрабатываются отдельно: уже полученные данные не пропадают из-за файла Summary.

- [x] **1. Написать RED-тесты в `notify.test.ts` на настоящий `notify` и исходящий JSON Telegram.** Использовать общий release fixture и перехват Telegram через `f.extra`; Summary — временный файл внутри `f.dir`. Проверять payload и содержимое файла, а не приватные helpers.
      Матрица бейджа:

    ```ts
    // RELEASE_HEALTH_STATUS → строка в payload.text
    const cases = [
        ['success', 'Health Check ✅'],
        ['failure', 'Health Check ❌'],
        ['skipped', 'Health Check ⚪'],
        ['cancelled', 'Health Check ⚪'],
        [undefined, 'Health Check ⚪'],
    ];
    ```

    `success` health + `failure` retention даёт зелёный Health Check, красный общий итог и «Этап сбоя: Retention». Провал/отмена switch сохраняет сведения о неизвестном состоянии прода. Старого длинного успешного абзаца нет.
    Клавиатура: 0 PR — нет PR-кнопок; 1 — «PR» с точным URL; 3 — строки [2, 1]; 6 — [2, 2, 2]; 7 — одна «Все PR выпуска» с run `#summary`, без шести выбранных PR. Прод/откат/логи на месте, «Изменения» отсутствует.
    Итог содержит уникальные названия issues со ссылками; PR без issue — title и URL PR. Summary содержит все PR, все связи, оба полных SHA и compare URL, даже при семи PR. Rollback при `before=b`, `sha=a` читает диапазон `a..b` и показывает «Отменённые задачи».
    Ошибки GraphQL/HTTP показывают «Состав изменений недоступен», но Telegram получает результат. Отсутствующий/незаписываемый Summary показывает «Полный отчёт недоступен» при необходимости полного списка и не создаёт мёртвую кнопку. Длинные названия с `<>&`, Markdown и эмодзи не ломают HTML/ссылки; сокращается список в Telegram, но не отчёт. Проверить не более 4096 видимых символов, наличие итога/SHA/бейджа/управляющих кнопок и ссылки на полный отчёт при сокращении.

- [x] **2. Запустить RED:** `bun test scripts/release/notify.test.ts` — новые проверки формата и клавиатуры падают.
- [x] **3. Обновить `notify.ts`.** Заменить старое чтение трёх commit subjects на `changes`; CD передаёт `before, sha`, Rollback — `sha, before`. Добавить краткий бейдж в `deploymentState`, сохранив полезные ветки сбоя. Формировать строки задач, объединяя issue по node ID; добавлять fallback для каждого PR без задачи. Сокращать длинное название до 140 символов, как прежние строки изменений, сохраняя URL; полный текст хранить в отчёте. Укладывать список в остаток бюджета после фиксированной части сообщения и ссылки на отчёт. Неполный состав явно помечать. Экранировать HTML в Telegram и Markdown в Summary. Не добавлять новые параметры CLI или зависимости.
- [x] **4. Добавить права и тест workflows.** В `cd.yml` и `rollback.yml` добавить только `pull-requests: read` и `issues: read` к существующим правам. `workflows.test.ts` проверяет оба разрешения и сохранение `continue-on-error: true`/`always()` у итогового Telegram шага. Новый запрос использует API, поэтому глубокий checkout и `actions: read` не нужны.
- [x] **5. Запустить GREEN:** `bun test scripts/release/notify.test.ts scripts/release/workflows.test.ts scripts/release/journal.test.ts scripts/release/sync.test.ts`; `actionlint .github/workflows/cd.yml .github/workflows/rollback.yml` — exit 0. При отсутствии `actionlint` в PATH использовать `/home/oleg/go/bin/actionlint`.
- [x] **6. Коммит:** `feat(release): show linked tasks PR buttons and health badge`.

### Task 3: Названия PR в начале выкатки и документация

**Interfaces:**

- Consumes: private `changes(base, head)` из Task 2, `RELEASE_BEFORE_SHA` и текущий `notify('start', 'success', sha)`.
- Produces: начало CD с названиями PR вместо SHA, текущим actor и прежней кнопкой логов. CLI и вызовы конечного уведомления сохраняются.

- [x] **1. Написать RED-тесты в `notify.test.ts` и `workflows.test.ts`.** Для одного PR текст содержит title, ссылку на PR, «Выкатка началась» и текущего triggering actor; не содержит полного SHA. Для нескольких PR — все titles со ссылками в порядке номеров. При 0 PR — «Связанных PR нет»; при неизвестном before/API failure — «Состав изменений недоступен»; SHA при этом по-прежнему проверяется до отправки. Длинный список сокращается в бюджете, полный список и SHA доступны в Summary; кнопка «Логи выкатки» ведёт на текущий run во всех исходах. Существующий тест «без запроса compare» заменить: начало теперь сознательно читает состав, но не трогает prod, Deployments или доску. Проверить, что CD start step получает точное `RELEASE_BEFORE_SHA: '${{ steps.confirmed.outputs.before_sha }}'` и остаётся непосредственно перед Switch с `continue-on-error: true`.
- [x] **2. Запустить RED:** `bun test scripts/release/notify.test.ts scripts/release/workflows.test.ts` — новые проверки старта падают.
- [x] **3. Обновить start-ветку `notify.ts` и env шага `Deployment started` в `cd.yml`.** Сначала сохранить `checkSha(sha)` и ограничение `status === 'success'`, затем использовать общий `changes(before, sha)`. В тексте показывать PR titles, не issue titles; переиспользовать правила экранирования/бюджета/отчёта из Task 2. Кнопка старта только «Логи выкатки», а ссылка на полный состав при сокращении — в тексте. Валидация SHA не зависит от его отображения. `GITHUB_STEP_SUMMARY` отдельный для каждого шага: начало и итог пишут каждый свой полный отчёт, без собственного кеша или дедупликации файлов.
- [x] **4. Обновить `docs/release.md`, раздел Telegram.** Описать обе новые карточки, состояния Health Check, задачи и PR без issues, границу 6/7, Actions Summary, поведение при ошибках. Убрать устаревшие обещания первых трёх коммитов и SHA в тексте начала; не менять правила доски или выкатки.
- [x] **5. Финальная проверка:** `bun run check`, `bun run test`, `bun run build`, actionlint для двух workflows и `git diff --check` — exit 0. Просмотреть diff относительно `d0de887946a727190a34aa73797100c0719e461f`; только согласованные файлы/поведение. Проверки Telegram — на HTTP boundary, без реальной рассылки или запуска CD.
- [x] **6. Коммит:** `feat(release): show PR titles when deployment starts`.

## Передача и завершение

- Ветка `web-131`, существующий изолированный worktree `/home/oleg/2026_H2/frontend-web-101`; не создавать ещё один worktree и не менять соседние.
- После выбора способа выполнения вести журнал выбранного skill и соблюдать его проверки/ревью. Способ выполнения прежнего плана #101 не переносится на этот автоматически.
- После финального ревью — PR в `Cringe-Driven-Development-Team/frontend`, base `main`, title `WEB-131: Показывать задачи, PR и Health Check в уведомлениях выкатки`, `Closes #131`; проверить связь и CI актуального head.
- Merge и запуск CD — отдельные действия только после указания владельца. Новая карточка появится в будущих запусках; старые сообщения не меняются.

## Проверка плана

Все пункты спецификации распределены между тремя задачами; Review Focus закреплён тестами. Уведомления очереди/публикации и автоматика доски остаются прежними. Изменение старта из последнего указания владельца включено в Task 3 и спецификацию.

Источники проверены при планировании: [GitHub Compare API и пагинация](https://docs.github.com/en/rest/commits/commits#compare-two-commits), [уникальный для каждого шага GITHUB_STEP_SUMMARY](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables).

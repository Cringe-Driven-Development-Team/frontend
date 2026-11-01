# Release Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показывать готовность и выкатку задач frontend/BFF на Scrumban и отправлять четыре согласованных уведомления в Telegram.

**Architecture:** Один отдельный workflow сверяет успешные Deployments с графом Git и связанными issues. Он сначала обновляет карточки и готовит отчёты/журнал уведомлений, затем отдельным шагом отправляет ожидающие сообщения. Начало и итог выкатки остаются в CD.

**Tech Stack:** Существующие Bun 1.4.4, TypeScript, bun:test, Git, GitHub REST/GraphQL, Actions и Telegram Bot API; новых зависимостей нет.

**Spec:** [2026-11-01-release-status-design.md](../specs/2026-11-01-release-status-design.md).

## Global Constraints

- Рабочий репозиторий: `Cringe-Driven-Development-Team/frontend`; ветка `web-101`; frontend PR — `Closes #101`.
- «Новых сервисов и зависимостей нет». Переиспользовать `scripts/release/` и существующие настройки Telegram.
- «Синхронизация меняет только `Status`, не issue, sprint, assignees или другие поля».
- «Успешная выкатка учитывается навсегда»: повтор и rollback не уменьшают множество уже выкаченных PR.
- «Под ручными статусами здесь понимаются значения вне `Done` и `Ready for release`».
- Репозиторный токен: `contents: read`, `actions: read`, `pull-requests: read`, `issues: read`, `deployments: write`; Project API использует только `ADD_TO_PROJECT_PAT`.
- Checkout только доверенного `main`, полная история, `persist-credentials: false`; не исполнять PR/артефакты исходного run.
- Граница уведомлений — первый main-коммит с `.github/workflows/release-status.yml`; старые карточки подхватываются, исторические сообщения не пересылаются.
- Сообщение Telegram: до 4096 видимых символов; иначе количество PR и «Все PR выпуска» со ссылкой на полный Actions summary.
- Ожидание закрытия/автоматического `Done` — не более 5 минут. Ручные этапы не запускают публикацию/выкатку.
- Каждому новому экспорту JSDoc без дублирования TypeScript-типов. Сохранить error handling и проверки SHA/payload существующих функций.
- Не добавлять совместимость со старым API, новые способы мержа, auto-deploy или требования непрерывной работы прода.
- Коммиты выполняются с обычными git hooks; не использовать `--no-verify` и обход hooks.

## Review Focus

1. GraphQL возвращает HTTP 200 с `errors`, PAT не имеет доступа или URL исходного run указывает в чужой repo: видимая ошибка, без ложного успеха и утечки токена — Task 1/2.
2. Issue переоткрыта или CD завершился между чтением карточки и записью: пропуск переоткрытой задачи и итоговый `Done` для уже выкаченной — Task 2.
3. Telegram принял сообщение, но подтверждение в GitHub не записалось: повтор не делает второй POST, результат требует ручной проверки — Task 3.
4. Первое событие совпало с включением либо два выпуска имеют одинаковое время: событие не поглощается, порядок стабилен по ID — Task 4.
5. HTML entities/Unicode и большой список PR: безопасный текст, корректный лимит, один POST и полный отчёт без потери PR — Task 3/4.

---

## Карта файлов и порядок

| Файл                                                                              | Ответственность                                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `scripts/release/github.ts`, `github.test.ts`                                     | Общие REST/GraphQL запросы, чтение статусов Deployments                              |
| Новый `scripts/release/catalog.ts`, `catalog.test.ts`                             | Проверенные источники Deployments, Git-граф, состав выпусков и связанные issues      |
| Новый `scripts/release/board.ts`, `board.test.ts`                                 | Project preflight, ожидание закрытия, переходы карточек и повтор при свежей выкатке  |
| Новый `scripts/release/journal.ts`, `journal.test.ts`                             | Baseline и неизменяемые уведомления в `release-automation`, доставка без повторов    |
| `scripts/release/notify.ts`, `notify.test.ts`                                     | Один Telegram-транспорт, формат очереди/готовности/начала, прежние итоговые карточки |
| Новый `scripts/release/sync.ts`, `sync.test.ts`                                   | Допуск событий, подготовка полного отчёта и уведомлений, сбор результатов            |
| `scripts/release/index.ts`                                                        | CLI `sync`, `notify-pending`, расширение существующего `notify`                      |
| Новый `.github/workflows/release-status.yml`, `scripts/release/workflows.test.ts` | Триггеры, права, concurrency и связка двух шагов                                     |
| `.github/workflows/ci.yml`, `cd.yml`                                              | Перенос успешного сообщения и старт непосредственно перед Switch                     |
| `docs/release.md`                                                                 | Эксплуатация, статусы, первый запуск и восстановление журнала                        |
| `.github` repo: `CONTRIBUTING.md`                                                 | Уточнение жизненного цикла issue и карточки, отдельный короткий PR                   |

Tasks 1–5 — один связанный функциональный результат; отдельные планы для них не нужны.
Каждая задача ниже имеет собственную проверку и коммит. Документация и приёмка
в Task 6 завершают тот же результат. Тестовые fixtures держать рядом с тестами;
не добавлять универсальный test framework или production dependency injection.

## Task 1: Проверенный состав выпусков

**Files:** Modify `scripts/release/github.ts:52-115`, `github.test.ts`; Create `scripts/release/catalog.ts`, `catalog.test.ts`.

**Interfaces:**

- Consumes: существующие `Deployment<P>`, `ArtifactsPayload`, `ProductionPayload`, `listDeployments<P>(environment, sha?)`, `readyArtifacts(records, sha)`, `checkSha()`, `checkImageRef()`.
- Produces в `github.ts`: экспорт существующей `api<T>(path: string, init?: RequestInit): Promise<T>` без изменения вызовов; `graphql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T>`; `listDeploymentStatuses(id: number): Promise<DeploymentStatus[]>`, где `DeploymentStatus = { state: DeploymentState; createdAt: string; description: string }`.
- Produces в `catalog.ts`: следующие типы и функции; типы живут здесь, не в отдельном пакете.

```ts
interface MergedPR {
    number: number;
    url: string;
    mergeSha: string;
}
interface LinkedIssue {
    id: string;
    number: number;
    title: string;
    repo: string;
    prNumbers: number[];
}
interface PublishedRelease {
    id: number;
    sha: string;
    imageRef: string;
    ciRun: string;
    readyAt: string;
    prNumbers: number[];
}
interface ReleaseSnapshot {
    published: PublishedRelease[];
    deployed: Set<number>;
    deployedShas: string[];
    prs: Map<number, MergedPR>;
    issues: LinkedIssue[];
}
interface TrustedRun {
    id: number;
    kind: 'publish' | 'deploy' | 'rollback';
    sha: string;
    url: string;
}
declare function readTrustedRun(id: number): Promise<TrustedRun>;
declare function readReleaseSnapshot(repoDir: string): Promise<ReleaseSnapshot>;
declare function activationTime(repoDir: string): Promise<string>;
declare function isDeployed(
    sha: string,
    productionShas: readonly string[],
    repoDir: string,
): Promise<boolean>;
```

Вход в Task 1 включает подготовку существующего worktree, а не создание ещё одного:

- [ ] Проверить `AGENTS.md`, origin, ветку `web-101` и `git status`; сохранить существующие spec/plan, не reset их и не менять чужие worktrees.
- [ ] Выполнить `bun install --frozen-lockfile` в `/home/oleg/2026_H2/frontend-web-101` только после выбора execution method.
- [ ] Выполнить `bun run check` для исходной ревизии; ожидается exit 0.
- [ ] Выполнить `bun run test` для исходной ревизии; ожидается exit 0.
- [ ] Выполнить `bun run build` для исходной ревизии; ожидается exit 0. Исходный сбой зафиксировать до правок.
- [ ] Сохранить согласованные spec/plan обычным коммитом `docs: record release status design and implementation plan`, с проходящими hooks.

- [ ] **Step 1: Написать падающие тесты Git-графа и источников.**

Во временном repo с локально настроенными git author/email создать parent PR #1
и child #2, чьи merge-коммиты достижимы из `releaseSha`; отдельный merged #3
оставить в ветке вне выпуска. Mock API возвращает корректный выпуск для `releaseSha`,
закрывающие связи и соответствующий CI run. Никаких живых API или секретов.

```ts
test('выпуск включает вложенные merged PR по графу, а не base/main', async () => {
    const snapshot = await readReleaseSnapshot(dir);
    expect(snapshot.published[0]?.prNumbers).toEqual([1, 2]);
    expect(snapshot.published[0]?.prNumbers).not.toContain(3);
});
```

Добавить assertions для следующих вариантов fixtures:

- `230` Deployments/PR и >100 GraphQL edges читаются целиком, без Search API с лимитом выдачи.
- Запись `failure`/`in_progress` и merge_group candidate не входят в `published/deployed`.
- Один SHA с разными digest даёт `ReleaseError`; отсутствующий из `origin/main` SHA не принимается.
- `readTrustedRun()` принимает CI `push/main` и CD/Rollback `workflow_dispatch/main`, даже при `conclusion: failure`; не принимает чужие repo/head_repository, workflow ID/path и PR CI.
- Payload run URL проверяется по host/repo/path до извлечения числового ID; чужой URL не вызывает fetch на чужой host.
- Первое успешное время находится на второй странице statuses; повторы SHA объединяются по самой ранней успешной публикации.
- `isDeployed()` проверяет достижимость самого SHA: новый direct commit без новых PR не считается выкаченным лишь потому, что все его PR уже в deployed.
- `graphql()` бросает `ReleaseError` при HTTP 200 с `errors`; токен отсутствует в сообщении ошибки.
- `activationTime()` берёт коммит добавления файла по first-parent main, а не feature-коммит с более ранней датой; последующие правки файла не меняют результат.

- [ ] **Step 2: Подтвердить красные тесты.**

Run: `bun test scripts/release/github.test.ts scripts/release/catalog.test.ts`.
Expected: FAIL на отсутствующих экспортах/модуле; проверить, что причина не в синтаксисе fixtures.

- [ ] **Step 3: Реализовать интерфейсы и расчёт состава.**

Переиспользовать `api()`; GraphQL — стандартный `fetch`, `GITHUB_GRAPHQL_URL`
или штатный `https://api.github.com/graphql`, timeout `20_000`, проверка HTTP
и GraphQL errors. Токен передаётся явно; ответы с ошибкой не превращаются в пустой список.

Все страницы PR/Deployments/statuses/closingIssuesReferences читаются полностью.
PR list берётся из `state=closed`, затем фильтруется по наличию merge; `base=main`
не задавать. Для R получить `git rev-list R`, сопоставить mergeSha PR с этим
множеством. Не парсить commit message и не делать fetch произвольного SHA из PR.
Проверять достижимость R из полной истории `origin/main`.

Run ID сверяется с `.github/workflows/ci.yml`, `cd.yml`, `rollback.yml` и их
текущими workflow IDs через Actions API; URL из payload не передаётся в fetch.
Для CI требовать совпадение SHA записи и run; CD выбирает SHA из Deployment.
Проверить image ref/assets/action существующими проверками и точным контрактом.
`deployed` — объединение PR всех успешных production, не только последней записи.
`deployedShas` хранит SHA этих же валидных записей; `isDeployed()` проверяет,
достижим ли указанный SHA из хотя бы одного из них по Git-графу.
Связи issues берутся из closingIssuesReferences с дедупликацией по node ID;
окончательную актуальность закрытия и карточки проверяет Task 2.

- [ ] **Step 4: Подтвердить зелёные тесты и отсутствие регрессии rollback.**

Run: `bun test scripts/release/github.test.ts scripts/release/catalog.test.ts scripts/release/deployments.test.ts`.
Expected: 0 fail; существующие `Deployment<P>` fixtures не требуют новой обязательной metadata.

- [ ] **Step 5: Закоммитить.**

`git add scripts/release/github.ts scripts/release/github.test.ts scripts/release/catalog.ts scripts/release/catalog.test.ts`

`git commit -m "feat(release): determine published and deployed PRs from history"`

## Task 2: Переходы карточек и ожидание автоматики Done

**Files:** Create `scripts/release/board.ts`, `board.test.ts`.

**Interfaces:**

- Consumes: Task 1 `ReleaseSnapshot`, `LinkedIssue`, `readReleaseSnapshot(repoDir)`, `graphql(query, variables, token)`.
- Produces: `syncBoard(snapshot: ReleaseSnapshot, repoDir: string): Promise<BoardResult>`, где `BoardResult = { changed: number; skipped: number; errors: string[] }`.
- Внутреннее чтение issue возвращает её текущие closed/stateReason, последний ClosedEvent.closer, ReopenedEvent и карточку Status/updatedAt. Эти transport-типы остаются приватными.

- [ ] **Step 1: Написать падающие тесты переходов и гонок.**

Fixture snapshot содержит PR #1 — published без deploy, #2 — ранее deployed,
#3 — более новый published. Все три issues имеют нужный префикс и реальные
закрывающие связи; mock Project API фиксирует только фактические mutations.

```ts
test('первый запуск подхватывает опубликованное и сохраняет выкаченное', async () => {
    const result = await syncBoard(snapshot, dir);
    expect(result.errors).toEqual([]);
    expect(statusWrites).toEqual([{ issue: 1, status: 'Ready for release' }]);
});
```

Отдельно проверить `Ready for release → Done`, повтор без mutations,
старый deploy после нового и rollback без уменьшения `deployed`.
Добавить управляемые последовательности ответов:

- Issue ещё открыта → закрылась → Status стал `Done` после ClosedEvent → ровно одна запись `Ready for release`.
- До `Done` не дошло за `300_000` ms → ошибка и 0 mutations; в тестах заменить/восстановить `Date.now` и `Bun.sleep`, не ждать пять минут.
- Ручные `Ready for test`, `In testing`, `Ready for build` и остальные значения вне управляемых двух сохраняются.
- Issue была переоткрыта, в том числе непосредственно перед записью → 0 mutations.
- Production success появляется после первого снимка → после сверки итог `Done`; более новая задача остаётся `Ready for release`.
- Нет карточки, field/option или `viewerCanUpdate`, либо PAT получает 403 → ошибки с контекстом, без изменения других полей.
- Чужой repo/project/title, ручной closer и not planned → пропуск.

- [ ] **Step 2: Подтвердить красный тест.**

Run: `bun test scripts/release/board.test.ts`. Expected: FAIL из-за отсутствия `board.ts`.

- [ ] **Step 3: Реализовать `syncBoard()` по таблице спеки.**

Через PAT найти Scrumban `Cringe-Driven-Development-Team`, №1, проверить
`viewerCanUpdate` и `Status`. IDs проекта/поля/options получать из API по
согласованным именам, не копировать текущие IDs в код. Прочие поля не писать.
Репозиторные закрывающие события читать репозиторным токеном.

Перед `Done → Ready for release` подтвердить закрытие этим PR и
`Status.updatedAt >= ClosedEvent.createdAt`; ожидать максимум `300_000` ms.
Явное ReopenedEvent после мержа прекращает ожидание. Повторно читать issue/Status
перед mutation. Значения вне двух управляемых пропускать с причиной.
Закрытые подходящие задачи без карточки дают ошибку, не создаются автоматически.

Ошибку одной карточки накопить в `errors`, обработать остальные. Перед каждой
записью `Ready for release` перечитать production; после пакета перечитать
snapshot и повторить расчёт при новых успешных Deployments. Ограничить расчёт
тремя проходами; при непрекращающихся изменениях вернуть видимую ошибку.
Логи содержат SHA, PR, issue, исходный/целевой Status и причину пропуска.

- [ ] **Step 4: Подтвердить зелёные тесты.**

Run: `bun test scripts/release/catalog.test.ts scripts/release/board.test.ts`.
Expected: 0 fail; повтор не создаёт новых mutations, тесты возвращают глобальные mocks/env.

- [ ] **Step 5: Закоммитить.**

`git add scripts/release/board.ts scripts/release/board.test.ts`

`git commit -m "feat(release): reconcile Scrumban status with successful deployments"`

## Task 3: Общий Telegram-транспорт и журнал доставки

**Files:** Modify `scripts/release/notify.ts:137-234`, `notify.test.ts`; Create `scripts/release/journal.ts`, `journal.test.ts`.

**Interfaces:**

- Consumes: Task 1 `activationTime(repoDir)`, `api()`, `listDeployments()`, `listDeploymentStatuses()`; существующие `createDeployment()`, `setDeploymentState()`.
- Produces в `notify.ts`: `TelegramMessage = { text: string; keyboard?: { text: string; url: string }[][] }`; `sendTelegram(message: TelegramMessage): Promise<number>`; `TelegramRejectedError extends ReleaseError` для подтверждённого отказа без доставки. Прежний `notify(what, status, sha?): Promise<void>` сохраняет интерфейс и использует этот транспорт.
- Produces в `journal.ts`: `ensureBaseline(repoDir: string): Promise<string>`, `prepareNotice(notice: Notice): Promise<'created' | 'existing'>`, `sendPending(repoDir: string): Promise<DeliveryResult>`.

```ts
interface Notice {
    kind: 'queue' | 'ready';
    key: string;
    ref: string;
    source: string;
    message: TelegramMessage;
    prNumbers: number[];
    reportUrl: string | null;
}
interface DeliveryResult {
    sent: number;
    skipped: number;
    errors: string[];
}
```

В journal payload хранить kind/key/source/message/prNumbers/reportUrl; ref находится
в самой записи Deployment. Baseline имеет отдельный payload
`{ kind: 'baseline', key: 'baseline', activatedAt: string }`.

- [ ] **Step 1: Написать падающие тесты идемпотентности и неоднозначной доставки.**

Mock GitHub хранит записи/статусы в памяти; mock Telegram отвечает
`{ ok: true, result: { message_id: 7 } }`. `notice` имеет key `ready:<40-символьный SHA>`.

```ts
test('подтверждённое сообщение не пересылается при повторе', async () => {
    await prepareNotice(notice);
    await sendPending(dir);
    await prepareNotice(notice);
    await sendPending(dir);
    expect(telegramPosts).toHaveLength(1);
    expect(lastReceiptStatus).toMatchObject({
        state: 'success',
        description: 'telegram_message_id=7',
    });
});
```

Добавить тесты: pending → in_progress → success; missing status после создания
считается ещё не отправленным; timeout/обрыв/невалидный ответ Telegram и отказ
записи success оставляют неоднозначный in_progress и не делают второй POST.
Подтверждённое `ok: false` с корректным 4xx даёт повторяемый pending и красный результат;
5xx считается неоднозначным. Ошибка записи in_progress вообще не вызывает Telegram.
Одно неоднозначное уведомление не мешает попыткам доставить другие.
Если ready receipt ещё pending, а его ref уже достижим из свежей успешной
production, sendPending(dir) пишет `inactive` с причиной `already_deployed`,
не вызывает Telegram и увеличивает skipped. Повтор inactive ничего не отправляет;
queue receipts этой проверкой не подавляются. Проверить и новый direct commit
без новых PR: до реальной выкатки его сообщение не подавляется.
Повтор baseline возвращает прежнюю границу; его записи не отправляются и не
попадают в существующие release/rollback/retention.

Обновить старый fixture `notify.test.ts` реальной формой Telegram response;
проверить прежние SHA/digest, HTML escaping, topic/keyboard и отсутствие token URL в ошибке.

- [ ] **Step 2: Подтвердить красные тесты.**

Run: `bun test scripts/release/journal.test.ts scripts/release/notify.test.ts`.
Expected: FAIL на новых интерфейсах; существующий формат итоговой карточки сохранён тестом.

- [ ] **Step 3: Реализовать транспорт и журнал.**

Вынести существующий fetch sendMessage в `sendTelegram()`, не создавать второй
транспорт. Проверять HTTP, `ok === true` и положительный целочисленный message_id;
параметры bot/chat/topic, HTML, отключение preview и timeout `20_000` сохранить.
В неоднозначной ошибке не утверждать, что сообщение не доставлено.

Журнал — только `release-automation`, `production_environment: false`,
`auto_inactive: false`. Baseline берёт время Task 1, а не часы первого запуска.
`prepareNotice()` не перезаписывает существующий payload. Если одинаковый key
имеет противоречивые записи/состояния, вернуть ошибку вместо угадывания.
`sendPending(repoDir)` обрабатывает все queue/ready receipts. Для pending ready
заново получает валидную production-историю через Task 1 и вызывает isDeployed();
уже выкаченный ref погашает через inactive. Неоднозначный in_progress этим путём
не разрешать: сначала нужна проверка возможной прошлой доставки.
Для остальных пишет in_progress перед POST и success после подтверждения.
Подтверждённый отказ возвращает pending;
timeout/неизвестный исход сохраняет in_progress и сообщает инструкции ручной проверки.
Результат ошибки success mutation не сбрасывать в pending.

- [ ] **Step 4: Подтвердить зелёные тесты и сохранность прежних сообщений.**

Run: `bun test scripts/release/journal.test.ts scripts/release/notify.test.ts scripts/release/deployments.test.ts`.
Expected: 0 fail; повтор неоднозначного сообщения увеличивает ошибки, но не telegramPosts.

- [ ] **Step 5: Закоммитить.**

`git add scripts/release/notify.ts scripts/release/notify.test.ts scripts/release/journal.ts scripts/release/journal.test.ts`

`git commit -m "feat(release): journal Telegram deliveries without duplicate retries"`

## Task 4: Подготовка отчёта, очереди и сообщений готовности

**Files:** Create `scripts/release/sync.ts`, `sync.test.ts`; Modify `notify.ts`, `notify.test.ts`, `index.ts:33-91`.

**Interfaces:**

- Consumes: Task 1 `readTrustedRun()`, `readReleaseSnapshot()`, `isDeployed()`, Task 2 `syncBoard()`, Task 3 `ensureBaseline()`, `prepareNotice()`, `sendPending(repoDir)`, `Notice`, `TelegramMessage`.
- Produces в `notify.ts`: `readyMessage(release: PublishedRelease, prs: readonly MergedPR[], reportUrl: string): TelegramMessage`; `queueMessage(pr: Pick<MergedPR, 'number' | 'url'>): TelegramMessage`.
- Produces в `sync.ts`: `prepareAutomation(repoDir: string): Promise<SyncResult>`, где `SyncResult = { allowed: boolean; board: BoardResult | null; prepared: number; errors: string[] }`.
- CLI `bun run release sync`: читает event/env, пишет output `allowed=true/false`, возвращает ненулевой код при errors после попыток независимых частей. `bun run release notify-pending`: вызывает sendPending(process.cwd()) и падает при его errors. Оба используют существующий ReleaseError catch в index.ts.

- [ ] **Step 1: Написать падающие тесты допуска и накопившихся PR.**

В test fixture задать baseline T, успешный исторический выпуск до T с PR #1,
новый выпуск B после T с PR #1/#2/#3 и без промежуточного выпуска для #2.
У `GITHUB_STEP_SUMMARY` и `GITHUB_OUTPUT` временные файлы; Actions API замокан.

```ts
test('новый выпуск перечисляет PR пропущенной публикации', async () => {
    const result = await prepareAutomation(dir);
    expect(result.allowed).toBe(true);
    expect(readyReceipt.prNumbers).toEqual([2, 3]);
    expect(summaryText).toContain('/pull/2');
    expect(summaryText).toContain('/pull/3');
    expect(telegramPosts).toHaveLength(0); // отправка — следующим шагом
});
```

Дополнительные assertions:

- На первом run старые карточки изменяются, старые сообщения не создаются; событие в точности в T уведомляется.
- Два first-success времени равны → порядок по Deployment ID; повтор сохраняет исходные PR/text/reportUrl.
- Запоздавший SHA уже входил в success production → готовое сообщение подавлено с явным логом; использовать isDeployed(), а не сравнение только PR numbers.
- Два AddedToMergeQueueEvent одного PR дают два ключа, повтор — ни одного нового; события другого PR и уже merged PR тоже подхватываются.
- Ивент другой mergeQueue/main, старое enqueue, merge_group и bypass без enqueue не создают queue receipt.
- `workflow_run` PR/fork/неверный workflow, dispatch не из main → allowed false и 0 mutations.
- API/board error не скрывает готовность: receipts и summary подготовлены, errors непустой; реальная отправка остаётся отдельной командой.
- В готовом сообщении есть полный SHA, digest, PR-ссылки и «Выкатить»; в очереди — только номер/ссылка, без позиции.
- HTML entities/Unicode при границе 4096 считаются по видимому тексту; переполнение даёт один краткий message с количеством/«Все PR выпуска», а summary содержит каждый PR.

- [ ] **Step 2: Подтвердить красные тесты.**

Run: `bun test scripts/release/sync.test.ts scripts/release/notify.test.ts`.
Expected: FAIL на новых функциях/командах.

- [ ] **Step 3: Реализовать подготовку и форматирование.**

Допуск: fixed repository, main, разрешённые три типа событий и проверенный
исходный run из Task 1. Неподходящие события — allowed false без записи;
подделанные/некорректные ожидаемые данные — явная ошибка. Для workflow_run
читать полный run по ID, не доверять одному имени из event payload.

После допуска создать/прочитать baseline. Каждый run читает всю историю
выпусков и все PR с updatedAt >= T, включая closed/merged; connections timeline
пагинируются. Сравнить `AddedToMergeQueueEvent.mergeQueue.id` с
`repository.mergeQueue(branch: "main").id`. Для свежего enqueued payload,
чьё событие ещё не видно, ограниченно перечитать timeline; таймаут — ошибка.
Выпуски обходить по `(readyAt, id)`, вычитая PR всех более ранних успешных
публикаций, включая исторические. Receipt key — `ready:<sha>` или `queue:<event.id>`.

Подготовить полный Markdown summary с PR-ссылками до создания готового receipt;
report URL — `${runUrl()}#summary`. Для уже существующего receipt сохранять
исходные данные. `readyMessage()` использует все PR, если текст помещается,
иначе согласованное количество/ссылку. Старые ready сообщения, enqueue до T
и уже выкаченный запоздавший SHA пропускать с причиной.

`syncBoard()` и подготовку уведомлений выполнить независимо, собрать ошибки
обоих. Для отправки в этом методе не вызывать Telegram. Добавить две команды
в index.ts/USAGE с output allowed, чтобы Task 5 мог безопасно запустить второй
шаг даже после ошибки доски. Приватные функции без отдельного класса/registry.

- [ ] **Step 4: Подтвердить зелёные тесты и CLI без живых API.**

Run: `bun test scripts/release/sync.test.ts scripts/release/notify.test.ts scripts/release/journal.test.ts scripts/release/board.test.ts`.
В sync.test.ts один subprocess smoke запускает обе CLI-команды с локальным
`Bun.serve`, временным Git repo/event/summary/output и тестовыми токенами;
`GITHUB_API_URL`, `GITHUB_GRAPHQL_URL`, `TELEGRAM_API` указывают только на localhost.
Expected: после sync 0 Telegram POST, после notify-pending один POST; повтор 0 новых POST.

- [ ] **Step 5: Закоммитить.**

`git add scripts/release/sync.ts scripts/release/sync.test.ts scripts/release/notify.ts scripts/release/notify.test.ts scripts/release/index.ts`

`git commit -m "feat(release): prepare release reports and queued PR notifications"`

## Task 5: Подключение workflow и стартового уведомления CD

**Files:** Create `.github/workflows/release-status.yml`, `scripts/release/workflows.test.ts`; Modify `.github/workflows/ci.yml:114-124`, `cd.yml:95-105`, `scripts/release/notify.ts`, `notify.test.ts`, `index.ts` USAGE.

**Interfaces:**

- Consumes: Task 4 команды `sync`, `notify-pending`, output `allowed`.
- Produces: workflow `Release status`; команда `bun run release notify Начало success "$SHA"` через прежний notify() с новым вариантом what, не отдельный транспорт.

- [ ] **Step 1: Написать падающие проверки YAML и начала выкатки.**

YAML читать штатным `Bun.YAML.parse`, без установки parser dependency. Проверки
связать с безопасностью/наблюдаемым порядком шагов, не с форматированием YAML.

```ts
test('CD сообщает о начале непосредственно перед Switch BFF', async () => {
    const cd = Bun.YAML.parse(await Bun.file('.github/workflows/cd.yml').text());
    const steps = cd.jobs.cd.steps;
    const at = steps.findIndex((step) => step.id === 'switch');
    expect(steps[at - 1].run).toBe('bun run release notify Начало success "$SHA"');
    expect(steps[at - 1]['continue-on-error']).toBe(true);
    expect(steps[at - 1].if).toBeUndefined(); // обычное success(), а не always()
});
```

В TypeScript теста сузить unknown результата Bun.YAML.parse локальным типом.
Проверить workflow_run completed CI/CD/Rollback, enqueued main, dispatch main,
общую concurrency без отмены, checkout main/depth 0/без persisted credentials,
отсутствие production environment и S3/SSH secrets, точные permissions.
Второй шаг должен иметь `always()` и `steps.sync.outputs.allowed == 'true'`,
не запускаться после провала проверки доверия. Успешное publish-сообщение из CI
не отправляется; error/cancelled сообщение сохраняется. Итог CD сохраняет always().

В notify.test.ts вызвать notify('Начало', 'success', sha): ожидать ровно один
POST с «Выкатка релиза <SHA> началась», full SHA, triggering actor при rerun,
fallback actor и ссылкой на текущий run. Никакого compare API для старта.

- [ ] **Step 2: Подтвердить красные тесты.**

Run: `bun test scripts/release/workflows.test.ts scripts/release/notify.test.ts`.
Expected: FAIL на отсутствующем workflow/стартовом шаге.

- [ ] **Step 3: Подключить workflow и уведомления.**

Новый workflow использует actions/checkout@v5, oven-sh/setup-bun@v2 с bun 1.4.4,
`bun install --frozen-lockfile` из main и один job без production environment.
Группа concurrency `release-automation`, cancel-in-progress false. Ограничить
репозиторием и существующим `PRODUCTION_ENABLED == 'true'`, допуск события
проверяет Task 4 до mutations. Env берёт GITHUB_TOKEN, ADD_TO_PROJECT_PAT и
прежние Telegram bot/chat/topic/user map bindings.

Шаг `id: sync` запускает `bun run release sync`. Следующий отдельный шаг
запускает notify-pending с `if: always() && steps.sync.outputs.allowed == 'true'`.
Не ставить continue-on-error для синхронизации/доставки: её ошибки видны красным.
Оба шага работают после checkout/setup; неподготовленный runner не посылает ничего.

В CI изменить условие прежнего Send to tg на `failure() || cancelled()`:
новое ready-сообщение теперь только из синхронизации. В CD добавить обычный
success-only шаг непосредственно перед Switch; его Telegram-сбой не блокирует
Switch. Реализовать вариант Начало в notify(), с актором
`GITHUB_TRIGGERING_ACTOR || GITHUB_ACTOR`; сохранить прежние завершение и rollback.

- [ ] **Step 4: Подтвердить целевые проверки и общий baseline.**

Run: `bun test scripts/release`; затем `bun run check`; затем `bun run test`;
затем `bun run build`. Expected: каждый exit 0; нет пропавших старых release-тестов.
Если обнаружена исходная проблема main, отделить её от изменений и сообщить,
не обходить hooks/проверки ради коммита.

- [ ] **Step 5: Закоммитить.**

`git add .github/workflows/release-status.yml .github/workflows/ci.yml .github/workflows/cd.yml scripts/release/workflows.test.ts scripts/release/notify.ts scripts/release/notify.test.ts scripts/release/index.ts`

`git commit -m "feat(release): automate board synchronization and deployment start alerts"`

## Task 6: Документация, PR и интеграционная приёмка

**Files:** Modify frontend `docs/release.md` и `.github` repo `CONTRIBUTING.md` в разделе «Как закрыть → Через pull request». Спека/план входят в frontend PR.

**Interfaces:** Consumes результат Tasks 1–5. Produces два reviewable PR с правильными связями и протокол приёмки с реальными ссылками.

- [ ] **Step 1: Дополнить frontend runbook.**

В docs/release.md описать три ручных этапа, закрытую issue и управляемые
Ready for release/Done, источник Deployments, первый запуск, общий concurrency,
четыре сообщения, переполнение Telegram и отдельный красный Release status.
Добавить команды повтора `gh workflow run release-status.yml --ref main`
и инструкции pending/in_progress/success с проверкой соответствующей темы Telegram.
Ручное восстановление выполняется существующим Deployment Status API: если
сообщение найдено — success с message_id, если достоверно не отправлено — pending
и повтор. Никогда не советовать без проверки сбрасывать in_progress.

- [ ] **Step 2: Подготовить короткую правку CONTRIBUTING.**

Клон организации уже есть в `/home/oleg/2026_H2/.github`, но его main отставал
на 88 коммитов при проверке. Перед правкой fetch и отдельная рабочая ветка
от актуального origin/main, не reset чужого checkout. Изменить только абзац:
issue закрывается при мерже, а карточка frontend/BFF затем отражает проверенный
выпуск (`Ready for release`) и успешную выкатку (`Done`). Первые три новых
этапа доступны вручную; старые правила других областей не менять.
Специальный тест на две строки документации не нужен; проверить diff и ссылки.

- [ ] **Step 3: Проверить и закоммитить документы.**

Run во frontend: `bun run fmt:check` и `git diff --check`. Expected: exit 0.
Коммит frontend: `docs(release): explain release status lifecycle and recovery`.
Коммит в .github: `docs: clarify frontend issue and release status lifecycle`.
Сохранить спеку и план в истории обычным коммитом с проходящими hooks,
если они ещё не закоммичены; отдельную зависимость для этого не добавлять.

- [ ] **Step 4: Выполнить ревью выбранным способом и подготовить PR.**

Следовать полностью выбранному execution skill: в subagent-driven — отдельный
исполнитель и ревьюер каждой задачи; в executing-plans — его журнал и финальное
ревью. Конкретный способ ещё не выбран; реализацию до выбора не начинать.
После всех изменений повторить check/test/build, только если они менялись
после последнего успешного полного прогона либо остаются нерешённые замечания.

Сначала PR в `.github` с точной строкой
`Part of https://github.com/Cringe-Driven-Development-Team/frontend/issues/101`.
Затем frontend PR `WEB-101: Переводить задачи в Ready for release после публикации релиза`
с `Closes #101`, ссылкой на документационный PR и локальными результатами.
Порядок мержа: документационный PR первым, frontend последним. Создание PR не
означает поручение немедленно влить их; при поручении мержа действуют инструкции
пользователя о bypass, актуальном head, CI и post-merge проверках.

- [ ] **Step 5: Зафиксировать доступную живую приёмку после появления workflow в main.**

До мержа локальные mocks/YAML-тесты не заменяют события default branch.
В PR явно разделить уже выполненные локальные проверки и pending live acceptance.
После согласованного мержа/доступного реального выпуска выполнить:

1. Run workflow_dispatch: записать исходные и итоговые Status, baseline и отсутствие исторической рассылки; подтвердить mutation именно через ADD_TO_PROJECT_PAT.
2. Два согласованных рабочих PR поставить в очередь: два сообщения; повтор merge_group не дублирует; dequeue/re-enqueue даёт новое событие. Не создавать фиктивные рабочие задачи и не сливать их только ради теста.
3. У готового выпуска с несколькими PR проверить success release-artifacts, полный состав сообщения/отчёта и Ready for release у включённых issues. Пропущенную промежуточную публикацию и опасные отказы обязательно покрывают локальные тесты; прод ради них не ломать.
4. При порученной выкатке выбранного SHA проверить старт непосредственно перед Switch, итог и production success; карточки его состава стали Done, более новые остались Ready for release.
5. Повторить только синхронизацию: нет новых status writes/сообщений. Не запускать дополнительный CD/rollback ради теста без отдельного поручения.

Приложить ссылки на PR/issues, Actions runs, Deployments и до/после карточек.
Если живой этап ещё недоступен, назвать конкретный оставшийся пункт, а не
объявлять всю задачу принятой по mock-тестам. Не закрывать issue вручную.

## Самопроверка плана

- Покрытие спеки: состав/источники — Task 1; таблица/гонки/первый запуск — Task 2;
  журнал/неоднозначная доставка — Task 3; очередь/готовность/полный отчёт/baseline — Task 4;
  события/permissions/start/final — Task 5; оба runbook/PR/живые доказательства — Task 6.
- Каждый кодовый task содержит красный тест, команду его проверки, реализацию
  точных интерфейсов, зелёную проверку и коммит. Task 6 — эксплуатация и документы.
- Типы/имена используются из Interfaces задач-поставщиков; существующие
  Deployment/Payload и notify() не ломаются. Новые обязательные поля в старые fixtures не добавляются.
- Все пять Review Focus закреплены тестами в указанных задачах.
- Основной объём — решения, интерфейсы и проверки; тела production-функций
  оставлены исполнителю. Новых самостоятельных подсистем вне #101 нет.

## Перед реализацией

План нужно прочитать и выбрать один способ: `superpowers:executing-plans`
или `superpowers:subagent-driven-development`. Исследование несколькими агентами
в предыдущем этапе не является выбором способа реализации этого плана.

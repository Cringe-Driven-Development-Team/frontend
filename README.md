# 2026_2_Cringe_Driven_Development

Frontend-репозиторий проекта «Colab» команды «Cringe Driven Development»

<picture>
<source media="(max-width: 600px)" srcset=".github/assets/dance.gif 1.2x">
<source srcset=".github/assets/dance.gif 0.75x">
<img src=".github/assets/dance.gif" alt="" align="right">
</picture>

### Ссылки

[![Сервис cellestial.ru](https://img.shields.io/badge/cellestial.ru-7A5AF8?style=for-the-badge&logo=googlechrome&logoColor=white)](https://cellestial.ru)
[![Доска задач](https://img.shields.io/badge/Доска_задач-1F6FEB?style=for-the-badge&logo=github&logoColor=white)](https://github.com/orgs/Cringe-Driven-Development-Team/projects/1)
[![Макеты в Figma](https://img.shields.io/badge/Макеты-F24E1E?style=for-the-badge&logo=figma&logoColor=white)](https://www.figma.com/design/7iaVDGiwzQk2vZIB5ogVlq/Colab)
[![Сайт документации](https://img.shields.io/badge/Документация-5C73E7?style=for-the-badge&logo=vitepress&logoColor=white)](https://cringe-driven-development-team.github.io/docs/)
[![Репозиторий бэкенда](https://img.shields.io/badge/Бэкенд-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://github.com/Cringe-Driven-Development-Team/backend)
[![Организация команды](https://img.shields.io/badge/Организация-24292E?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Cringe-Driven-Development-Team)

### Участники команды

1. [Ерофей Гаранин](https://github.com/ManInTheCoat)
2. [Истратов Денис](https://github.com/iRedTea)
3. [Шпакова Дарья](https://github.com/GrayMouse9)
4. [Кунев Валентин](https://github.com/MrDuckVC)

### Менторы

- [Михалёв Ярослав](https://github.com/YarikMix) — _Frontend_
- [Батовкин Александр](https://github.com/blackHATred) — _Backend_
- [Ченцова Дарья](https://t.me/dewon_d) — _UX_

## Как работать с задачами

Код, PR и задачи ведём в
[Cringe-Driven-Development-Team/frontend](https://github.com/Cringe-Driven-Development-Team/frontend)
и на общей [доске](https://github.com/orgs/Cringe-Driven-Development-Team/projects/1) вместе с бэковыми

1. **Завести задачу** в репозитории `frontend`. Как завести и что писать в описании —
   в [гайдлайне организации](https://github.com/Cringe-Driven-Development-Team/.github/blob/main/CONTRIBUTING.md#как-завести)

2. **Взять задачу.** На доске выбрать карточку из `Ready`, поставить себя
   в `Assignees`, перевести в `In progress`

3. **Создать ветку.** Открыть задачу → в правой колонке `Development` →
   **`Create a branch`**. В `Repository destination` выбрать
   `Cringe-Driven-Development-Team/frontend`,
   имя ветки заменить на `web-<номер задачи>`, например `web-12`.
   Затем `Create branch` и локально:

   ```bash
   git fetch
   git switch web-12
   ```

4. **Закоммитить** по шаблону `<тип>: <описание>`, типы — в таблице ниже.
   Область в скобках после типа указывать необязательно:

   ```
   feat: добавить форму входа
   fix: не сбрасывать фокус при ошибке валидации
   refactor(editor): вынести подсветку синтаксиса в отдельный модуль
   ```

5. **Открыть pull request** в `main`, когда код готов к ревью.
   Заголовок — по шаблону `WEB-<номер задачи>: <название задачи>`, например
   `WEB-12: Форма входа`. В описании — **обязательно** строка

   ```
   Closes #12
   ```

   Что писать, если задача затрагивает ещё один репозиторий, —
   в [гайдлайне](https://github.com/Cringe-Driven-Development-Team/.github/blob/main/CONTRIBUTING.md#как-закрыть).
   Убедиться, что в правой колонке PR в блоке `Development` указана задача

6. **Получить апрув** от [Ярослава](https://t.me/Yaroslav738)

7. **Влить в `main`** через `Merge pull request`.
   Задача закроется сама, карточка уедет в `Done`

> [!TIP]
> Ветку, созданную руками (`git switch -c web-12 origin/main`), с задачей свяжет
> та же строка `Closes …` — поэтому она обязательна всегда

## Рабочий репозиторий и синхронизация

Разработка и ревью ментора проходят в командном репозитории.
[Учебный репозиторий](https://github.com/frontend-park-mail-ru/2026_2_Cringe_Driven_Development)
получает копию main с теми же коммитами; его Actions выключены настройкой GitHub.
Новые PR и ревью туда не копируются.

Синхронизация включается переменной `COURSE_SYNC_ENABLED=true` после Check,
независимо от Upload release. Повторить её без выкатки: Actions → Sync to course,
ветка main, `ci_run_id` успешного push/main CI. Произвольный SHA не принимается.
Upload release, CD и Rollback доступны только в командном репозитории из main
при `PRODUCTION_ENABLED=true`. Отсутствующий flag означает выключенную операцию.
Порядок первого включения и отката — в
[runbook организации](https://github.com/Cringe-Driven-Development-Team/.github/blob/main/docs/migrations/team-repositories-runbook.md).

### Переключение 18 октября 2026

История разработки перенесена через [PR #59](https://github.com/Cringe-Driven-Development-Team/frontend/pull/59)
с ревью ментора. После импорта задачи, связи и поля общей доски сверены с резервным
снимком: изменений нет. Первая синхронизация подтвердила одинаковые SHA main
и дерево файлов в командном и учебном репозиториях.

В существующем клоне переключить основной remote и проверить адрес перед push:

```bash
git remote set-url origin https://github.com/Cringe-Driven-Development-Team/frontend.git
git fetch origin
git remote -v
```

Релизы загружает CI командного репозитория. Для выкатки выбрать его Actions → CD
и указать полный SHA успешно загруженного релиза. Перед переключением stable CD
проверит релиз; затем выполнит health check. Предыдущий stable остаётся доступен
для штатного Rollback. Учебный репозиторий не запускает upload, CD или Rollback.

## Монорепа

Репозиторий — монорепа на bun workspaces и [Turborepo](https://turborepo.com)

| Каталог | Пакет | Что внутри |
|---|---|---|
| `apps/client` | `@cdd/client` | клиент: Vite, `src/`, `index.html` |
| `apps/bff` | `@cdd/bff` | BFF, пока пустой — [frontend#2](https://github.com/Cringe-Driven-Development-Team/frontend/issues/2) |
| `packages/schemas` | `@cdd/schemas` | zod-схемы операций Go, пока пустой — их сгенерирует Orval |

В корне остаются общее: `spec/` с контрактом, `scripts/` (выгрузка из Apidog и выкатка), конфиги
`oxlint` и `oxfmt`, `.env` — его читают и клиент, и скрипты

Все команды запускаются из корня, зависимости ставит один `bun install`

| Команда | Что делает |
|---|---|
| `bun run dev` | dev-сервер клиента, `/api/v1` проксируется на бэкенд |
| `bun run build` | сборка всех пакетов, клиент — в `apps/client/dist` |
| `bun run check` | `oxfmt --check`, `oxlint` и `tsc` во всех пакетах и в `scripts/` |
| `bun run lint`, `bun run typecheck`, `bun run test` | по отдельности, тоже во всех пакетах |

`build`, `lint`, `typecheck` и `test` идут через `turbo run`: пакет собирается после своих
зависимостей, а повторный запуск без изменений берёт результат из кеша `.turbo/`
(`>>> FULL TURBO` в выводе). Команду в одном пакете —
`bun run --filter @cdd/client <скрипт>`

## Контракт API

Контракт ведётся в [Apidog](https://app.apidog.com/project/1382426), в репозитории лежит его копия
`spec/openapi.json` и сгенерированные по ней типы клиента `apps/client/src/api/schema.ts`. Оба файла коммитятся
и руками не правятся

| Команда | Что делает |
|---|---|
| `bun run sync` | всё сразу: выгрузка из Apidog и генерация типов |
| `bun run apidog` | выгружает спеку в `spec/openapi.json` |
| `bun run generate` | генерирует `apps/client/src/api/schema.ts` из `spec/openapi.json` |

Для выгрузки нужен личный токен Apidog (`Account Settings` → `API Access Token`) в `.env`:

```sh
APIDOG_TOKEN=...
# ID sprint-ветки (серое число в Manage Sprint Branches). Пусто — ветка main
APIDOG_BRANCH_ID=
```

## Документация кода

Экспортируемый код документируется JSDoc: функции, компоненты, хуки, классы, константы, типы и
интерфейсы. Это проверяет линт — экспорт без комментария `/** … */` не проходит `bun run check`

Типы в тегах не пишутся — их несёт сигнатура TypeScript. В `@param` и `@returns` только описание

```ts
/**
 * Форма слова для числа: 1 блокнот, 2 блокнота, 5 блокнотов.
 * @param count число
 * @param one форма для 1, 21, 31…
 * @returns число и слово через пробел
 */
```

| Правило | Что требует |
|---|---|
| `cdd/require-jsdoc` | JSDoc у каждого экспортируемого объявления и у публичных методов экспортируемого класса. Реэкспорт (`export { a } from './a'`) не считается; у перегрузок комментарий несёт первая сигнатура |
| `cdd/check-param-names` | имена в `@param` совпадают с параметрами функции и идут в том же порядке |

Оба правила — командный плагин
[`@iredtea/oxlint-plugin-jsdoc`](https://github.com/Cringe-Driven-Development-Team/oxlint-plugin-jsdoc):
в `oxlint` правил `require-jsdoc` и `check-param-names` нет. Сами теги линт не требует: `@param` и `@returns` пишутся там, где описание что-то добавляет
к имени и типу. Сгенерированный `apps/client/src/api/schema.ts` линт не проверяет

## Выкатка

Клиент собирается в CI и заливается в S3 неизменяемыми релизами. Заливка автоматическая, выкатка
на cellestial.ru — по кнопке: человек выбирает, какой из залитых релизов и когда сделать текущим.
Откат — смена указателя. Шаги — команды скрипта `scripts/release/` (TypeScript под `bun`):
`bun run release <команда>`

| Workflow | Когда | Что делает |
|---|---|---|
| `CI` | pull request и push в `main` | `bun run check` и `bun run build`; на push в `main` — ещё сборка с `base` на CDN → `releases/{sha}/` → Release check → сообщение в Telegram «релиз залит» с кнопкой «Выкатить». Пользователи релиз не видят |
| `CD` | вручную из `main`, вход `sha` (пусто — голова `main`) | релиз есть в бакете → Release check → `index.html` и `current.json` → Health check → в S3 остаются 5 релизов → сообщение в Telegram |
| `Rollback` | вручную: `Actions` → `Rollback` → `Run workflow` из `main` | Release check релиза `previous` → возвращает его, `stable` и `previous` меняются местами → Health check → сообщение в Telegram |

Сообщения о релизах приходят в топик из переменной репозитория `TELEGRAM_RELEASES_TOPIC_ID`
(Frontend / Releases). Если она не задана или пустая, параметр `message_thread_id`
не передаётся, сообщение идёт без указания топика.

В строке “Запустил” инициатор упоминается в Telegram по переменной `TELEGRAM_USER_MAP`
репозитория — JSON-карте GitHub-логинов на Telegram ID. Если соответствия нет или карта
некорректна, показывается обычный GitHub-логин.

Выкатить релиз: `Actions` → `CD` → `Run workflow` из `main`, в поле `sha` — полный sha коммита
(он есть в сообщении о заливке), либо `gh workflow run cd.yml -f sha=<sha>`

В бакете: `releases/{sha}/` — сборка, корневой `index.html` — копия `index.html` текущего релиза,
`current.json` — `{ "stable": "{sha}", "previous": "{sha}" }`

`CD` выкатывает только вперёд по истории `main`: текущий `stable` должен быть предком `sha`, иначе
`release promote` падает и ничего не меняет. Выкати `CD` релиз старше `stable` — в `previous`
оказался бы более новый релиз, и `Rollback` «откатил» бы вперёд. Повторная выкатка того же `sha`
проходит. Назад — только `Rollback`: он возвращает `previous`, на один шаг; повторный `Rollback`
возвращает откаченный релиз обратно

`CD` падает на шаге `Release exists`, если релиза `sha` в бакете нет: в S3 хранятся 5 последних
релизов (плюс `stable` и `previous`), а между выкатками их может залиться больше; не залит и
коммит, чей запуск `CI` вытеснили более новые push. Перезалить — открыть запуск `CI` этого
коммита в `main` и нажать `Re-run all jobs`

Релиз проверяется до переключения:

- **Release check** — `index.html` релиза и чанк из него отдаются с CDN, чанк — с заголовком CORS.
  Выполняется после заливки и ещё раз перед выкаткой. Не прошёл — указатель не меняется, на сайте
  прежний релиз
- **Health check** — после переключения `https://cellestial.ru/` отдаёт `<meta name="release">`
  нового релиза, ожидание до 3 минут. Не прошёл — job красный, отката нет: релиз уже проверен,
  сломана отдача через Caddy или кэш бакета, смотреть нужно их

### Очередь выкатки

Указатель релиза меняет кто-то один: `CD` и `Rollback` стоят в общей группе `concurrency`.
Очереди в группе нет — она держит один идущий запуск и один ожидающий, более новый ожидающий
вытесняет прежнего. Вытесненный запуск отмечен в `Actions` как `cancelled`, сообщения в Telegram
от него нет — job не стартовал. Релиз при этом остаётся в бакете: нужен — запустить `CD` с тем же
`sha` ещё раз

Выкатка и откат работают в environment `production` (`Settings` → `Environments`), доступном
только из `main`:

| Что | Имя | Откуда (`pulumi stack output` в `infra`) |
|---|---|---|
| секрет | `S3_ACCESS_KEY` | `s3AccessKey --show-secrets` |
| секрет | `S3_SECRET_KEY` | `s3SecretKey --show-secrets` |
| переменная | `S3_ENDPOINT` | `s3Endpoint` |
| переменная | `S3_BUCKET` | `s3Bucket` |
| переменная | `CDN_URL` | `cdnCustomDomain` |

> [!WARNING]
> Ключ S3 действует на весь проект Selectel, а не только на бакет релизов: ограничение
> environment веткой `main` снимать нельзя

## Типы коммитов

> [!NOTE]
> Коммиты ветки попадают в `main` как есть, поэтому от их качества зависит
> читаемость истории проекта. Сверху добавляется merge-коммит с названием
> pull request


| Тип | Когда используется |
|---|---|
| `feat` | новая функциональность |
| `fix` | исправление бага |
| `refactor` | код переписан, поведение не изменилось |
| `style` | форматирование и отступы, логика не тронута |
| `test` | тесты |
| `docs` | документация |
| `chore` | конфиги, зависимости, сборка, CI |

## Статусы на доске

| Статус | Что означает |
|---|---|
| `Backlog` | задача заведена, но не запланирована в спринт |
| `Ready` | взята в спринт, можно брать в работу |
| `In progress` | в работе |
| `In review` | открыт pull request, ждёт ревью |
| `Done` | влито в `main` |

Статусы доска двигает сама по событиям в pull request. Руками нужно только взять задачу в работу — остальное происходит автоматически

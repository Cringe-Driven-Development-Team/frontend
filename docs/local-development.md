# Локальная разработка фронтенда

Нужен Bun версии не ниже 1.4.0. Команды запускаются из корня репозитория. `bun run dev` —
клиент и BFF сразу ([«Клиент через BFF»](#клиент-через-bff)).

```bash
bun install
bun run dev
bun run check
bun run build
```

## Монорепа

Репозиторий — монорепа на bun workspaces и [Turborepo](https://turborepo.com)

| Каталог            | Пакет          | Что внутри                                                                                |
| ------------------ | -------------- | ----------------------------------------------------------------------------------------- |
| `apps/client`      | `@cdd/client`  | клиент: Vite, `src/`, `index.html`                                                        |
| `apps/bff`         | `@cdd/bff`     | BFF: Hono + tRPC под Bun, сессия в cookie, пользователь в первом HTML — раздел «BFF» ниже |
| `packages/schemas` | `@cdd/schemas` | zod-схемы операций Go, генерирует Orval (`bun run orval`)                                 |

В корне остаются общее: `spec/` с контрактом, `scripts/` (выгрузка из Apidog и выкатка), конфиги
`oxlint` и `oxfmt`, `.env` — его читают и клиент, и скрипты

Все команды запускаются из корня, зависимости ставит один `bun install`

| Команда                                             | Что делает                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `bun run dev`                                       | клиент и BFF на `https://localhost:5173` — «Клиент через BFF»    |
| `bun run build`                                     | сборка всех пакетов, клиент — в `apps/client/dist`               |
| `bun run check`                                     | `oxfmt --check`, `oxlint` и `tsc` во всех пакетах и в `scripts/` |
| `bun run lint`, `bun run typecheck`, `bun run test` | по отдельности, тоже во всех пакетах                             |

`build`, `lint`, `typecheck` и `test` идут через `turbo run`: пакет собирается после своих
зависимостей, а повторный запуск без изменений берёт результат из кеша `.turbo/`
(`>>> FULL TURBO` в выводе). Команду в одном пакете —
`bun run --filter @cdd/client <скрипт>`

## BFF

`apps/bff` — сервер перед Go: процедуры tRPC на `/api/trpc`, сессия в зашифрованной cookie
`__Host-Http-session`, CSRF, пользователь в первом HTML (`<script id="bootstrap">`). Устройство — трек
[BFF](https://docs.cellestial.ru/modules/2/tracks/bff), спека и план —
`docs/superpowers/specs/2026-10-21-bff-design.md`, `docs/superpowers/plans/2026-10-21-bff.md`.

| Переменная      | Что это                                                                               |
| --------------- | ------------------------------------------------------------------------------------- |
| `SESSION_KEY`   | ключ AES-256-GCM сессии: base64 ровно 32 байт (`openssl rand -base64 32`), обязателен |
| `APP_ORIGIN`    | origin приложения без пути (`https://cellestial.ru`) — для CSRF, обязателен           |
| `GO_API_URL`    | адрес Go с префиксом API (`http://api:8080/api/v1`), обязателен                       |
| `PORT`          | порт BFF, по умолчанию `3000`                                                         |
| `BFF_KEY`       | S2S-ключ для Go (`X-BFF-Key`), на двух VPS                                            |
| `HTML_TEMPLATE` | `index.html` сборки клиента, по умолчанию `/app/client/index.html` (путь в образе)    |

Неверная конфигурация или шаблон без ровно одного `<script id="bootstrap" type="application/json">`
не дают BFF стартовать; в вывод попадают только имена переменных.

Go для локального запуска — Cloud Mock Apidog: ответы ручек и ошибок заданы там mock expectations по
контракту. Адрес — в Apidog, проект → Mock → Cloud Mock: `https://mock.apidog.com/m1/<проект>-<ветка>-default`,
без `/api/v1` — мок отдаёт пути ручек от корня. BFF получает его переменной `GO_API_URL`; адрес
мока main — значение по умолчанию у `bun run dev` (`apps/bff/src/dev.ts`).

```sh
bun run build
SESSION_KEY=$(openssl rand -base64 32) APP_ORIGIN=http://localhost:3000 \
  GO_API_URL=<адрес Cloud Mock> HTML_TEMPLATE=apps/client/dist/index.html \
  bun apps/bff/src/index.ts
```

Образ и локальный Compose:

```sh
bun run image        # turbo run build и docker build -t cdd-bff:local
SESSION_KEY=$(openssl rand -base64 32) GO_API_URL=<адрес Cloud Mock> \
  docker compose -f apps/bff/compose.yml up -d
curl localhost:3000/health
```

Проверка Cloud Mock — `GO_API_URL=<адрес Cloud Mock> bun run mock:check` (`apps/bff/test/mock-check.ts`):
статусы mock expectations и тела ответов по zod-схемам. Сценарии, которым нужно
состояние Go (одновременный refresh, повтор после 401, сбои и таймауты Go), проверяют тесты
`bun run test`: `apps/bff/test/` — весь обработчик BFF против Go с управляемыми ответами
(`test/fake-go.ts`), без сервера и сети.

## Клиент через BFF

`bun run dev` из корня запускает `turbo watch dev`, а он — клиент и BFF на одном origin
`https://localhost:5173`: Vite собирает и обновляет модули (HMR), HTML страниц и `/api/trpc` отдаёт
BFF — с пользователем в `<script id="bootstrap">` и cookie сессии. Без `.env` и ручных шагов:

- Vite (`apps/client`) — HTTPS на `localhost:5173`, сертификат выпускает
  [`vite-plugin-mkcert`](https://github.com/liuweiGL/vite-plugin-mkcert). `/api/trpc` проксируется в
  BFF; запрос страницы (`Accept: text/html`) плагин `bff-html` из `vite.config.ts` отдаёт ответом BFF
  с его `Set-Cookie`, добавив клиент HMR (`transformIndexHtml`). Адрес BFF — `BFF_URL`, по умолчанию
  `http://127.0.0.1:3000`.
- BFF (`apps/bff`, `src/dev.ts`) — шаблон `apps/client/index.html`,
  `APP_ORIGIN=https://localhost:5173`, Go — Cloud Mock Apidog
  (`https://mock.apidog.com/m1/1382426-0-default`), постоянный dev-ключ сессии: она переживает
  перезапуск BFF. Любое из этого перекрывается корневым `.env` (`GO_API_URL`, `SESSION_KEY`, …).
  Перезапускает BFF `turbo watch`: при изменении файлов `apps/bff` и пакетов, которые он
  импортирует (`packages/schemas`). `bun --watch` для этого не годится: на Windows он не следит за
  файлами вне `apps/bff`. Vite при этом не перезапускается, клиент обновляет HMR.

Cookie сессии — `Secure` и с префиксом `__Host-`: нужен HTTPS, ради dev атрибуты не ослабляются.
При первом запуске плагин скачивает mkcert в `~/.vite-plugin-mkcert`, создаёт локальный CA и
добавляет его в доверенные — macOS один раз спросит пароль. Дальше сертификат берётся из того же
каталога.

Cloud Mock отвечает фиксированно (раздел «BFF» выше): `denis` / `password123` — вход,
`wrong-password` — неверный пароль. Против своего Go — `GO_API_URL=http://127.0.0.1:8080/api/v1`
в `.env`.

Контракт Go обновляется `bun run sync` (`bun run apidog && bun run orval`): клиент контракт Go не
читает, типы процедур берёт из `@cdd/bff`.

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

| Правило                 | Что требует                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cdd/require-jsdoc`     | JSDoc у каждого экспортируемого объявления и у публичных методов экспортируемого класса. Реэкспорт (`export { a } from './a'`) не считается; у перегрузок комментарий несёт первая сигнатура |
| `cdd/check-param-names` | имена в `@param` совпадают с параметрами функции и идут в том же порядке                                                                                                                     |

Оба правила — командный плагин
[`@cdd-team/oxlint-plugin-jsdoc`](https://github.com/Cringe-Driven-Development-Team/frontend-packages/tree/main/packages/oxlint-plugin-jsdoc):
в `oxlint` правил `require-jsdoc` и `check-param-names` нет. Сами теги линт не требует: `@param` и `@returns` пишутся там, где описание что-то добавляет
к имени и типу. Сгенерированные Orval файлы линт не проверяет

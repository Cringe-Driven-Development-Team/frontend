# AGENTS.md

Фронтенд проекта «Colab» (Cellestial) команды «Cringe Driven Development».
Монорепа на bun workspaces и Turborepo: клиент — `apps/client`, BFF — `apps/bff`,
zod-схемы — `packages/schemas` ([README](README.md#монорепа)). Команды — из корня.
Процесс работы с задачами, ветками, коммитами и PR — в [README.md](README.md#как-работать-с-задачами) и [CONTRIBUTING организации](https://github.com/Cringe-Driven-Development-Team/.github/blob/main/CONTRIBUTING.md).
Код/PR/issues — в Cringe-Driven-Development-Team/frontend: ветка web-N,
в PR `Closes #N`, обязательное ревью ментора. Учебный frontend-park-mail-ru
получает копию main, новые PR туда не создаются.

Общепроектный контекст, действующая архитектура и планы развития проекта — в
[Контекст проекта](https://docs.cellestial.ru/project-context).
Спеки и планы реализации конкретной задачи размещай в репозитории, где выполняется
работа; общие для нескольких компонентов решения отражай в `docs`.
Факты о реализации проверяй по актуальному коду.

## Code Review Rules

- Пиши заголовки и пояснения замечаний к PR на русском языке.
  Имена файлов, идентификаторы, команды и метки приоритета сохраняй без перевода.

## Правила работы

- Работать этапами: сделать этап → человек проверяет → следующий этап только после его команды.
- Если что-то непонятно или есть выбор — спросить, а не угадывать.
- Готовые библиотеки из интернета не подключать. Можно только командные пакеты:
  `@cdd-team/react`, `@cdd-team/zustand`, `@cdd-team/openapi`.
- Не добавлять ничего, что не нужно для задачи. Комментарии в коде — коротко и только там,
  где без них непонятно.
- Каждому экспорту — JSDoc: без него падает `bun run lint`. Типы в `@param` и `@returns` не
  писать — их несёт TypeScript ([локальные правила](docs/local-development.md#документация-кода)).

## Источники

- API: контракт в Apidog, локальная копия — `spec/openapi.json`. Обновить — `bun run sync`
  (`bun run apidog` + `bun run orval` + `bun run generate`); спеку и сгенерированное
  (`apps/bff/src/go/client.ts`, `packages/schemas/src/zod.ts`, `apps/client/src/api/schema.ts`)
  руками не править. Orval и zod — по задаче frontend#45, исключение из правила про внешние библиотеки;
  так же Hono, `@trpc/server` и `serialize-javascript` в `apps/bff` — по задаче frontend#2.
  Временно, до backend#41: `spec/openapi.json` правлен вручную под целевой контракт BFF (frontend#2);
  `bun run sync` и `bun run generate` не запускать — Apidog вернёт старый контракт.
- Бэкенд: https://github.com/Cringe-Driven-Development-Team/backend, локально на
  `http://127.0.0.1:8080` (адрес меняется переменной `BACKEND_URL` в `.env`).

## Команды

```bash
bun run dev        # dev-сервер, /api/v1 проксируется на бэкенд
bun run check      # oxfmt --check, oxlint, tsc во всех пакетах
bun run build      # сборка, клиент — в apps/client/dist/
bun run orval      # spec/openapi.json → клиент BFF к Go и zod-схемы (orval.config.ts)
bun run generate   # spec/openapi.json → apps/client/src/api/schema.ts
```

Перед тем как сказать «готово» — `bun run check` и `bun run build` должны проходить.

## Структура `apps/client/src/`

Импорты из другой папки `src` — через алиасы (`@components/...`, `@modules/clsx`, `@stores/...`),
внутри своей папки — через `./`. Алиасы заданы только в `paths` в `apps/client/tsconfig.json`,
vite берёт их оттуда.

- `api/` — клиент `@cdd-team/openapi` (единственный экземпляр) и сгенерированная схема.
- `components/` — UI-kit по Components из макета: `Button`, `Input`, `Icon`, `Logo`, `Moon`,
  `Snackbar`, `Toast`, `Space`. Каждый компонент — папка с `.tsx` и `.module.css`.
- `layouts/RootLayout.tsx` — `<main>` с `<Outlet />`, тост и снекбар. Второй `<main>` на страницах не нужен.
- `modules/router/` — командный роутер (API как у TanStack Router). Импорт только через
  `@modules/router`, не из внутренних файлов.
- `pages/` — страницы. `routes/` — маршруты и дерево `routeTree.ts`.
- `stores/` — сторы на `@cdd-team/zustand`: `session`, `toast`, `snackbar`.
- `styles/tokens.css` — переменные с именами как в макете (`color/bg` → `--color-bg`).
  Глобальные стили — только `styles/global.css` и `styles/tokens.css`.
- `assets/` — SVG (знак логотипа, иконки) и favicon: Vite встраивает их в бандл.
  Картинки и шрифты лежат в репозитории
  [static](https://github.com/Cringe-Driven-Development-Team/static) и берутся с
  `https://static.cellestial.ru` (переменная `STATIC_URL` в `.env`). В CSS адрес пишется как
  `url('%STATIC_URL%/img/…')`: плагин в `apps/client/vite.config.ts` подставляет его при сборке и в dev.

Стили компонентов и страниц — CSS Modules: `import styles from './X.module.css'`,
в JSX `className={styles.peek}`, несколько классов — через `clsx` из `@modules/clsx`.
Имена классов короткие, в camelCase, без БЭМ-префиксов: область видимости даёт модуль.
Компонент не стилизует классы другого — нужный класс передаётся ему пропом `className`.

## Сессия и авторизация

- Access- и refresh-токен живут в HttpOnly-cookie (refresh — с `Path=/api/v1/auth`), фронт их
  не читает. После 401 клиент сам делает `POST /auth/refresh` и повторяет запрос.
  В `localStorage` токены не писать.
- POST, PUT, PATCH и DELETE несут `X-CSRF-Token` со значением cookie `__Host-csrf`: его ставит
  middleware клиента, в вызовах `api.*` заголовок не передавать.
- Статус сессии: `unknown` → `guest` | `authed`. Маршруты `_guest` (`/login`, `/register`)
  и `_auth` (остальные) проверяют его в `beforeLoad` и делают `redirect`.

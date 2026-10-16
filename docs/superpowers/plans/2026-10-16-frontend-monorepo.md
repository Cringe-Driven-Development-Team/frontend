# Монорепа фронта — план реализации

**Goal:** Репозиторий фронта — монорепа на bun workspaces и Turborepo: `apps/client`, `apps/bff`, `packages/schemas`.

**Architecture:** Клиент переезжает в `apps/client` без изменений в коде. Корень держит общий инструментарий (`spec/`, `scripts/`, `.env`, конфиги линтера и форматтера) и вызывает задачи пакетов через `turbo run`.

**Tech Stack:** Bun 1.4.2 (workspaces), Turborepo 2.11, Vite 8, TypeScript 7, oxlint, oxfmt.

**Spec:** [спека](../specs/2026-10-16-frontend-monorepo-design.md). Задача — [frontend#44](https://github.com/Cringe-Driven-Development-Team/frontend/issues/44).

> [!NOTE]
> План записан после реализации и отражает фактически выполненные шаги. Все задачи выполнены
> в ветке `web-44`, PR [#60](https://github.com/frontend-park-mail-ru/2026_2_Cringe_Driven_Development/pull/60).

## Global Constraints

- Ветка `web-44` от `main` (`612f506`).
- Код клиента не меняется: только перенос файлов и пути в конфигах.
- Команды CI (`bun install --frozen-lockfile`, `bun run check`, `bun run build`, `bun run release …`) остаются прежними — workflow в `.github/` не трогаются.
- Новая зависимость — только `turbo` (требование задачи).
- В коммитах и PR нет строк авторства Claude.

## Файлы

| Файл                                                     | Что меняется                                               | Задача |
| -------------------------------------------------------- | ---------------------------------------------------------- | ------ |
| `src/`, `index.html`, `vite.config.ts`, `tsconfig.json`  | `git mv` в `apps/client/`                                  | 1      |
| `apps/client/package.json`                               | новый, `@cdd/client`                                       | 1      |
| `apps/client/vite.config.ts`                             | `envDir: '../..'`                                          | 1      |
| `apps/bff/package.json`, `packages/schemas/package.json` | новые                                                      | 1      |
| `package.json`, `bun.lock`                               | workspaces, скрипты через turbo, зависимости               | 2      |
| `turbo.json`                                             | новый                                                      | 2      |
| `scripts/tsconfig.json`                                  | самостоятельный, без `extends`                             | 2      |
| `scripts/release/upload.ts`, `scripts/release/index.ts`  | каталог по умолчанию `apps/client/dist`                    | 3      |
| `oxlint.config.ts`, `oxfmt.config.ts`, `.gitignore`      | пути `**/dist`, `apps/client/src/api/schema.ts`, `.turbo/` | 3      |
| `README.md`, `CLAUDE.md`                                 | раздел «Монорепа», новые пути                              | 4      |

## Задача 1. Workspaces

- [x] `mkdir -p apps/client apps/bff packages/schemas`; `git mv src index.html vite.config.ts tsconfig.json apps/client/`.
- [x] `apps/client/package.json`: `@cdd/client`, скрипты `dev`, `build`, `preview`, `lint` (`oxlint`), `typecheck` (`tsc --noEmit`), `generate` (`openapi-cdd ../../spec/openapi.json -o src/api/schema.ts`); зависимости клиента и `vite`, `typescript`.
- [x] `apps/client/vite.config.ts`: `const envDir = '../..'`, `loadEnv(mode, envDir, '')` и `envDir` в конфиге.
- [x] `apps/bff/package.json` (`@cdd/bff`) и `packages/schemas/package.json` (`@cdd/schemas`, `exports` → `./src/zod.ts`) — без исходников.

## Задача 2. Turborepo и корень

- [x] Корневой `package.json`: `workspaces: ["apps/*", "packages/*"]`, `packageManager: bun@1.4.2`, скрипты `dev`/`build`/`lint`/`typecheck`/`test` → `turbo run …`, `lint:scripts`, `typecheck:scripts`, `check`, `generate` → `bun run --filter @cdd/client generate`; `release`, `apidog`, `sync` без изменений.
- [x] `turbo.json`: `build` с `^build`, `outputs: ["dist/**"]`, `env: ["RELEASE_SHA", "CDN_URL", "STATIC_URL"]`; `lint` со входом `$TURBO_ROOT$/oxlint.config.ts`; `typecheck`, `test` с `^build`; `dev` без кеша; `//#lint:scripts`, `//#typecheck:scripts`; `globalDependencies: [".env"]`; `ui: "stream"`.
- [x] `scripts/tsconfig.json` без `extends` (корневой `tsconfig.json` уехал в клиент).
- [x] `rm -rf node_modules && bun install`; `bun install --frozen-lockfile` проходит.

## Задача 3. Пути выкатки и инструментов

- [x] `scripts/release/upload.ts`: `dir = 'apps/client/dist'`; usage в `index.ts`.
- [x] `oxlint.config.ts`: `ignorePatterns` — `**/dist/`, `**/src/api/schema.ts`.
- [x] `oxfmt.config.ts`: `**/dist/**`, `.turbo/**`, `apps/client/src/api/schema.ts`.
- [x] `.gitignore`: `.turbo/`.

## Задача 4. Документация

- [x] README: раздел «Монорепа» перед «Контракт API» — таблица пакетов, команды из корня, кеш, `--filter`; пути `apps/client/src/api/schema.ts`.
- [x] CLAUDE.md: монорепа в шапке, команды и раздел `apps/client/src/`.

## Проверка

- [x] `bun run check` — 4 задачи, все успешны; линт ловит экспорт без JSDoc в `apps/client`.
- [x] `bun run build` — клиент в `apps/client/dist`; повторный запуск — `>>> FULL TURBO`.
- [x] `RELEASE_SHA=abc CDN_URL=cdn.example.com bun run build` — cache miss, в `index.html` `https://cdn.example.com/releases/abc/assets/…`.
- [x] `bun run dev` — `http://127.0.0.1:5173/` отвечает 200, `<meta name="release" content="dev">`.
- [x] `bun run generate` — `schema.ts` без диффа.
- [x] CI `Check` на PR #60 зелёный.
- [ ] После мержа: заливка в CI на `main` и `CD` проходят как до переезда.

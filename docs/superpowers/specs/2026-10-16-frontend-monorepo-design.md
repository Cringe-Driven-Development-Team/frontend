# Монорепа фронта на bun workspaces и Turborepo

Дата: 16 октября 2026 года.

Задача: [frontend#44](https://github.com/Cringe-Driven-Development-Team/frontend/issues/44).
PR: [#60](https://github.com/frontend-park-mail-ru/2026_2_Cringe_Driven_Development/pull/60).

> [!NOTE]
> Спека написана после реализации, по просьбе пользователя: от вопросов брейншторма
> пользователь отказался («начинай»), и работа шла сразу по описанию задачи. Решения,
> которые не записаны в задаче, приняты исполнителем — они собраны в разделе
> «Решения исполнителя», их стоит проверить на ревью.

## Цель

Репозиторий фронта становится монорепой: рядом с клиентом появляются место для BFF и общий
пакет схем. Это подзадача «Turborepo + bun workspaces» трека
[BFF](https://cringe-driven-development-team.github.io/docs/modules/2/tracks/bff): без неё BFF
и сгенерированный клиент к Go некуда положить. Раскладка — по разделу трека «Монорепа фронта» и
странице [«Контракт»](https://cringe-driven-development-team.github.io/docs/modules/2/tracks/bff/contract).

## Объём

Входит (из задачи):

- bun workspaces: клиент в `apps/client`, пустой `apps/bff`, пакет `packages/schemas` (`@cdd/schemas`);
- Turborepo: задачи `build`, `lint`, `typecheck`, `test` с зависимостями между пакетами и кешем;
- скрипты корня вызывают `turbo run …`, README объясняет, как работать в монорепе;
- git-хуки и CI фронта работают из корня.

Не входит:

- сам BFF — [frontend#2](https://github.com/Cringe-Driven-Development-Team/frontend/issues/2);
- CI/CD для BFF — [frontend#4](https://github.com/Cringe-Driven-Development-Team/frontend/issues/4);
- Orval, клиент к Go и zod-схемы — трек [Orval](https://cringe-driven-development-team.github.io/docs/modules/2/tracks/bff-orval);
- изменения в поведении клиента и в процессе выкатки.

Анти-цель: выкатка ломается или молча собирает релиз не с тем `base`. Монорепа, после которой
CI заливает в S3 сборку без CDN-адреса, хуже, чем никакой.

## Исходное состояние

`main` на `612f5063a1f9e8158e7713a440f9858aaff72824`:

- одно приложение в корне: `src/`, `index.html`, `vite.config.ts`, `tsconfig.json`;
- `scripts/release/` — заливка, выкатка и откат клиента; `upload` по умолчанию берёт `dist`;
- `scripts/openapi/apidog.ts` пишет `spec/openapi.json`; `generate` строит из неё `src/api/schema.ts`;
- `.env` в корне читают Vite (`STATIC_URL`, `BACKEND_URL`) и `apidog` (`APIDOG_TOKEN`);
- CI (`ci.yml`) из корня запускает `bun install --frozen-lockfile`, `bun run check`, `bun run build`,
  на `main` — сборку с `RELEASE_SHA` и `CDN_URL` и `bun run release upload "$GITHUB_SHA"`;
  `cd.yml` и `rollback.yml` вызывают только `bun run release …`;
- git-хуков в репозитории нет.

## Раскладка

| Каталог            | Пакет          | Содержимое                                                                                                                  |
| ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/client`      | `@cdd/client`  | `src/`, `index.html`, `vite.config.ts`, `tsconfig.json`, скрипты `dev`, `build`, `preview`, `lint`, `typecheck`, `generate` |
| `apps/bff`         | `@cdd/bff`     | только `package.json`                                                                                                       |
| `packages/schemas` | `@cdd/schemas` | только `package.json`, `exports` → `./src/zod.ts` (цель Orval из «Контракта»)                                               |
| корень             | `cellestial`   | `spec/`, `scripts/`, `.env`, `oxlint.config.ts`, `oxfmt.config.ts`, `turbo.json`, README, CLAUDE.md, `.github/`             |

## Turborepo

- `build`: `dependsOn: ["^build"]`, `outputs: ["dist/**"]`,
  `env: ["RELEASE_SHA", "CDN_URL", "STATIC_URL"]`.
- `lint`: входы пакета и корневой `oxlint.config.ts`.
- `typecheck`, `test`: `dependsOn: ["^build"]`.
- `dev`: без кеша, `persistent`.
- Корневые задачи `//#lint:scripts` и `//#typecheck:scripts` проверяют `scripts/`.
- `globalDependencies: [".env"]`, `ui: "stream"` — вывод как у обычных скриптов, без TUI.

Скрипты корня: `dev`, `build`, `lint`, `typecheck`, `test` → `turbo run …`;
`check` = `oxfmt --check` + `turbo run lint lint:scripts typecheck typecheck:scripts`;
`release`, `apidog`, `sync` остаются корневыми; `generate` → `bun run --filter @cdd/client generate`.

## Решения исполнителя

1. **`.env` остаётся в корне.** Vite клиента читает его через `envDir: '../..'`. Так у всех
   продолжают работать существующие `.env`, и один файл обслуживает клиент и `apidog`.
2. **`scripts/` и `spec/` остаются в корне.** Это общий инструментарий: по «Контракту» Orval будет
   читать `spec/openapi.json` из корня. `release upload` по умолчанию берёт `apps/client/dist`,
   поэтому workflow в `.github/` не меняются.
3. **Переменные релиза — в `env` задачи `build`.** Turborepo в строгом режиме не пропускает
   неуказанные переменные в задачу и не учитывает их в ключе кеша. Без этого CI собрал бы клиент
   без CDN-адреса или взял бы из кеша сборку без него — ровно анти-цель.
4. **`apps/bff` и `@cdd/schemas` — только `package.json`.** Пустой модуль не проходит линт
   (`unicorn/no-empty-file`, `unicorn/require-module-specifiers`), а заглушка с экспортом —
   лишний код. Исходники появятся в frontend#2 и в треке Orval.
5. **Конфиги `oxlint` и `oxfmt` — одни на репозиторий, в корне.** `oxlint`, запущенный в пакете,
   находит корневой конфиг (проверено: правило `cdd/require-jsdoc` срабатывает в `apps/client`).
   Форматирование — не задача Turborepo, `oxfmt` идёт по всему репозиторию одним проходом.
6. **Git-хуки.** В репозитории их нет — пункт задачи выполнен тривиально.
7. **`turbo` — `^2.11.7`** в `devDependencies` корня, в lock — 2.11.8. `packageManager: bun@1.4.2`
   нужен Turborepo для разбора workspaces.

## Приёмка

- `bun install` и `bun run build` в корне собирают клиент; `bun run dev` поднимает клиент как раньше.
- Повторный `bun run build` без изменений берёт результат из кеша (`>>> FULL TURBO`).
- Сборка с `RELEASE_SHA` и `CDN_URL` не берётся из кеша обычной сборки, `index.html` ссылается
  на `<CDN>/releases/<sha>/`.
- `bun run check` проходит; CI `Check` на PR зелёный.
- Выкатка после мержа работает как до переезда: заливка в CI на `main` и `CD` проходят.

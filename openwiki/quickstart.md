---
type: overview
title: Карта frontend и точка входа
description: Навигация по клиенту, BFF, сессии, схемам Go и разработке frontend с правилами проверки исходного SHA и границами соседних репозиториев.
tags: [frontend, quickstart, architecture, ownership]
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-eb237af3f199730f9b3e53e3
    resource: repo://apps/bff/src/bff.ts
  - id: openwiki-source-7cd80694ee035fce8b8e9b73
    resource: repo://apps/bff/test/bff.test.ts
  - id: openwiki-source-bf47c30b7933f3e39a4ad225
    resource: repo://apps/client/src/main.tsx
  - id: openwiki-source-6ad8af232827e763157fb593
    resource: repo://apps/client/test/session.test.ts
  - id: openwiki-source-3dfcfd64a44b04f5b62b200f
    resource: repo://orval.config.ts
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-7d571db73f7bc6eb1ea8e5c6
    resource: repo://scripts/openwiki-check.ts
generated: { by: "codex", at: "2026-10-31T14:41:46.617Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-31T14:41:46.617Z
---

# Карта frontend и точка входа

Wiki описывает код командного репозитория `frontend` на `1dad3c77a90c4ebdb151649a788f890c640dfafb`. Это не свидетельство выкладки или работоспособности прода. Для будущих функций служат модули docs; для состояния стенда нужна отдельная проверка.

## Как устроен репозиторий

Bun workspaces объединяет `apps/client`, `apps/bff`, `packages/schemas`. Клиент рендерится через `@cdd-team/react` после чтения bootstrap и общается с BFF по tRPC. BFF под Bun собирает HTML handler и RPC, обращается к Go через серверный слой сессии. Общие zod-схемы генерируются Orval из копии HTTP-контракта Go. [Workspaces и команды](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/package.json#L1-L28), [первый рендер](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/client/src/main.tsx#L13-L36), [сборка BFF](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/bff/src/bff.ts#L17-L37), [генерация](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/orval.config.ts#L3-L27).

## От вопроса к коду

| Что нужно понять или изменить | Страница wiki | Первые исходники |
| --- | --- | --- |
| Прямое открытие страницы, 302/404/503, первый рендер | [HTML, маршруты и блокноты](architecture/request-flow.md) | `apps/bff/src/html.ts`, `pages.ts`, `apps/client/src/bootstrap.ts`, `routes/` |
| Загрузка блокнота и изменение списка ячеек | [HTML, маршруты и блокноты](architecture/request-flow.md#блокнот-после-загрузки) | `apps/client/src/pages/NotebookPage/NotebookPage.tsx`, `stores/preloaded.ts` |
| Cookie, CSRF, refresh, одновременный logout | [Сессия](concepts/session.md) | `apps/bff/src/context.ts`, `session/`, `apps/client/src/api/trpc.ts` |
| Новая процедура, zod, ошибки Go, типы клиента | [Контракты](integrations/contracts.md) | `apps/bff/src/router/`, `go/api.ts`, `go/errors.ts`, `orval.config.ts` |
| Изменение Vite-плагина или React-пакета | [Владельцы пакетов](integrations/contracts.md#где-менять-командные-пакеты) | Использование — frontend; реализация — frontend-packages |
| Dev, сборка, CI, выбор проверки | [Разработка](operations/development.md) | `package.json`, `apps/client/vite.config.*.ts`, `apps/bff/test/`, `apps/client/test/`, `scripts/` |

## Команды и тестовые границы

Начало работы: `bun install`, затем `bun run dev` из корня. Основные проверки — `bun run check`, `bun run test`, `bun run build`. Для отдельного пакета используйте `bun run --filter @cdd/client test` или `bun run --filter @cdd/bff test`; служебные скрипты проверяет `bun run test:scripts`. [Команды](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/package.json#L9-L28).

BFF-тесты с fake Go проверяют обработчик и ошибки, клиентские тесты с управляемым fetch — порядок смены сессии. Они помогают проверять локальные изменения, но не заменяют интеграцию с реальным Go или проверку стенда. [BFF-тесты](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/bff/test/bff.test.ts#L1-L23), [клиентские тесты](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/client/test/session.test.ts#L1-L46).

## Свежесть и доказательства

`repo://` в Claims обозначает файл **frontend** на `gitHead` из `openwiki/.last-update.json`. Страницы и Claims — производные сведения: перед изменением реализации сверяйте актуальный код. Ссылки на GitHub закреплены за исходным SHA и строками, а не движущейся веткой.

Перед использованием получите актуальный полный SHA `frontend/main` и выполните:

```sh
bun scripts/openwiki-check.ts --against <полный-SHA-frontend-main>
```

Checker требует quickstart, завершённый checkpoint с полным SHA и происхождение checkpoint от целевого коммита; свежесть определяет по изменениям разрешённого корпуса. При `stale` wiki помогает искать файлы, факты проверяют заново. SHA frontend не подтверждает свежесть соседних wiki. [Checker](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/scripts/openwiki-check.ts#L41-L102), [правила использования](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/AGENTS.md#L19-L44).

## Границы соседних репозиториев

Карта владения и контекст находятся в [docs](https://github.com/Cringe-Driven-Development-Team/docs); реализация Go — в [backend](https://github.com/Cringe-Driven-Development-Team/backend); инфраструктура — в [infra](https://github.com/Cringe-Driven-Development-Team/infra); внутренности `@cdd-team/*` — в [frontend-packages](https://github.com/Cringe-Driven-Development-Team/frontend-packages). Frontend wiki описывает только точки их использования в frontend. [Локальная карта владельцев](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/AGENTS.md#L28-L44).

Для межрепозиторного вопроса используйте настроенный OpenWiki workspace четырёх клонов: `openwiki_search`, затем `openwiki_read` с ID wiki результата. Если пространств несколько, сначала проверьте `openwiki workspace current` и выберите нужное. Без MCP читайте Markdown quickstart нужного клона или GitHub, проверяя origin и его собственную свежесть. Не загружайте все wiki при старте задачи. Планы функций ищут в `/modules/` docs, а не выводят из наличия кода в main. [Маршрут агента](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/AGENTS.md#L19-L44).

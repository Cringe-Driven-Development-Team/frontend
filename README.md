# 2026_2_Cringe_Driven_Development

Frontend проекта «Colab» (Cellestial) команды «Cringe Driven Development».
Разработка, задачи и PR — в [командном frontend](https://github.com/Cringe-Driven-Development-Team/frontend).
[Учебная копия](https://github.com/frontend-park-mail-ru/2026_2_Cringe_Driven_Development)
автоматически получает те же коммиты `main`.

<picture>
<source media="(max-width: 600px)" srcset=".github/assets/dance.gif 1.2x">
<source srcset=".github/assets/dance.gif 0.75x">
<img src=".github/assets/dance.gif" alt="" align="right">
</picture>

[![Сервис cellestial.ru](https://img.shields.io/badge/cellestial.ru-7A5AF8?style=for-the-badge&logo=googlechrome&logoColor=white)](https://cellestial.ru)
[![Доска задач](https://img.shields.io/badge/Доска_задач-1F6FEB?style=for-the-badge&logo=github&logoColor=white)](https://github.com/orgs/Cringe-Driven-Development-Team/projects/1)
[![Макеты в Figma](https://img.shields.io/badge/Макеты-F24E1E?style=for-the-badge&logo=figma&logoColor=white)](https://www.figma.com/design/7iaVDGiwzQk2vZIB5ogVlq/Colab)
[![Документация](https://img.shields.io/badge/Документация-5C73E7?style=for-the-badge&logo=vitepress&logoColor=white)](https://docs.cellestial.ru/project-context)
[![Бэкенд](https://img.shields.io/badge/Бэкенд-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://github.com/Cringe-Driven-Development-Team/backend)

## Быстрый старт

Нужен Bun версии не ниже 1.4.0. Команды выполняются из корня репозитория:

```bash
bun install
bun run dev
```

`bun run dev` запускает клиент и проксирует `/api/v1` на бэкенд по адресу
`http://127.0.0.1:8080`. Другой адрес задаётся переменной `BACKEND_URL` в `.env`.
Перед PR выполните `bun run check` и `bun run build`.
Подробности — в [локальной разработке](docs/local-development.md).

## Монорепа

| Каталог | Назначение |
| --- | --- |
| `apps/client` | Vite-клиент |
| `apps/bff` | BFF, пока пустой |
| `packages/schemas` | схемы API, пока пустой |

Зависимости и команды объединены Bun workspaces и Turborepo.

## Документация

- [Локальная разработка и правила кода](docs/local-development.md) — команды, структура, JSDoc.
- [Контракт API в Apidog](docs/api-contract.md) — синхронизация спецификации и генерация типов.
- [CI, учебная копия и выкатка](docs/release.md) — релизы, CD, откат и диагностика.
- [Контекст проекта](https://docs.cellestial.ru/project-context) — общая архитектура и планы.
- [AGENTS.md](AGENTS.md) — локальные правила для агента.

## Как работать с задачами

Создавайте задачи и PR в [командном frontend](https://github.com/Cringe-Driven-Development-Team/frontend),
берите задачи на общей [доске](https://github.com/orgs/Cringe-Driven-Development-Team/projects/1).
Для задачи `#N` создайте ветку `web-N` и PR в `main` с заголовком `WEB-N: <название>`
и строкой `Closes #N` в описании. PR проходит ревью ментора; после merge задача
закроется автоматически. Правила описания задач и межрепозиторных связей — в
[CONTRIBUTING организации](https://github.com/Cringe-Driven-Development-Team/.github/blob/main/CONTRIBUTING.md).

Формат коммита: `<тип>: <описание>` либо `<тип>(<область>): <описание>`.
Используйте `feat`, `fix`, `refactor`, `style`, `test`, `docs` или `chore`.

## Команда

Ерофей [Гаранин](https://github.com/ManInTheCoat), Денис [Истратов](https://github.com/iredtea-dev),
Дарья [Шпакова](https://github.com/GrayMouse9), Валентин [Кунев](https://github.com/MrDuckVC).
Менторы: [Ярослав Михалёв](https://github.com/YarikMix) (frontend),
[Александр Батовкин](https://github.com/blackHATred) (backend),
[Дарья Ченцова](https://t.me/dewon_d) (UX).

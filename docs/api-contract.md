# Контракт API фронтенда

Контракт ведётся в [Apidog](https://app.apidog.com/project/1382426), в репозитории лежит его копия
`spec/openapi.json` и сгенерированные по ней типы клиента `apps/client/src/api/schema.ts`. Оба файла коммитятся
и руками не правятся

| Команда            | Что делает                                                        |
| ------------------ | ----------------------------------------------------------------- |
| `bun run sync`     | всё сразу: выгрузка из Apidog и генерация типов                   |
| `bun run apidog`   | выгружает спеку в `spec/openapi.json`                             |
| `bun run generate` | генерирует `apps/client/src/api/schema.ts` из `spec/openapi.json` |

Для выгрузки нужен личный токен Apidog (`Account Settings` → `API Access Token`) в `.env`:

```sh
APIDOG_TOKEN=...
# ID sprint-ветки (серое число в Manage Sprint Branches). Пусто — ветка main
APIDOG_BRANCH_ID=
```

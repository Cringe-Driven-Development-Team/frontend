# Контракт API фронтенда

Контракт ведётся в [Apidog](https://app.apidog.com/project/1382426), в репозитории лежит его копия
`spec/openapi.json` и сгенерированное по ней:

- `apps/bff/src/go/client.ts` — fetch-клиент BFF к Go (Orval, мутатор `bearerFetch` в `apps/bff/src/go/fetch.ts`:
  адрес Go — `GO_API_URL`, по умолчанию `http://api:8080/api/v1`; `Authorization: Bearer` передаёт вызывающий код);
- `packages/schemas/src/zod.ts` — zod-схемы операций Go (Orval), пакет `@cdd/schemas`;
- `apps/client/src/api/schema.ts` — типы клиента (`openapi-cdd`; уйдёт вместе с переходом клиента на tRPC,
  [frontend#2](https://github.com/Cringe-Driven-Development-Team/frontend/issues/2)).

Все эти файлы коммитятся и руками не правятся: по диффу в PR видно, что поменялось в контракте Go

| Команда            | Что делает                                                        |
| ------------------ | ----------------------------------------------------------------- |
| `bun run sync`     | всё сразу: выгрузка из Apidog, Orval и типы клиента               |
| `bun run apidog`   | выгружает спеку в `spec/openapi.json`                             |
| `bun run orval`    | генерирует клиент к Go и zod-схемы по `orval.config.ts`           |
| `bun run generate` | генерирует `apps/client/src/api/schema.ts` из `spec/openapi.json` |

Для выгрузки нужен личный токен Apidog (`Account Settings` → `API Access Token`) в `.env`:

```sh
APIDOG_TOKEN=...
# ID sprint-ветки (серое число в Manage Sprint Branches). Пусто — ветка main
APIDOG_BRANCH_ID=
```

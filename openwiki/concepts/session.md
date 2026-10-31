---
type: security
title: Сессия, CSRF и смена пользователя
description: Владение токенами в BFF, обновление сессии, CSRF-проверки и порядок запросов при входе и выходе клиента.
tags: [session, csrf, authentication, concurrency]
sources:
  - id: openwiki-source-2189d746259f9de2b75640e0
    resource: repo://apps/bff/src/context.ts
  - id: openwiki-source-e9d516dc0dab591185bbeeb4
    resource: repo://apps/bff/src/router/auth.ts
  - id: openwiki-source-c9e5827e8201daf3ae7859a0
    resource: repo://apps/bff/src/session/cookies.ts
  - id: openwiki-source-f291dbfb7f54acefab7789f1
    resource: repo://apps/bff/src/session/crypto.ts
  - id: openwiki-source-9ef97c8f583ba7c0596f50ab
    resource: repo://apps/bff/src/session/refresh.ts
  - id: openwiki-source-4fa129eae81b89c6a34439f3
    resource: repo://apps/bff/src/session/session.ts
  - id: openwiki-source-b078c46af746a6b2d1e173d3
    resource: repo://apps/client/src/api/trpc.ts
  - id: openwiki-source-bf47c30b7933f3e39a4ad225
    resource: repo://apps/client/src/main.tsx
  - id: openwiki-source-5788d128267fc182c2c8cd90
    resource: repo://apps/client/src/stores/session.ts
generated: { by: "codex", at: "2026-10-31T14:41:46.617Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-31T14:41:46.617Z
---

# Сессия, CSRF и смена пользователя

Страница описывает код на `1dad3c77a90c4ebdb151649a788f890c640dfafb`, без вывода о выкладке.

## Кто хранит состояние

BFF хранит access/refresh и их сроки в зашифрованной cookie `__Host-Http-session`. Атрибуты — `Path=/; HttpOnly; Secure; SameSite=Lax`, без `Domain`; шифрование использует AES-GCM, случайный IV и имя cookie как AAD. Значение `SESSION_KEY` приходит из конфигурации, здесь оно не публикуется. Ошибка расшифровки или истёкший refresh создают гостевую сессию с удалением cookie, без запроса Go. [Cookie](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/bff/src/session/cookies.ts#L1-L35), [шифрование](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/bff/src/session/crypto.ts#L12-L70), [чтение сессии](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/bff/src/session/session.ts#L129-L142).

Процедуры входа и регистрации возвращают клиенту пользователя, а токены передают `session.start`. Выход отзывает refresh в Go по возможности и завершает локальную сессию даже при сбое этого вызова. Клиентский стор содержит только `guest | authed` и пользователя; первоначальное значение поступает из [bootstrap](../architecture/request-flow.md). [Auth router](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/bff/src/router/auth.ts#L6-L26), [стор](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/client/src/stores/session.ts#L5-L31).

## CSRF до сессии и Go

Каждый RPC требует `X-CSRF: 1`. Для POST дополнительно проверяется точное совпадение `Origin` с `APP_ORIGIN`; присутствующий `Sec-Fetch-Site` должен быть `same-origin`. Отказ — `FORBIDDEN` с `appCode: csrf_invalid`, до чтения cookie и обращения к Go. Единый клиент tRPC ставит этот заголовок и `credentials: 'same-origin'`. [Контекст BFF](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/bff/src/context.ts#L11-L31), [транспорт клиента](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/client/src/api/trpc.ts#L92-L107).

## Refresh и решение о cookie

`session.call` обновляет access, если до истечения менее 30 секунд. После 401 делает refresh и один повтор; повторный 401 завершает сессию. Заголовки Go собирает сама сессия: Bearer и request ID. При ошибке refresh только `SessionEnded` удаляет сессию, остальные ошибки сохраняют её. `setCookies` применяет итоговое решение к заголовкам ответа; tRPC вызывает его в `finally`. [Алгоритм сессии](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/bff/src/session/session.ts#L73-L125), [middleware](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/bff/src/trpc.ts#L30-L39).

`refreshTokens` объединяет одновременные запросы одного refresh по SHA-256 токена в process-local `Map`. Успешный результат остаётся на 10 секунд, неудачный сразу удаляется. Это координация в пределах процесса BFF, не распределённая блокировка между экземплярами. Отказ Go 401 становится `SessionEnded`; остальные ошибки проходят через проверку ответа. [Refresh](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/bff/src/session/refresh.ts#L15-L67).

## Клиент не позволяет старому ответу сменить пользователя

Все процедуры кроме `auth.*` считаются защищёнными. `sessionLink` учитывает незавершённые запросы и поколение сессии. Ответ другого поколения отклоняется с `SESSION_CHANGED`; `UNAUTHORIZED` активного поколения вызывает обработчик потери сессии. В `main.tsx` обработчик очищает стор, показывает уведомление и ведёт на `/login`. [Link](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/client/src/api/trpc.ts#L21-L90), [реакция интерфейса](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/client/src/main.tsx#L29-L34).

`login`, `register`, `logout` проходят через `switchSession`: смены ставятся в очередь, новые защищённые запросы отвергаются, уже отправленные завершаются перед `auth.*`. Поэтому их ответы с `Set-Cookie` приходят до установки новой сессии. Если auth-вызов не удался, но во время ожидания пришёл `UNAUTHORIZED`, сессия всё равно теряется. Обычный сетевой сбой выхода без такого события сохраняет прежнее состояние. [Очередь смен](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/client/src/api/trpc.ts#L126-L164), [действия стора](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/client/src/stores/session.ts#L73-L112).

Проверять изменения порядка запросов следует по `apps/client/test/session.test.ts`: настоящий tRPC-клиент с управляемым `fetch` проверяет потерю сессии и перекрывающиеся смены. BFF-тесты отдельно проверяют объединение refresh, повторный 401 и ошибки Go. [Клиентские сценарии](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/client/test/session.test.ts#L48-L141), [BFF-сценарии](https://github.com/Cringe-Driven-Development-Team/frontend/blob/1dad3c77a90c4ebdb151649a788f890c640dfafb/apps/bff/test/bff.test.ts#L156-L218).

Смежные страницы: [контракты и ошибки](../integrations/contracts.md), [разработка и проверки](../operations/development.md), [общая карта](../quickstart.md).

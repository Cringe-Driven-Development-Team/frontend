import { defineConfig } from 'orval';

// Обе цели читают контракт Go — spec/openapi.json (bun run sync)
export default defineConfig({
    // BFF → Go: fetch-клиент по операциям контракта; адрес Go и заголовки — в мутаторе
    goApi: {
        input: { target: 'spec/openapi.json' },
        output: {
            target: 'apps/bff/src/go/client.ts',
            client: 'fetch',
            override: { mutator: { path: 'apps/bff/src/go/fetch.ts', name: 'bearerFetch' } },
        },
    },
    // zod-схемы операций — пакет @cdd/schemas: вход процедур BFF
    goZod: {
        input: { target: 'spec/openapi.json' },
        output: {
            target: 'packages/schemas/src/zod.ts',
            client: 'zod',
            // additionalProperties: false в контракте Orval сам не переносит: тело с лишним
            // полем (опечаткой) прошло бы, потеряв это поле. Строго — там, где так в контракте.
            override: {
                operations: { createCell: { zod: { strict: { body: true } } } },
            },
        },
    },
});

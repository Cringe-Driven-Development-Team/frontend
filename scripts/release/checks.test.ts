import { afterEach, expect, test } from 'bun:test';

// пауза между попытками читается при загрузке модуля
process.env.CHECK_INTERVAL_MS = '0';
const { releaseCheck } = await import('./checks.ts');

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

const SHA = 'a'.repeat(40);
const BASE = `https://cdn.test/releases/${SHA}/`;

function cdn(missing?: string): string[] {
    const requested: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        requested.push(url);
        if (url === `${BASE}index.html`) {
            return new Response(
                `<meta name="release" content="${SHA}"><script type="module" crossorigin src="${BASE}assets/index.js"></script><link rel="stylesheet" crossorigin href="${BASE}assets/index.css">`,
            );
        }
        if (url === missing) return new Response('', { status: 404 });
        return new Response('', { headers: { 'Access-Control-Allow-Origin': '*' } });
    }) as typeof fetch;
    return requested;
}

test('release check проверяет все JS и CSS выпуска', async () => {
    process.env.CDN_URL = 'https://cdn.test';
    const requested = cdn();
    await releaseCheck(SHA);
    expect(requested).toContain(`${BASE}assets/index.js`);
    expect(requested).toContain(`${BASE}assets/index.css`);
});

test('release check не проходит без CSS на CDN', async () => {
    process.env.CDN_URL = 'https://cdn.test';
    cdn(`${BASE}assets/index.css`);
    await expect(releaseCheck(SHA)).rejects.toThrow('Release check не прошёл');
});

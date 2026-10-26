import { afterEach, expect, test } from 'bun:test';
import { listDeployments } from './github.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

test('история deployments читается со всех страниц', async () => {
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'test-token';
    const total = 230;
    const pages: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/statuses')) return Response.json([{ state: 'success' }]);
        const page = Number(url.searchParams.get('page'));
        pages.push(String(page));
        const from = (page - 1) * 100;
        const items = Array.from({ length: Math.max(0, Math.min(100, total - from)) }, (_, i) => ({
            id: from + i + 1,
            sha: 'a'.repeat(40),
            payload: {},
            created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, from + i)).toISOString(),
        }));
        return Response.json(items);
    }) as typeof fetch;
    const history = await listDeployments('production');
    expect(pages).toEqual(['1', '2', '3']);
    expect(history).toHaveLength(total);
    // от новых к старым: самая старая запись первой страницы — в конце
    expect(history[0]!.id).toBe(total);
    expect(history.at(-1)!.id).toBe(1);
});

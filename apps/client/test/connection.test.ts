import { afterEach, expect, test } from 'bun:test';
import { fetchTracked, useConnectionStore } from '@stores/connection';

const realFetch = globalThis.fetch;
const answer = (result: () => Promise<Response>) => {
    globalThis.fetch = result as unknown as typeof fetch;
};

afterEach(() => {
    globalThis.fetch = realFetch;
    useConnectionStore.setState({ lost: false });
});

test('отказ запроса — соединение потеряно, ошибка не проглатывается', async () => {
    answer(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(fetchTracked('/api')).rejects.toThrow('Failed to fetch');
    expect(useConnectionStore.getState().lost).toBe(true);
});

test('HTTP-ошибка — BFF доступен, предупреждение снимается', async () => {
    useConnectionStore.setState({ lost: true });
    answer(() => Promise.resolve(new Response(null, { status: 503 })));
    expect((await fetchTracked('/api')).status).toBe(503);
    expect(useConnectionStore.getState().lost).toBe(false);
});

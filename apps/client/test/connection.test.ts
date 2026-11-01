import { afterEach, expect, test } from 'bun:test';
import { fetchTracked, useConnectionStore } from '@stores/connection';
import { useToastStore } from '@stores/toast';

const realFetch = globalThis.fetch;
const answer = (result: () => Promise<Response>) => {
    globalThis.fetch = result as unknown as typeof fetch;
};

const shownToast = () => useToastStore.getState().toast?.text;

afterEach(() => {
    globalThis.fetch = realFetch;
    useConnectionStore.setState({ lost: false });
    useToastStore.setState({ toast: null });
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

test('обрыв тела после заголовков — соединение потеряно', async () => {
    const body = new ReadableStream({
        pull(controller) {
            controller.enqueue(new TextEncoder().encode('[{"result"'));
            controller.error(new TypeError('network error'));
        },
    });
    answer(() => Promise.resolve(new Response(body)));
    await expect(fetchTracked('/api')).rejects.toThrow('network error');
    expect(useConnectionStore.getState().lost).toBe(true);
});

test('невалидный JSON, полученный целиком, — не потеря соединения', async () => {
    useConnectionStore.setState({ lost: true });
    answer(() => Promise.resolve(new Response('<html>')));
    const response = await fetchTracked('/api');
    expect(useConnectionStore.getState().lost).toBe(false);
    // тело остаётся доступным для tRPC
    expect(await response.text()).toBe('<html>');
});

test('«Соединение восстановлено» — один раз на восстановление', async () => {
    answer(() => Promise.resolve(new Response('[]')));

    // обычный ответ при доступной сети — без уведомления
    await fetchTracked('/api');
    expect(shownToast()).toBeUndefined();

    useConnectionStore.setState({ lost: true });
    await fetchTracked('/api');
    expect(shownToast()).toBe('Соединение восстановлено');
    expect(useConnectionStore.getState().lost).toBe(false);

    // следующие ответы — не новое восстановление
    useToastStore.setState({ toast: null });
    await fetchTracked('/api');
    expect(shownToast()).toBeUndefined();
});

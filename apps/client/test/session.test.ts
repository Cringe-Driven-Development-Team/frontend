// Смена сессии на настоящем клиенте tRPC: fetch управляется тестом, BFF не нужен.
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { SESSION_CHANGED, onSessionLost, switchSession, trpc } from '@api/trpc';
import { logout, useSessionStore } from '@stores/session';

type Answer = { status: number; body: unknown };

// Ответы fetch по процедуре; отложенный — пока тест не вызовет release
const answers = new Map<string, () => Promise<Answer>>();
const sessionLost = mock(() => useSessionStore.setState({ status: 'guest', user: null }));
const realFetch = globalThis.fetch;

const unauthorized: Answer = {
    status: 401,
    body: [{ error: { message: 'no session', code: -32001, data: { code: 'UNAUTHORIZED' } } }],
};
const ok = (data: unknown): Answer => ({ status: 200, body: [{ result: { data } }] });
const networkError = () => Promise.reject(new TypeError('Failed to fetch'));

/**
 * Ответ, который тест отпускает сам.
 * @param answer ответ после release
 * @returns ответ для answers и функция, отпускающая его
 */
function held(answer: Answer) {
    const { promise, resolve } = Promise.withResolvers<Answer>();
    return { answer: () => promise, release: () => resolve(answer) };
}

beforeEach(() => {
    answers.clear();
    sessionLost.mockClear();
    onSessionLost(sessionLost);
    useSessionStore.setState({
        status: 'authed',
        user: { id: 1, login: 'denis', avatar_url: null },
    });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const path = new URL(String(input), 'https://localhost').pathname.replace('/api/trpc/', '');
        const respond = answers.get(path);
        if (!respond) throw new Error(`нет ответа для ${path}`);
        const { status, body } = await respond();
        return Response.json(body, { status });
    }) as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

test('UNAUTHORIZED вне смены сессии — потеря сессии', async () => {
    answers.set('notebooks.list', async () => unauthorized);
    await expect(trpc.notebooks.list.query()).rejects.toThrow();
    expect(sessionLost).toHaveBeenCalledTimes(1);
});

test('UNAUTHORIZED во время выхода и сбой auth.logout — сессия потеряна, пользователь гость', async () => {
    const list = held(unauthorized);
    answers.set('notebooks.list', list.answer);
    answers.set('auth.logout', networkError);
    const listed = trpc.notebooks.list.query().catch(() => undefined);
    await Bun.sleep(0);

    const done = logout();
    await Bun.sleep(0);
    expect(sessionLost).not.toHaveBeenCalled();
    list.release();
    await listed;

    expect(await done).toBe(true);
    expect(sessionLost).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().status).toBe('guest');
});

test('UNAUTHORIZED во время выхода и удачный auth.logout — обычный выход без потери сессии', async () => {
    const list = held(unauthorized);
    answers.set('notebooks.list', list.answer);
    answers.set('auth.logout', async () => ok(null));
    const listed = trpc.notebooks.list.query().catch(() => undefined);
    await Bun.sleep(0);

    const done = logout();
    list.release();
    await listed;

    expect(await done).toBe(true);
    expect(sessionLost).not.toHaveBeenCalled();
    expect(useSessionStore.getState().status).toBe('guest');
});

test('сбой auth.logout без UNAUTHORIZED — выхода нет, сессия прежняя', async () => {
    answers.set('auth.logout', networkError);
    expect(await logout()).toBe(false);
    expect(sessionLost).not.toHaveBeenCalled();
    expect(useSessionStore.getState().status).toBe('authed');
});

test('факт потери не переживает смену сессии: следующий сбой выхода её не завершает', async () => {
    const list = held(unauthorized);
    answers.set('notebooks.list', list.answer);
    answers.set('auth.logout', async () => ok(null));
    const listed = trpc.notebooks.list.query().catch(() => undefined);
    await Bun.sleep(0);
    const first = switchSession(() => trpc.auth.logout.mutate());
    list.release();
    await listed;
    await first;

    useSessionStore.setState({
        status: 'authed',
        user: { id: 1, login: 'denis', avatar_url: null },
    });
    answers.set('auth.logout', networkError);
    expect(await logout()).toBe(false);
    expect(sessionLost).not.toHaveBeenCalled();
});

test('перекрывающиеся смены сессии идут по очереди: потеря сессии не теряется, запросы не пропускаются', async () => {
    const list = held(unauthorized);
    const firstLogout = held({ status: 500, body: [] });
    answers.set('notebooks.list', list.answer);
    answers.set('auth.logout', firstLogout.answer);
    const listed = trpc.notebooks.list.query().catch(() => undefined);
    await Bun.sleep(0);

    const first = switchSession(() => trpc.auth.logout.mutate()).catch(() => 'first failed');
    list.release();
    await listed;
    await Bun.sleep(0);

    // второй вызов, пока первый auth.logout ещё в пути
    let secondStarted = false;
    const second = switchSession(() => {
        secondStarted = true;
        return Promise.reject(new Error('второй выход не удался'));
    }).catch(() => 'second failed');
    await Bun.sleep(0);
    expect(secondStarted).toBe(false);
    // первая смена ещё идёт: новый защищённый запрос не стартует
    await expect(trpc.users.me.query()).rejects.toThrow(SESSION_CHANGED);

    firstLogout.release();
    expect(await first).toBe('first failed');
    expect(await second).toBe('second failed');
    expect(secondStarted).toBe(true);
    expect(sessionLost).toHaveBeenCalledTimes(1);
});

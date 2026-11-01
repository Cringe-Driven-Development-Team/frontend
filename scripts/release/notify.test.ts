import { afterEach, expect, test } from 'bun:test';
import { notify } from './notify.ts';

const realFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
});

test('карточка выкатки показывает полные SHA и digest', async () => {
    const sha = 'b'.repeat(40);
    const digest = 'c'.repeat(64);
    Object.assign(process.env, {
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_CHAT_ID: '1',
        GITHUB_REPOSITORY: 'owner/repo',
        RELEASE_IMAGE_REF: `ghcr.io/cringe-driven-development-team/bff@sha256:${digest}`,
        RELEASE_HEALTH_STATUS: 'success',
    });
    delete process.env.RELEASE_BEFORE_SHA;
    let text = '';
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        text = (JSON.parse(String(init?.body)) as { text: string }).text;
        return Response.json({ ok: true, result: { message_id: 1 } });
    }) as typeof fetch;
    await notify('deploy', 'success', sha);
    expect(text).toContain('✅ Выкатка фронта: успешно');
    expect(text).toContain(`<code>${sha}</code>`);
    expect(text).toContain(`<code>sha256:${digest}</code>`);
});

test('начало выкатки показывает текущего инициатора и run без запроса compare', async () => {
    const original = { ...process.env };
    Object.assign(process.env, {
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_CHAT_ID: '1',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_RUN_ID: '12',
        GITHUB_ACTOR: 'original',
        GITHUB_TRIGGERING_ACTOR: 'retry<&',
    });
    const messages: string[] = [];
    globalThis.fetch = (async (input, init) => {
        expect(String(input)).toContain('/sendMessage');
        messages.push((JSON.parse(String(init?.body)) as { text: string }).text);
        return Response.json({ ok: true, result: { message_id: 1 } });
    }) as typeof fetch;
    try {
        await notify('start', 'success', 'a'.repeat(40));
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain('началась');
        expect(messages[0]).toContain('a'.repeat(40));
        expect(messages[0]).toContain('retry&lt;&amp;');
        expect(messages[0]).toContain('/actions/runs/12');
        delete process.env.GITHUB_TRIGGERING_ACTOR;
        await notify('start', 'success', 'b'.repeat(40));
        expect(messages[1]).toContain('original');
    } finally {
        for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
        Object.assign(process.env, original);
    }
});

test.each([
    ['publish', 'Заливка'],
    ['rollback', 'Откат'],
])('CLI %s сохраняет русский текст уведомления', async (kind, label) => {
    Object.assign(process.env, {
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_CHAT_ID: '1',
        GITHUB_REPOSITORY: 'owner/repo',
    });
    let text = '';
    globalThis.fetch = (async (_input, init) => {
        text = (JSON.parse(String(init?.body)) as { text: string }).text;
        return Response.json({ ok: true, result: { message_id: 1 } });
    }) as typeof fetch;
    await notify(kind, 'failure');
    expect(text).toContain(`❌ ${label} фронта: ошибка`);
});

test('неизвестный тип уведомления отклоняется до отправки', async () => {
    globalThis.fetch = (async (
        _input: string | URL | Request,
        _init?: RequestInit,
    ): Promise<Response> => {
        throw new Error('уведомление не должно отправляться');
    }) as typeof fetch;
    await expect(notify('unknown', 'success')).rejects.toThrow('Неизвестный тип уведомления');
});

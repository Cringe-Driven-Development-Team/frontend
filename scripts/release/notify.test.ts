import { afterEach, expect, test } from 'bun:test';
import { notify } from './notify.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
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
    await notify('Выкатка', 'success', sha);
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
        await notify('Начало', 'success', 'a'.repeat(40));
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain('началась');
        expect(messages[0]).toContain('a'.repeat(40));
        expect(messages[0]).toContain('retry&lt;&amp;');
        expect(messages[0]).toContain('/actions/runs/12');
        delete process.env.GITHUB_TRIGGERING_ACTOR;
        await notify('Начало', 'success', 'b'.repeat(40));
        expect(messages[1]).toContain('original');
    } finally {
        for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
        Object.assign(process.env, original);
    }
});

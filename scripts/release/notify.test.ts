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

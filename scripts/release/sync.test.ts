import { afterEach, beforeEach, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as sync from './sync.ts';
import { prepareNotifications } from './notification-sync.ts';
import { sendPending } from './journal.ts';
import { fixture, REPO } from './test/fixture.ts';

let f: ReturnType<typeof fixture>;
beforeEach(() => {
    f = fixture();
    Object.assign(process.env, {
        GITHUB_REF: 'refs/heads/main',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_EVENT_PATH: join(f.dir, 'event.json'),
        GITHUB_RUN_ID: '999',
        GITHUB_STEP_SUMMARY: join(f.dir, 'summary.md'),
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_CHAT_ID: '1',
    });
    writeFileSync(
        process.env.GITHUB_EVENT_PATH!,
        JSON.stringify({ repository: { full_name: REPO } }),
    );
});
afterEach(() => f.restore());

test('board entrypoint игнорирует enqueue без чтения данных и записи журнала', async () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request_target';
    writeFileSync(
        process.env.GITHUB_EVENT_PATH!,
        JSON.stringify({
            repository: { full_name: REPO },
            action: 'enqueued',
            pull_request: { number: 1, base: { ref: 'main' }, updated_at: '2026-11-01T02:00:00Z' },
        }),
    );
    expect((await sync.reconcileBoard(f.dir)).allowed).toBe(false);
    expect(f.requests).toHaveLength(0);
    expect(f.records['release-automation']).toHaveLength(0);
});

test('заблокированный Project API не задерживает уведомление, доска возвращает свою ошибку', async () => {
    f.publish();
    process.env.GITHUB_EVENT_NAME = 'workflow_run';
    writeFileSync(
        process.env.GITHUB_EVENT_PATH!,
        JSON.stringify({
            repository: { full_name: REPO },
            workflow_run: { id: 1, event: 'push', head_branch: 'main' },
        }),
    );
    let entered!: () => void;
    let release!: () => void;
    const began = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let posts = 0;
    f.extra = (url, body) => {
        if (String(body?.query).includes('ReleaseProject')) {
            entered();
            return gate.then(() => Response.json({ errors: [{ message: 'denied' }] }));
        }
        if (url.pathname.endsWith('/sendMessage')) {
            posts++;
            return Response.json({ ok: true, result: { message_id: 7 } });
        }
    };
    const board = sync.reconcileBoard(f.dir);
    try {
        await began;
        expect(f.records['release-automation']).toHaveLength(0);
        const result = await prepareNotifications(f.dir, 'current');
        expect(result.errors).toEqual([]);
        await sendPending(f.dir, 'ready', result.firstKey);
        expect(posts).toBe(1);
    } finally {
        release();
    }
    expect((await board).errors).toHaveLength(1);
    expect(f.requests.filter((r) => String(r.body?.query).includes('ReleaseProject'))).toHaveLength(
        1,
    );
    expect(f.requests.some((r) => String(r.body?.query).includes('UpdateReleaseStatus'))).toBe(
        false,
    );
});

test('недоверенный source не запускает board и не создаёт baseline', async () => {
    process.env.GITHUB_REF = 'refs/heads/feature';
    expect((await sync.reconcileBoard(f.dir)).allowed).toBe(false);
    expect(f.requests).toHaveLength(0);
    expect(f.records['release-automation']).toHaveLength(0);
});

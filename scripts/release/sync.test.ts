import { afterEach, beforeEach, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareAutomation } from './sync.ts';
import { queueMessage, readyMessage } from './notify.ts';
import { sendPending } from './journal.ts';
import { fixture, IMAGE, REPO } from './test/fixture.ts';

let f: ReturnType<typeof fixture>;
let events: { id: string; createdAt: string; mergeQueue: { id: string } }[];
let projectAllowed: boolean;
let posts: number;
let queueReads: number;
let hideQueue: number;
function setEvent(event: object) {
    writeFileSync(process.env.GITHUB_EVENT_PATH!, JSON.stringify(event));
}
beforeEach(() => {
    f = fixture();
    f.publish(f.a, 1, '2026-10-31T23:00:00Z');
    f.publish(f.b, 2);
    events = [];
    projectAllowed = true;
    posts = 0;
    queueReads = 0;
    hideQueue = 0;
    Object.assign(process.env, {
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_RUN_ID: '999',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_EVENT_PATH: join(f.dir, 'event.json'),
        GITHUB_STEP_SUMMARY: join(f.dir, 'summary.md'),
        GITHUB_OUTPUT: join(f.dir, 'output'),
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_CHAT_ID: '1',
    });
    setEvent({ repository: { full_name: REPO } });
    f.extra = (url, body) => {
        if (url.pathname.endsWith('/sendMessage')) {
            posts++;
            return Response.json({ ok: true, result: { message_id: posts } });
        }
        if (url.pathname !== '/graphql') return;
        const query = String(body?.query);
        const vars = body?.variables as { number?: number };
        if (query.includes('LinkedIssues'))
            return Response.json({
                data: {
                    repository: {
                        pullRequest: {
                            closingIssuesReferences: {
                                nodes: [],
                                pageInfo: { hasNextPage: false },
                            },
                        },
                    },
                },
            });
        if (query.includes('ReleaseProject'))
            return Response.json({
                data: {
                    organization: {
                        projectV2: {
                            id: 'P',
                            viewerCanUpdate: projectAllowed,
                            fields: {
                                nodes: [
                                    {
                                        id: 'F',
                                        name: 'Status',
                                        options: [
                                            { id: 'ready', name: 'Ready for release' },
                                            { id: 'done', name: 'Done' },
                                        ],
                                    },
                                ],
                                pageInfo: { hasNextPage: false },
                            },
                        },
                    },
                },
            });
        if (query.includes('MainQueue'))
            return Response.json({ data: { repository: { mergeQueue: { id: 'Q' } } } });
        if (query.includes('QueueEvents')) {
            queueReads++;
            return Response.json({
                data: {
                    repository: {
                        pullRequest: {
                            timelineItems: {
                                nodes: vars.number === 1 && queueReads > hideQueue ? events : [],
                                pageInfo: { hasNextPage: false },
                            },
                        },
                    },
                },
            });
        }
    };
});
afterEach(() => f.restore());

test('новый выпуск перечисляет PR пропущенной публикации, отправка отдельная', async () => {
    const result = await prepareAutomation(f.dir);
    expect(result.allowed).toBe(true);
    expect(result.errors).toEqual([]);
    const receipts = f.records['release-automation']!.map(
        (record) => record.payload as { kind: string; prNumbers?: number[] },
    );
    expect(
        receipts.filter((record) => record.kind === 'ready').map((record) => record.prNumbers),
    ).toEqual([[2]]);
    expect(readFileSync(process.env.GITHUB_STEP_SUMMARY!, 'utf8')).toContain('/pull/2');
    expect(posts).toBe(0);
    expect((await sendPending(f.dir)).sent).toBe(1);
    await prepareAutomation(f.dir);
    await sendPending(f.dir);
    expect(posts).toBe(1);
});

test('ошибка доски не скрывает готовый выпуск и отчёт', async () => {
    projectAllowed = false;
    const result = await prepareAutomation(f.dir);
    expect(result.errors).toHaveLength(1);
    expect(result.prepared).toBe(1);
    expect(readFileSync(process.env.GITHUB_STEP_SUMMARY!, 'utf8')).toContain(f.b);
    expect((await sendPending(f.dir)).sent).toBe(1);
});

test('очередь использует каждый реальный event ID, включая повторное добавление', async () => {
    events = [
        { id: 'E1', createdAt: '2026-11-01T00:00:00Z', mergeQueue: { id: 'Q' } },
        { id: 'E2', createdAt: '2026-11-01T02:00:00Z', mergeQueue: { id: 'Q' } },
        { id: 'old', createdAt: '2026-10-31T00:00:00Z', mergeQueue: { id: 'Q' } },
        { id: 'other', createdAt: '2026-11-01T00:00:00Z', mergeQueue: { id: 'OTHER' } },
    ];
    await prepareAutomation(f.dir);
    await prepareAutomation(f.dir);
    const keys = f.records['release-automation']!.map(
        (row) => (row.payload as { key: string }).key,
    );
    expect(keys.filter((key) => key.startsWith('queue:'))).toEqual(['queue:E1', 'queue:E2']);
});

test('первый выпуск на границе включения не поглощается, равное время упорядочено по ID', async () => {
    f.records['release-artifacts'] = [];
    f.publish(f.b, 2, '2026-11-01T00:00:00Z');
    f.publish(f.a, 1, '2026-11-01T00:00:00Z');
    await prepareAutomation(f.dir);
    const ready = f.records['release-automation']!.map(
        (row) => row.payload as { kind: string; prNumbers: number[] },
    ).filter((row) => row.kind === 'ready');
    expect(ready.map((row) => row.prNumbers)).toEqual([[1], [2]]);
});

test('уже выкаченный SHA не объявляется ожидающим', async () => {
    f.deploy(f.b);
    const result = await prepareAutomation(f.dir);
    expect(result.prepared).toBe(0);
});

test('недоверенные события не создают записи', async () => {
    for (const name of ['pull_request', 'merge_group']) {
        process.env.GITHUB_EVENT_NAME = name;
        expect((await prepareAutomation(f.dir)).allowed).toBe(false);
    }
    process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
    process.env.GITHUB_REF = 'refs/heads/feature';
    expect((await prepareAutomation(f.dir)).allowed).toBe(false);
    process.env.GITHUB_REF = 'refs/heads/main';
    process.env.GITHUB_EVENT_NAME = 'workflow_run';
    setEvent({
        repository: { full_name: REPO },
        workflow_run: { id: 2, event: 'pull_request', head_branch: 'main' },
    });
    expect((await prepareAutomation(f.dir)).allowed).toBe(false);
    expect(f.records['release-automation']).toEqual([]);
});

test('workflow_run проверяется через Actions API, failure conclusion не запрещает выпуск', async () => {
    process.env.GITHUB_EVENT_NAME = 'workflow_run';
    setEvent({
        repository: { full_name: REPO },
        workflow_run: { id: 2, event: 'push', head_branch: 'main' },
    });
    expect((await prepareAutomation(f.dir)).allowed).toBe(true);
    expect(f.requests.some((request) => request.url.pathname.endsWith('/actions/runs/2'))).toBe(
        true,
    );
});

test('свежий enqueue ждёт появления timeline', async () => {
    events = [{ id: 'E1', createdAt: '2026-11-01T02:00:00Z', mergeQueue: { id: 'Q' } }];
    hideQueue = 3;
    process.env.GITHUB_EVENT_NAME = 'pull_request_target';
    setEvent({
        action: 'enqueued',
        repository: { full_name: REPO },
        pull_request: { number: 1, base: { ref: 'main' }, updated_at: '2026-11-01T02:00:00Z' },
    });
    const realSleep = Bun.sleep;
    Bun.sleep = (async () => {}) as typeof Bun.sleep;
    try {
        expect((await prepareAutomation(f.dir)).errors).toEqual([]);
    } finally {
        Bun.sleep = realSleep;
    }
    expect(queueReads).toBeGreaterThan(3);
});

test('формат готовности безопасен и не обрезает переполненный список', () => {
    const release = {
        id: 1,
        sha: f.b,
        imageRef: IMAGE,
        ciRun: `https://github.com/${REPO}/actions/runs/2`,
        readyAt: '2026-11-01T02:00:00Z',
        prNumbers: [1, 2],
    };
    const normal = readyMessage(
        release,
        [{ number: 2, url: `https://github.com/${REPO}/pull/2`, mergeSha: f.b }],
        'https://github.com/report',
    );
    expect(normal.text).toContain(f.b);
    expect(normal.text).toContain('/pull/2');
    expect(JSON.stringify(normal.keyboard)).toContain('Выкатить');
    const long = readyMessage(
        release,
        Array.from({ length: 2000 }, (_, i) => ({
            number: i + 1,
            url: `https://github.com/${REPO}/pull/${i + 1}`,
            mergeSha: f.b,
        })),
        'https://github.com/report',
    );
    expect(long.text).toContain('2000');
    expect(long.text).toContain('Все PR выпуска');
    expect(long.text.length).toBeLessThan(4096);
    expect(queueMessage({ number: 1, url: 'https://github.com/?x="<&' }).text).toContain(
        '&quot;&lt;&amp;',
    );
});

test('CLI sync и notify-pending работают отдельными шагами на локальном HTTP', async () => {
    const fake = globalThis.fetch;
    const server = Bun.serve({
        port: 0,
        async fetch(request) {
            const text = await request.text();
            return fake(request.url, {
                method: request.method,
                headers: request.headers,
                ...(text ? { body: text } : {}),
            });
        },
    });
    const cli = join(import.meta.dir, 'index.ts');
    const cliEnv = {
        ...process.env,
        GITHUB_API_URL: server.url.origin,
        GITHUB_GRAPHQL_URL: `${server.url.origin}/graphql`,
        TELEGRAM_API: server.url.origin,
    };
    const run = async (command: string) => {
        const proc = Bun.spawn(['bun', cli, command], {
            cwd: f.dir,
            env: cliEnv,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const [out, err, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        expect({ code, err }).toEqual({ code: 0, err: '' });
        return out;
    };
    try {
        await run('sync');
        expect(posts).toBe(0);
        expect(readFileSync(process.env.GITHUB_OUTPUT!, 'utf8')).toContain('allowed=true');
        await run('notify-pending');
        expect(posts).toBe(1);
        await run('notify-pending');
        expect(posts).toBe(1);
    } finally {
        await server.stop(true);
    }
});

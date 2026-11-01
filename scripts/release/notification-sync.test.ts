import { afterEach, beforeEach, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as notifications from './notification-sync.ts';
import { queueMessage, readyMessage } from './notify.ts';
import { prepareNotice, sendPending } from './journal.ts';
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
    const result = await notifications.prepareNotifications(f.dir, 'recover');
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
    await notifications.prepareNotifications(f.dir, 'recover');
    await sendPending(f.dir);
    expect(posts).toBe(1);
});

test('ошибка доски не скрывает готовый выпуск и отчёт', async () => {
    projectAllowed = false;
    const result = await notifications.prepareNotifications(f.dir, 'recover');
    expect(result.errors).toEqual([]);
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
    await notifications.prepareNotifications(f.dir, 'recover');
    await notifications.prepareNotifications(f.dir, 'recover');
    const keys = f.records['release-automation']!.map(
        (row) => (row.payload as { key: string }).key,
    );
    expect(keys.filter((key) => key.startsWith('queue:'))).toEqual(['queue:E1', 'queue:E2']);
});

test('первый выпуск на границе включения не поглощается, равное время упорядочено по ID', async () => {
    f.records['release-artifacts'] = [];
    f.publish(f.b, 2, '2026-11-01T00:00:00Z');
    f.publish(f.a, 1, '2026-11-01T00:00:00Z');
    await notifications.prepareNotifications(f.dir, 'recover');
    const ready = f.records['release-automation']!.map(
        (row) => row.payload as { kind: string; prNumbers: number[] },
    ).filter((row) => row.kind === 'ready');
    expect(ready.map((row) => row.prNumbers)).toEqual([[1], [2]]);
});

test('уже выкаченный SHA не объявляется ожидающим', async () => {
    f.deploy(f.b);
    const result = await notifications.prepareNotifications(f.dir, 'recover');
    expect(result.prepared).toBe(0);
});

test('недоверенные события не создают записи', async () => {
    for (const name of ['pull_request', 'merge_group']) {
        process.env.GITHUB_EVENT_NAME = name;
        expect((await notifications.prepareNotifications(f.dir, 'recover')).allowed).toBe(false);
    }
    process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
    process.env.GITHUB_REF = 'refs/heads/feature';
    expect((await notifications.prepareNotifications(f.dir, 'recover')).allowed).toBe(false);
    process.env.GITHUB_REF = 'refs/heads/main';
    process.env.GITHUB_EVENT_NAME = 'workflow_run';
    setEvent({
        repository: { full_name: REPO },
        workflow_run: { id: 2, event: 'pull_request', head_branch: 'main' },
    });
    expect((await notifications.prepareNotifications(f.dir, 'recover')).allowed).toBe(false);
    expect(f.records['release-automation']).toEqual([]);
});

test('workflow_run проверяется через Actions API, failure conclusion не запрещает выпуск', async () => {
    process.env.GITHUB_EVENT_NAME = 'workflow_run';
    setEvent({
        repository: { full_name: REPO },
        workflow_run: { id: 2, event: 'push', head_branch: 'main' },
    });
    expect((await notifications.prepareNotifications(f.dir, 'recover')).allowed).toBe(true);
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
        expect((await notifications.prepareNotifications(f.dir, 'current')).errors).toEqual([]);
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

function enqueue(number = 1) {
    process.env.GITHUB_EVENT_NAME = 'pull_request_target';
    setEvent({
        action: 'enqueued',
        repository: { full_name: REPO },
        pull_request: { number, base: { ref: 'main' }, updated_at: '2026-11-01T02:00:00Z' },
    });
}
function ci(id = 2) {
    process.env.GITHUB_EVENT_NAME = 'workflow_run';
    setEvent({
        repository: { full_name: REPO },
        workflow_run: { id, event: 'push', head_branch: 'main' },
    });
}

test('current enqueue отправляется без задач и истории, старый ready остаётся pending', async () => {
    await prepareNotice({
        kind: 'ready',
        key: `ready:${f.b}`,
        ref: f.b,
        source: 'CI',
        message: { text: 'Old release' },
        prNumbers: [2],
        reportUrl: 'https://github.com/report',
    });
    events = [
        { id: 'current', createdAt: '2026-11-01T02:00:00Z', mergeQueue: { id: 'Q' } },
        { id: 'later', createdAt: '2026-11-01T03:00:00Z', mergeQueue: { id: 'Q' } },
    ];
    enqueue();
    f.requests.length = 0;
    const result = await notifications.prepareNotifications(f.dir, 'current');
    expect(result.errors).toEqual([]);
    expect(result.firstKey).toBe('queue:current');
    expect(result.kind).toBe('queue');
    expect(result.prepared).toBe(1);
    await sendPending(f.dir, 'queue', result.firstKey);
    expect(posts).toBe(1);
    expect(f.statuses.get(1000)?.[0]?.state).toBe('pending');
    expect(
        f.requests.some(
            (r) =>
                r.url.searchParams.get('environment') === 'production' ||
                r.url.searchParams.get('environment') === 'release-artifacts' ||
                /LinkedIssues|BoardIssue|ReleaseProject/.test(String(r.body?.query)),
        ),
    ).toBe(false);
    expect(f.requests.some((r) => r.url.pathname.endsWith('/pulls'))).toBe(false);
    await notifications.prepareNotifications(f.dir, 'recover');
    await sendPending(f.dir, 'queue');
    expect(posts).toBe(2);
    await notifications.prepareNotifications(f.dir, 'recover');
    await sendPending(f.dir, 'queue');
    expect(posts).toBe(2);
});

test('текущий CI доставляется раньше восстановления старой публикации', async () => {
    f.records['release-artifacts'] = [];
    f.publish(f.a, 1, '2026-11-01T01:00:00Z');
    f.publish(f.b, 2, '2026-11-01T02:00:00Z');
    ci();
    const result = await notifications.prepareNotifications(f.dir, 'current');
    expect(result.firstKey).toBe(`ready:${f.b}`);
    const receipts = f.records['release-automation']!.filter(
        (r) => (r.payload as { kind: string }).kind === 'ready',
    );
    expect(receipts.map((r) => (r.payload as { prNumbers: number[] }).prNumbers)).toEqual([[2]]);
    expect(await sendPending(f.dir, 'ready', result.firstKey)).toMatchObject({
        sent: 1,
        errors: [],
    });
    const original = f.extra;
    f.extra = (url, body, init) =>
        url.pathname.endsWith('/pulls')
            ? Response.json({}, { status: 503 })
            : original?.(url, body, init);
    expect(
        (await notifications.prepareNotifications(f.dir, 'recover')).errors.length,
    ).toBeGreaterThan(0);
    expect(posts).toBe(1);
});

test.each(['missing', 'other-run'])(
    'current CI без своей публикации %s не создаёт ready',
    async (kind) => {
        ci();
        if (kind === 'missing')
            f.records['release-artifacts'] = f.records['release-artifacts']!.filter(
                (r) => r.sha !== f.b,
            );
        else {
            const record = f.records['release-artifacts']!.find((r) => r.sha === f.b)!;
            (record.payload as { ci_run: string }).ci_run =
                `https://github.com/${REPO}/actions/runs/99`;
            f.runs.set(99, { ...f.runs.get(2), id: 99 });
        }
        const result = await notifications.prepareNotifications(f.dir, 'current');
        expect(result.errors).toEqual([]);
        expect(result.prepared).toBe(0);
        expect(result.firstKey).toBeUndefined();
    },
);

test('current/recover ready и доставка не читают issues и Project API', async () => {
    ci();
    const original = f.extra;
    f.extra = (url, body, init) =>
        /LinkedIssues|ReleaseProject|BoardIssue/.test(String(body?.query))
            ? Response.json({ errors: [{ message: 'forbidden' }] })
            : original?.(url, body, init);
    const result = await notifications.prepareNotifications(f.dir, 'current');
    expect(result.errors).toEqual([]);
    expect((await sendPending(f.dir, 'ready', result.firstKey)).sent).toBe(1);
    expect((await notifications.prepareNotifications(f.dir, 'recover')).errors).toEqual([]);
    expect(
        f.requests.some((r) =>
            /LinkedIssues|ReleaseProject|BoardIssue/.test(String(r.body?.query)),
        ),
    ).toBe(false);
    expect(readFileSync(process.env.GITHUB_STEP_SUMMARY!, 'utf8')).toContain('/pull/2');
    expect(readFileSync(process.env.GITHUB_STEP_SUMMARY!, 'utf8')).toContain('/actions/runs/2');
});

test('вытесненный enqueue другого PR восстанавливается через все страницы timeline', async () => {
    const original = f.extra;
    f.pulls.push(...Array.from({ length: 100 }, (_, i) => ({ ...f.pulls[0]!, number: i + 4 })));
    f.extra = (url, body, init) =>
        String(body?.query).includes('QueueEvents') &&
        (body!.variables as { number: number }).number === 103
            ? Response.json({
                  data: {
                      repository: {
                          pullRequest: {
                              timelineItems: {
                                  nodes: [
                                      {
                                          id: 'missed',
                                          createdAt: '2026-11-01T02:00:00Z',
                                          mergeQueue: { id: 'Q' },
                                      },
                                  ],
                                  pageInfo: { hasNextPage: false },
                              },
                          },
                      },
                  },
              })
            : original?.(url, body, init);
    const result = await notifications.prepareNotifications(f.dir, 'recover');
    expect(result.errors).toEqual([]);
    expect(
        f.records['release-automation']!.some(
            (r) => (r.payload as { key: string }).key === 'queue:missed',
        ),
    ).toBe(true);
});

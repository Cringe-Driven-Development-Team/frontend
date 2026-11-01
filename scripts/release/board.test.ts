import { afterEach, beforeEach, expect, test } from 'bun:test';
import { syncBoard } from './board.ts';
import { readReleaseSnapshot } from './catalog.ts';
import { fixture, REPO } from './test/fixture.ts';

let f: ReturnType<typeof fixture>;
const now = Date.now;
const sleep = Bun.sleep;
const closedAt = '2026-11-01T01:00:00Z';
let clock: number;
let writes: { issue: number; status: string }[];
let states: Map<
    number,
    {
        closed: boolean;
        title: string;
        status: string;
        statusAt: string;
        closer: number | null;
        reopened: boolean;
        card: boolean;
        repo: string;
        reason: string;
    }
>;
let canUpdate: boolean;
let read: ((number: number) => void) | undefined;

beforeEach(() => {
    f = fixture();
    f.publish();
    f.deploy();
    clock = 0;
    Date.now = () => clock;
    Bun.sleep = (async () => {
        clock += 10_000;
    }) as typeof Bun.sleep;
    writes = [];
    states = new Map();
    canUpdate = true;
    read = undefined;
    for (const number of [1, 2])
        states.set(number, {
            closed: true,
            title: 'Frontend. Test',
            status: 'Done',
            statusAt: closedAt,
            closer: number,
            reopened: false,
            card: true,
            repo: REPO,
            reason: 'COMPLETED',
        });
    f.extra = (url, body) => {
        if (url.pathname !== '/graphql') return;
        const query = String(body?.query);
        const vars = body?.variables as { id?: string; option?: string; item?: string };
        if (query.includes('ReleaseProject'))
            return Response.json({
                data: {
                    organization: {
                        projectV2: {
                            id: 'P',
                            viewerCanUpdate: canUpdate,
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
        if (query.includes('UpdateReleaseStatus')) {
            const number = Number(vars.item?.slice(1));
            const status = vars.option === 'ready' ? 'Ready for release' : 'Done';
            writes.push({ issue: number, status });
            states.get(number)!.status = status;
            return Response.json({
                data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: vars.item } } },
            });
        }
        const number = Number(vars.id?.slice(1));
        const state = states.get(number);
        if (!state) return;
        if (query.includes('BoardIssue')) {
            read?.(number);
            return Response.json({
                data: {
                    node: {
                        closed: state.closed,
                        stateReason: state.reason,
                        title: state.title,
                        repository: { nameWithOwner: state.repo },
                        timelineItems: {
                            nodes: [
                                {
                                    kind: 'ClosedEvent',
                                    createdAt: closedAt,
                                    closer: state.closer
                                        ? {
                                              kind: 'PullRequest',
                                              number: state.closer,
                                              repository: { nameWithOwner: REPO },
                                          }
                                        : null,
                                },
                                ...(state.reopened
                                    ? [
                                          {
                                              kind: 'ReopenedEvent',
                                              createdAt: '2026-11-01T02:00:00Z',
                                          },
                                      ]
                                    : []),
                            ],
                            pageInfo: { hasPreviousPage: false },
                        },
                    },
                },
            });
        }
        if (query.includes('BoardCard'))
            return Response.json({
                data: {
                    node: {
                        projectItems: {
                            nodes: state.card
                                ? [
                                      {
                                          id: `C${number}`,
                                          project: { id: 'P' },
                                          fieldValueByName: {
                                              name: state.status,
                                              updatedAt: state.statusAt,
                                          },
                                      },
                                  ]
                                : [],
                            pageInfo: { hasNextPage: false },
                        },
                    },
                },
            });
    };
});
afterEach(() => {
    Date.now = now;
    Bun.sleep = sleep;
    f.restore();
});

test('первый запуск подхватывает только опубликованную и ещё не выкаченную задачу', async () => {
    const snapshot = await readReleaseSnapshot(f.dir);
    expect((await syncBoard(snapshot, f.dir)).errors).toEqual([]);
    expect(writes).toEqual([{ issue: 2, status: 'Ready for release' }]);
    await syncBoard(snapshot, f.dir);
    expect(writes).toHaveLength(1);
});

test('выкатка и последующий откат не возвращают карточку в ожидание', async () => {
    states.get(2)!.status = 'Ready for release';
    f.deploy(f.b, 21);
    f.deploy(f.a, 22);
    await syncBoard(await readReleaseSnapshot(f.dir), f.dir);
    expect(writes).toEqual([{ issue: 2, status: 'Done' }]);
});

test('ожидает закрытия и обновления Done после ClosedEvent', async () => {
    const state = states.get(2)!;
    state.closed = false;
    state.statusAt = '2026-10-31T00:00:00Z';
    let reads = 0;
    read = (number) => {
        if (number === 2) {
            reads++;
            if (reads >= 2) state.closed = true;
            if (reads >= 3) state.statusAt = closedAt;
        }
    };
    const result = await syncBoard(await readReleaseSnapshot(f.dir), f.dir);
    expect(result.errors).toEqual([]);
    expect(clock).toBeGreaterThan(0);
    expect(writes).toEqual([{ issue: 2, status: 'Ready for release' }]);
});

test('пять минут без подтверждённого Done завершаются ошибкой без записи', async () => {
    states.get(2)!.statusAt = '2026-10-31T00:00:00Z';
    const result = await syncBoard(await readReleaseSnapshot(f.dir), f.dir);
    expect(result.errors.join()).toContain('300000');
    expect(writes).toEqual([]);
});

test('ручные статусы, чужие задачи и ручное закрытие сохраняются', async () => {
    const state = states.get(2)!;
    const original = { ...state };
    for (const patch of [
        { status: 'Ready for test' },
        { status: 'In testing' },
        { status: 'Ready for build' },
        { title: 'Backend. Test' },
        { repo: 'other/repo' },
        { closer: null },
        { reason: 'NOT_PLANNED' },
        { reopened: true, closed: false },
    ]) {
        Object.assign(state, original, patch);
        expect((await syncBoard(await readReleaseSnapshot(f.dir), f.dir)).errors).toEqual([]);
    }
    expect(writes).toEqual([]);
});

test('переоткрытие непосредственно перед записью отменяет изменение', async () => {
    let reads = 0;
    read = (number) => {
        if (number === 2 && ++reads >= 2) {
            states.get(2)!.closed = false;
            states.get(2)!.reopened = true;
        }
    };
    await syncBoard(await readReleaseSnapshot(f.dir), f.dir);
    expect(writes).toEqual([]);
});

test('успешная выкатка во время синхронизации не оставляет устаревший статус', async () => {
    const snapshot = await readReleaseSnapshot(f.dir);
    let changed = false;
    read = (number) => {
        if (number === 2 && !changed) {
            changed = true;
            f.deploy(f.b, 21);
        }
    };
    const result = await syncBoard(snapshot, f.dir);
    expect(result.errors).toEqual([]);
    expect(states.get(2)!.status).toBe('Done');
});

test('нет карточки или прав PAT — видимая ошибка без посторонних mutations', async () => {
    states.get(2)!.card = false;
    expect((await syncBoard(await readReleaseSnapshot(f.dir), f.dir)).errors.join()).toContain(
        'карточ',
    );
    canUpdate = false;
    await expect(syncBoard(await readReleaseSnapshot(f.dir), f.dir)).rejects.toThrow('Project');
    expect(writes).toEqual([]);
});

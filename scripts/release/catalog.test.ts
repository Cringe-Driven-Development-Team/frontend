import { afterEach, beforeEach, expect, test } from 'bun:test';
import { activationTime, isDeployed, readReleaseSnapshot, readTrustedRun } from './catalog.ts';
import * as catalog from './catalog.ts';
import { graphql, listDeploymentStatuses } from './github.ts';
import { fixture, git, IMAGE } from './test/fixture.ts';

let f: ReturnType<typeof fixture>;
beforeEach(() => {
    f = fixture();
});
afterEach(() => f.restore());

test('выпуск включает merged PR по графу, включая base другой ветки', async () => {
    f.publish();
    f.deploy();
    const result = await readReleaseSnapshot(f.dir);
    expect(result.published.find((release) => release.sha === f.b)?.prNumbers).toEqual([1, 2]);
    expect([...result.deployed]).toEqual([1]);
    expect(result.issues.map((issue) => issue.number)).toEqual([1, 2]);
});

test('незавершённая публикация не создаёт готовый выпуск', async () => {
    f.publish();
    f.statuses.set(1, [{ state: 'in_progress', created_at: '2026-11-01T02:00:00Z' }]);
    expect((await readReleaseSnapshot(f.dir)).published).toEqual([]);
});

test('автоматическая environment запись без контракта BFF не является выкаткой', async () => {
    f.publish();
    f.deploy();
    f.records.production!.push({
        id: 99,
        sha: f.b,
        payload: {},
        created_at: '2026-11-01T04:00:00Z',
    });
    f.statuses.set(99, [{ state: 'success', created_at: '2026-11-01T04:00:00Z' }]);
    expect([...(await readReleaseSnapshot(f.dir)).deployed]).toEqual([1]);
});

test('один SHA с разными digest и выпуск вне main отклоняются', async () => {
    f.publish();
    const row = f.publish(f.b, 2);
    row.payload.image_ref = IMAGE.replace(/a{64}$/, 'b'.repeat(64));
    await expect(readReleaseSnapshot(f.dir)).rejects.toThrow('разными образами');
    f.records['release-artifacts'] = [];
    f.publish(f.outside);
    await expect(readReleaseSnapshot(f.dir)).rejects.toThrow('main');
});

test('доверенный CI/CD определяется источником, а не общим conclusion', async () => {
    f.publish();
    f.deploy();
    expect((await readTrustedRun(1)).kind).toBe('publish');
    expect((await readTrustedRun(20)).kind).toBe('deploy');
    for (const patch of [
        { event: 'pull_request' },
        { head_branch: 'parent' },
        { head_repository: { full_name: 'evil/fork' } },
        { repository: { full_name: 'evil/repo' } },
        { workflow_id: 999 },
        { path: '.github/workflows/evil.yml' },
    ]) {
        const old = f.runs.get(1)!;
        f.runs.set(1, { ...old, ...patch });
        await expect(readTrustedRun(1)).rejects.toThrow();
        f.runs.set(1, old);
    }
});

test('URL чужого run не используется для внешнего запроса', async () => {
    const row = f.publish();
    row.payload.ci_run = 'https://evil.invalid/actions/runs/1';
    await expect(readReleaseSnapshot(f.dir)).rejects.toThrow();
    expect(f.requests.some((request) => request.url.hostname === 'evil.invalid')).toBe(false);
});

test('вся production история сохраняет ранее выкаченные изменения при откате', async () => {
    f.publish();
    f.deploy(f.b);
    const old = f.deploy(f.a, 21);
    old.payload.action = 'rollback';
    f.runs.set(21, { ...f.runs.get(21), workflow_id: 102, path: '.github/workflows/rollback.yml' });
    expect([...(await readReleaseSnapshot(f.dir)).deployed]).toEqual([1, 2]);
    expect(await isDeployed(f.b, [f.a], f.dir)).toBe(false);
    expect(await isDeployed(f.a, [f.b], f.dir)).toBe(true);
});

test('GraphQL errors при HTTP 200 не становятся пустым результатом', async () => {
    f.extra = (url) =>
        url.pathname === '/graphql'
            ? Response.json({ errors: [{ message: 'denied' }] })
            : undefined;
    await expect(graphql('query X { viewer { login } }', {}, 'private-token')).rejects.toThrow(
        'GraphQL',
    );
});

test('все страницы statuses и PR/closing issues читаются целиком', async () => {
    f.publish();
    f.statuses.set(
        1,
        Array.from({ length: 101 }, (_, i) => ({
            state: i === 100 ? 'success' : 'pending',
            created_at: '2026-11-01T02:00:00Z',
            description: '',
        })),
    );
    expect(await listDeploymentStatuses(1)).toHaveLength(101);
    f.statuses.set(1, [{ state: 'success', created_at: '2026-11-01T02:00:00Z', description: '' }]);
    const original = f.pulls[0]!;
    f.pulls.splice(
        0,
        f.pulls.length,
        ...Array.from({ length: 230 }, (_, i) => ({ ...original, number: i + 1 })),
    );
    f.extra = (url, body) => {
        if (url.pathname !== '/graphql') return;
        const variables = body?.variables as { number: number; cursor?: string };
        const second = Boolean(variables.cursor);
        return Response.json({
            data: {
                repository: {
                    pullRequest: {
                        closingIssuesReferences: {
                            nodes: [
                                {
                                    id: `I${variables.number}-${second}`,
                                    number: variables.number * 2 + Number(second),
                                    title: 'BFF. Test',
                                    repository: { nameWithOwner: process.env.GITHUB_REPOSITORY },
                                },
                            ],
                            pageInfo: { hasNextPage: !second, endCursor: 'next' },
                        },
                    },
                },
            },
        });
    };
    const snapshot = await readReleaseSnapshot(f.dir);
    expect(snapshot.published[0]?.prNumbers).toHaveLength(230);
    expect(snapshot.issues).toHaveLength(460);
});

test('граница включения сохраняет добавление workflow по first-parent main', async () => {
    const first = await activationTime(f.dir);
    expect(Date.parse(first)).toBe(Date.parse('2026-11-01T00:00:00Z'));
    git(f.dir, 'commit', '--allow-empty', '-m', 'later');
    git(f.dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    expect(await activationTime(f.dir)).toBe(first);
});

test('разница версий содержит только вошедшие PR и настоящие закрывающие связи', async () => {
    const result = await catalog.readPRChanges(f.a, f.b);
    expect(result.prs.map((pr) => pr.number)).toEqual([2]);
    expect(result.prs[0]?.title).toBe('PR 2');
    expect(result.issues[0]?.prNumbers).toEqual([2]);
    expect(result.compareUrl).toBe(
        `https://github.com/${process.env.GITHUB_REPOSITORY}/compare/${f.a}...${f.b}`,
    );
    expect((await catalog.readPRChanges(f.root, f.b)).prs.map((pr) => pr.number)).toEqual([1, 2]);
    expect((await catalog.readPRChanges(f.a, f.a)).prs).toEqual([]);
    f.pulls[0]!.merged_at = '';
    expect((await catalog.readPRChanges(f.root, f.b)).prs.map((pr) => pr.number)).toEqual([2]);
});

test('разница не теряет PR и commit со второй страницы', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({
        ...f.pulls[0]!,
        number: i + 1,
        merge_commit_sha: (i + 1).toString(16).padStart(40, '0'),
    }));
    f.pulls.splice(0, f.pulls.length, ...rows);
    f.extra = (url) => {
        if (!url.pathname.includes('/compare/')) return;
        const page = Number(url.searchParams.get('page'));
        return Response.json({
            total_commits: 101,
            commits: rows
                .slice((page - 1) * 100, page * 100)
                .map((pr) => ({ sha: pr.merge_commit_sha })),
        });
    };
    const result = await catalog.readPRChanges(f.a, f.b);
    expect(result.prs).toHaveLength(101);
    expect(result.prs.at(-1)?.number).toBe(101);
    expect(result.issues).toHaveLength(101);
});

test('общие задачи объединяются, несколько страниц связей и PR без задачи сохраняются', async () => {
    f.extra = (url, body) => {
        if (url.pathname !== '/graphql') return;
        const vars = body?.variables as { number: number; cursor?: string };
        const nodes =
            vars.number === 2
                ? []
                : [
                      {
                          id: vars.cursor ? 'shared' : 'first',
                          number: vars.cursor ? 10 : 11,
                          title: 'Frontend. issue',
                          repository: { nameWithOwner: process.env.GITHUB_REPOSITORY },
                      },
                  ];
        return Response.json({
            data: {
                repository: {
                    pullRequest: {
                        closingIssuesReferences: {
                            nodes,
                            pageInfo: {
                                hasNextPage: vars.number === 1 && !vars.cursor,
                                endCursor: 'next',
                            },
                        },
                    },
                },
            },
        });
    };
    const first = await catalog.readPRChanges(f.root, f.b);
    expect(first.issues.map((issue) => issue.id)).toEqual(['first', 'shared']);
    expect(first.prs[1]?.title).toBe('PR 2');
    f.extra = (url) =>
        url.pathname === '/graphql'
            ? Response.json({
                  data: {
                      repository: {
                          pullRequest: {
                              closingIssuesReferences: {
                                  nodes: [
                                      {
                                          id: 'shared',
                                          number: 10,
                                          title: 'Frontend. shared',
                                          repository: {
                                              nameWithOwner: process.env.GITHUB_REPOSITORY,
                                          },
                                      },
                                  ],
                                  pageInfo: { hasNextPage: false, endCursor: null },
                              },
                          },
                      },
                  },
              })
            : undefined;
    expect((await catalog.readPRChanges(f.root, f.b)).issues[0]?.prNumbers).toEqual([1, 2]);
});

test('неверный SHA отклоняется до HTTP запроса', async () => {
    await expect(catalog.readPRChanges('bad', f.b)).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
});

test.each(['http', 'graphql', 'partial'])(
    'ошибка %s не выдаётся за пустую разницу',
    async (kind) => {
        f.extra = (url) => {
            if (kind === 'http' && url.pathname.includes('/compare/'))
                return Response.json({}, { status: 503 });
            if (kind === 'graphql' && url.pathname === '/graphql')
                return Response.json({ errors: [{ message: 'denied' }] });
            if (kind === 'partial' && url.pathname.includes('/compare/'))
                return Response.json({ total_commits: 1, commits: [] });
        };
        await expect(catalog.readPRChanges(f.a, f.b)).rejects.toThrow();
    },
);

test('каталог без задач сохраняет состав и отбрасывает пустые production до чтения статусов', async () => {
    f.publish();
    f.deploy();
    f.records.production!.push({
        id: 99,
        sha: f.b,
        payload: {},
        created_at: '2026-11-01T04:00:00Z',
    });
    const result = await catalog.readReleaseCatalog(f.dir);
    expect(result.published.find((r) => r.sha === f.b)?.prNumbers).toEqual([1, 2]);
    expect([...result.deployed]).toEqual([1]);
    expect(f.requests.some((r) => String(r.body?.query).includes('LinkedIssues'))).toBe(false);
    expect(f.requests.some((r) => r.url.pathname.endsWith('/deployments/99/statuses'))).toBe(false);
    expect((await readReleaseSnapshot(f.dir)).issues).toHaveLength(2);
});

test.each(['partial', 'status'])('каталог не маскирует ошибку production %s', async (kind) => {
    f.publish();
    const row = f.deploy();
    if (kind === 'partial') row.payload = { action: 'deploy' } as typeof row.payload;
    else
        f.extra = (url) =>
            url.pathname.endsWith(`/deployments/${row.id}/statuses`)
                ? Response.json({}, { status: 503 })
                : undefined;
    await expect(catalog.readReleaseCatalog(f.dir)).rejects.toThrow();
});

test('каталог без задач сохраняет проверку digest, источника и успешной истории до rollback', async () => {
    f.publish();
    f.deploy(f.b);
    const rollback = f.deploy(f.a, 21);
    rollback.payload.action = 'rollback';
    f.runs.set(21, { ...f.runs.get(21), workflow_id: 102, path: '.github/workflows/rollback.yml' });
    expect([...(await catalog.readReleaseCatalog(f.dir)).deployed]).toEqual([1, 2]);
    const other = f.publish(f.b, 90);
    other.payload.image_ref = IMAGE.replace(/a{64}$/, 'b'.repeat(64));
    await expect(catalog.readReleaseCatalog(f.dir)).rejects.toThrow('разными образами');
    f.records['release-artifacts']!.pop();
    f.runs.set(1, { ...f.runs.get(1), head_repository: { full_name: 'evil/fork' } });
    await expect(catalog.readReleaseCatalog(f.dir)).rejects.toThrow('Недоверенный');
});

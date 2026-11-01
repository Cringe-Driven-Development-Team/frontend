import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fixture } from './test/fixture.ts';
import { notify } from './notify.ts';

let release: ReturnType<typeof fixture> | undefined;

const realFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
    release?.restore();
    release = undefined;
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

test('начало выкатки показывает PR, текущего инициатора и кнопку логов', async () => {
    const f = alertFixture(1);
    Object.assign(process.env, { GITHUB_ACTOR: 'original', GITHUB_TRIGGERING_ACTOR: 'retry<&' });
    await notify('start', 'success', f.b);
    expect(payload().text).toContain('Выкатка началась');
    expect(payload().text).toContain('PR title 1');
    expect(payload().text).toContain('/pull/1');
    expect(payload().text).toContain('retry&lt;&amp;');
    expect(payload().text).not.toContain(f.b);
    expect(payload().text).not.toContain('Frontend. 1');
    expect(payload().reply_markup?.inline_keyboard).toEqual([
        [
            {
                text: 'Логи выкатки',
                url: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/12`,
            },
        ],
    ]);
    expect(await summary()).toContain(f.b);
    expect(
        f.requests.some(
            (r) =>
                r.url.pathname.includes('/deployments') ||
                String(r.body?.query).includes('mutation'),
        ),
    ).toBe(false);
    delete process.env.GITHUB_TRIGGERING_ACTOR;
    await notify('start', 'success', f.b);
    expect(payload().text).toContain('original');
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

function alertFixture(count = 2) {
    const f = fixture();
    release = f;
    const template = f.pulls[1]!;
    f.pulls.splice(
        0,
        f.pulls.length,
        ...Array.from({ length: count }, (_, i) => ({
            ...template,
            number: i + 1,
            title: `PR title ${i + 1}`,
        })),
    );
    Object.assign(process.env, {
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_CHAT_ID: '1',
        GITHUB_RUN_ID: '12',
        GITHUB_STEP_SUMMARY: join(f.dir, 'summary.md'),
        RELEASE_BEFORE_SHA: f.a,
        RELEASE_HEALTH_STATUS: 'success',
        RELEASE_SWITCH_STATUS: 'success',
    });
    f.extra = (url) =>
        url.hostname === 'api.telegram.org'
            ? Response.json({ ok: true, result: { message_id: 1 } })
            : undefined;
    return f;
}

function payload() {
    return release!.requests.findLast((r) => r.url.hostname === 'api.telegram.org')!
        .body as unknown as {
        text: string;
        reply_markup?: { inline_keyboard: { text: string; url: string }[][] };
    };
}

async function summary() {
    return Bun.file(process.env.GITHUB_STEP_SUMMARY!).text();
}

test.each([
    ['success', '✅'],
    ['failure', '❌'],
    ['skipped', '⚪'],
    ['cancelled', '⚪'],
    [undefined, '⚪'],
])('Health Check %s отражает проверку, а не общий статус job', async (health, icon) => {
    const f = alertFixture(1);
    if (health) process.env.RELEASE_HEALTH_STATUS = health;
    else delete process.env.RELEASE_HEALTH_STATUS;
    process.env.RELEASE_RETENTION_STATUS = 'failure';
    await notify('deploy', 'failure', f.b);
    expect(payload().text).toContain(`Health Check ${icon}`);
    expect(payload().text).toContain('❌ Выкатка');
    expect(payload().text).not.toContain('работает выбранный образ, HTML');
    if (health === 'success') expect(payload().text).toContain('Retention');
});

test.each(['failure', 'cancelled'])(
    'switch %s сохраняет сведения о неизвестном состоянии',
    async (state) => {
        const f = alertFixture(1);
        process.env.RELEASE_SWITCH_STATUS = state;
        process.env.RELEASE_HEALTH_STATUS = 'skipped';
        await notify('deploy', 'failure', f.b);
        expect(payload().text).toContain('Health Check ⚪');
        expect(payload().text).toContain('состояние прода неизвестно');
    },
);

test.each([0, 1, 3, 6, 7])('%i PR получают полную и компактную навигацию', async (count) => {
    const f = alertFixture(count);
    await notify('deploy', 'success', f.b);
    const rows = payload().reply_markup!.inline_keyboard;
    const buttons = rows.flat();
    const prs = buttons.filter((b) => b.text === 'PR' || b.text.startsWith('PR #'));
    expect(prs).toHaveLength(count > 6 ? 0 : count);
    expect(buttons.some((b) => b.text === 'Изменения')).toBe(false);
    expect(buttons.some((b) => b.text === 'Логи выкатки')).toBe(true);
    expect(buttons.some((b) => b.text.includes('Открыть прод'))).toBe(true);
    expect(buttons.some((b) => b.text.includes('Откатить'))).toBe(true);
    if (count === 1)
        expect(prs[0]).toEqual({
            text: 'PR',
            url: `https://github.com/${process.env.GITHUB_REPOSITORY}/pull/1`,
        });
    if (count === 3 || count === 6)
        expect(
            rows.filter((row) => row[0]?.text.startsWith('PR #')).map((row) => row.length),
        ).toEqual(count === 3 ? [2, 1] : [2, 2, 2]);
    if (count > 6)
        expect(buttons.find((b) => b.text === 'Все PR выпуска')?.url).toBe(
            `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/12#summary`,
        );
    if (!count) expect(payload().text).toContain('Связанных PR нет');
    const report = await summary();
    expect(report).toContain(f.a);
    expect(report).toContain(f.b);
    expect(report).toContain(`/compare/${f.a}...${f.b}`);
    for (let i = 1; i <= count; i++) {
        expect(report).toContain(`/pull/${i}`);
        expect(report).toContain(`/issues/${i}`);
    }
});

test('общая задача показывается один раз, PR без задачи — под своим названием', async () => {
    const f = alertFixture(3);
    const original = f.extra;
    f.extra = (url, body, init) => {
        if (url.pathname === '/graphql') {
            const number = (body!.variables as { number: number }).number;
            return Response.json({
                data: {
                    repository: {
                        pullRequest: {
                            closingIssuesReferences: {
                                nodes:
                                    number === 3
                                        ? []
                                        : [
                                              {
                                                  id: 'shared',
                                                  number: 27,
                                                  title: 'Frontend. Статика <>&',
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
            });
        }
        return original?.(url, body, init);
    };
    await notify('deploy', 'success', f.b);
    expect(payload().text.match(/Frontend\. Статика/g)).toHaveLength(1);
    expect(payload().text).toContain('Статика &lt;&gt;&amp;');
    expect(payload().text).toContain('/issues/27');
    expect(payload().text).toContain('PR title 3');
    expect(payload().text).toContain('/pull/3');
    expect(await summary()).toContain('PR title 3');
});

test('Rollback перечисляет удалённые PR через обратный диапазон', async () => {
    const f = alertFixture(1);
    process.env.RELEASE_BEFORE_SHA = f.b;
    await notify('rollback', 'success', f.a);
    expect(payload().text).toContain('Отменённые задачи');
    expect(payload().text).toContain('/issues/1');
    expect(await summary()).toContain(`/compare/${f.a}...${f.b}`);
});

test.each(['http', 'graphql', 'unknown'])('сбой состава %s не скрывает результат', async (kind) => {
    const f = alertFixture(1);
    const original = f.extra;
    if (kind === 'unknown') delete process.env.RELEASE_BEFORE_SHA;
    f.extra = (url, body, init) => {
        if (kind === 'http' && url.pathname.includes('/compare/'))
            return Response.json({}, { status: 503 });
        if (kind === 'graphql' && url.pathname === '/graphql')
            return Response.json({ errors: [{ message: 'denied' }] });
        return original?.(url, body, init);
    };
    await notify('deploy', 'success', f.b);
    expect(payload().text).toContain('✅ Выкатка');
    expect(payload().text).toContain('Состав изменений недоступен');
    expect(payload().text).not.toContain('Связанных PR нет');
    expect(await summary()).toContain('неполный');
});

test.each(['missing', 'unwritable'])(
    'ошибка Summary %s не скрывает данные и не создаёт мёртвую кнопку',
    async (kind) => {
        const f = alertFixture(7);
        if (kind === 'missing') delete process.env.GITHUB_STEP_SUMMARY;
        else process.env.GITHUB_STEP_SUMMARY = f.dir;
        await notify('deploy', 'success', f.b);
        expect(payload().text).toContain('✅ Выкатка');
        expect(payload().text).toContain('Frontend. 1');
        expect(payload().text).toContain('Полный отчёт недоступен');
        expect(
            payload()
                .reply_markup!.inline_keyboard.flat()
                .some((b) => b.text === 'Все PR выпуска'),
        ).toBe(false);
    },
);

test('длинные названия сокращают только Telegram, оставляя полный отчёт и результат', async () => {
    const f = alertFixture(40);
    const original = f.extra;
    const title = '<>&[]_*😀'.repeat(40);
    f.extra = (url, body, init) =>
        url.pathname === '/graphql'
            ? Response.json({
                  data: {
                      repository: {
                          pullRequest: {
                              closingIssuesReferences: {
                                  nodes: [
                                      {
                                          id: `I${(body!.variables as { number: number }).number}`,
                                          number: (body!.variables as { number: number }).number,
                                          title,
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
            : original?.(url, body, init);
    await notify('deploy', 'success', f.b);
    const text = payload().text;
    const visible = text.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot);/g, '_');
    expect([...visible].length).toBeLessThanOrEqual(4096);
    expect(text).toContain('Health Check ✅');
    expect(text).toContain(f.b);
    expect(text).toContain('#summary');
    expect(text).toContain('&lt;&gt;&amp;');
    expect(text).not.toContain(title);
    const report = await summary();
    expect(report).toContain('/issues/40');
    expect(report).toContain('😀'.repeat(1));
    expect(report).toContain('\\[');
});

test.each([0, 3])('начало выкатки с %i PR не выбирает случайный первый', async (count) => {
    const f = alertFixture(count);
    await notify('start', 'success', f.b);
    if (!count) expect(payload().text).toContain('Связанных PR нет');
    else {
        for (let i = 1; i <= count; i++) expect(payload().text).toContain(`PR title ${i}`);
        expect(payload().text.indexOf('PR title 1')).toBeLessThan(
            payload().text.indexOf('PR title 3'),
        );
    }
});

test.each(['unknown', 'http'])(
    'начало при %s всё равно сообщает о старте и даёт логи',
    async (kind) => {
        const f = alertFixture(1);
        if (kind === 'unknown') delete process.env.RELEASE_BEFORE_SHA;
        const original = f.extra;
        f.extra = (url, body, init) =>
            kind === 'http' && url.pathname.includes('/compare/')
                ? Response.json({}, { status: 503 })
                : original?.(url, body, init);
        await notify('start', 'success', f.b);
        expect(payload().text).toContain('Выкатка началась');
        expect(payload().text).toContain('Состав изменений недоступен');
        expect(payload().reply_markup?.inline_keyboard[0]?.[0]?.text).toBe('Логи выкатки');
    },
);

test('длинный список PR начала сокращается, полный текст и SHA остаются в Summary', async () => {
    const f = alertFixture(40);
    const title = '<long>😀'.repeat(40);
    for (const pr of f.pulls) pr.title = `${title} ${pr.number}`;
    await notify('start', 'success', f.b);
    expect(payload().text).toContain('&lt;long&gt;');
    expect(payload().text).not.toContain(f.b);
    expect(payload().text).toContain('#summary');
    expect(
        [
            ...payload()
                .text.replace(/<[^>]*>/g, '')
                .replace(/&(amp|lt|gt|quot);/g, '_'),
        ].length,
    ).toBeLessThanOrEqual(4096);
    const report = await summary();
    expect(report).toContain('/pull/40');
    expect(report).toContain(f.b);
    expect(report.match(/😀/g)).toHaveLength(1600);
});

test('начало валидирует SHA и success до чтения состава и отправки', async () => {
    const f = alertFixture(1);
    await expect(notify('start', 'success', 'bad')).rejects.toThrow();
    await expect(notify('start', 'failure', f.b)).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
});

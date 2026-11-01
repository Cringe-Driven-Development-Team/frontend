import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ensureBaseline, prepareNotice, sendPending, type Notice } from './journal.ts';
import { sendTelegram, TelegramRejectedError } from './notify.ts';
import { fixture, git } from './test/fixture.ts';

let f: ReturnType<typeof fixture>;
let notice: Notice;
let posts: number;
let response: () => Response;
let failSuccess: boolean;
let failStart: boolean;
beforeEach(() => {
    f = fixture();
    f.publish();
    posts = 0;
    failSuccess = false;
    failStart = false;
    response = () => Response.json({ ok: true, result: { message_id: 7 } });
    Object.assign(process.env, {
        TELEGRAM_BOT_TOKEN: 'telegram-secret',
        TELEGRAM_CHAT_ID: '1',
        TELEGRAM_TOPIC_ID: '123',
    });
    notice = {
        kind: 'ready',
        key: `ready:${f.b}`,
        ref: f.b,
        source: 'https://github.com/Cringe-Driven-Development-Team/frontend/actions/runs/1',
        message: { text: 'Release' },
        prNumbers: [1, 2],
        reportUrl:
            'https://github.com/Cringe-Driven-Development-Team/frontend/actions/runs/1#summary',
    };
    f.extra = (url, body) => {
        if (url.hostname === 'api.telegram.org') {
            posts++;
            return response();
        }
        if (
            (failSuccess && body?.state === 'success') ||
            (failStart && body?.state === 'in_progress')
        )
            return Response.json({}, { status: 403 });
    };
});
afterEach(() => f.restore());

test('подтверждённое сообщение не пересылается при повторе', async () => {
    await prepareNotice(notice);
    await sendPending(f.dir);
    await prepareNotice(notice);
    await sendPending(f.dir);
    expect(posts).toBe(1);
    expect(f.statuses.get(1000)?.[0]).toMatchObject({
        state: 'success',
        description: 'telegram_message_id=7',
        auto_inactive: false,
    });
    expect(f.statuses.get(1000)?.map((status) => status.state)).toEqual([
        'success',
        'in_progress',
        'pending',
    ]);
});

test('baseline сохраняет время main и не отправляет сообщение', async () => {
    const first = await ensureBaseline(f.dir);
    expect(Date.parse(first)).toBe(Date.parse('2026-11-01T00:00:00Z'));
    expect(await ensureBaseline(f.dir)).toBe(first);
    expect(f.records['release-automation']).toHaveLength(1);
    await sendPending(f.dir);
    expect(posts).toBe(0);
    expect(f.records['release-automation']?.[0]).toMatchObject({
        environment: 'release-automation',
        production_environment: false,
    });
});

test('payload существующего события остаётся исходным', async () => {
    await prepareNotice(notice);
    await prepareNotice({ ...notice, message: { text: 'changed' }, prNumbers: [99] });
    expect(f.records['release-automation']?.[0]?.payload).toMatchObject({
        message: { text: 'Release' },
        prNumbers: [1, 2],
    });
});

test('неизвестный исход доставки не пересылается, остальные сообщения продолжаются', async () => {
    await prepareNotice(notice);
    response = () => {
        throw new Error('timeout with telegram-secret');
    };
    expect((await sendPending(f.dir)).errors).toHaveLength(1);
    response = () => Response.json({ ok: true, result: { message_id: 8 } });
    await prepareNotice({ ...notice, kind: 'queue', key: 'queue:E2', reportUrl: null });
    const result = await sendPending(f.dir);
    expect(result.sent).toBe(1);
    expect(result.errors.join()).toContain('in_progress');
    expect(posts).toBe(2);
    expect(result.errors.join()).not.toContain('telegram-secret');
});

test('отказ записи success после доставки не разрешает повторный POST', async () => {
    await prepareNotice(notice);
    failSuccess = true;
    expect((await sendPending(f.dir)).errors).toHaveLength(1);
    failSuccess = false;
    expect((await sendPending(f.dir)).errors).toHaveLength(1);
    expect(posts).toBe(1);
});

test('подтверждённый отказ Telegram повторяем, 5xx и некорректный ответ неоднозначны', async () => {
    await prepareNotice(notice);
    response = () => Response.json({ ok: false, error_code: 429 }, { status: 429 });
    expect((await sendPending(f.dir)).errors).toHaveLength(1);
    expect(f.statuses.get(1000)?.[0]?.state).toBe('pending');
    response = () => Response.json({ ok: true, result: { message_id: 7 } });
    expect((await sendPending(f.dir)).sent).toBe(1);
    for (const res of [
        () => Response.json({ ok: false }, { status: 500 }),
        () => Response.json({ ok: true }),
    ]) {
        await prepareNotice({ ...notice, kind: 'queue', key: `queue:${posts}`, reportUrl: null });
        response = res;
        expect((await sendPending(f.dir)).errors.length).toBeGreaterThan(0);
    }
});

test('ошибка записи in_progress не вызывает Telegram', async () => {
    await prepareNotice(notice);
    failStart = true;
    expect((await sendPending(f.dir)).errors).toHaveLength(1);
    expect(posts).toBe(0);
});

test('receipt без начального статуса можно безопасно отправить', async () => {
    await prepareNotice(notice);
    f.statuses.delete(1000);
    expect((await sendPending(f.dir)).sent).toBe(1);
    expect(posts).toBe(1);
});

test('выкаченный pending ready подавляется, queue и новый direct commit сохраняются', async () => {
    await prepareNotice(notice);
    f.deploy(f.b);
    expect((await sendPending(f.dir)).skipped).toBe(1);
    expect(posts).toBe(0);
    expect(f.statuses.get(1000)?.[0]?.state).toBe('inactive');
    await prepareNotice({ ...notice, kind: 'queue', key: 'queue:E3', reportUrl: null });
    expect((await sendPending(f.dir)).sent).toBe(1);
    git(f.dir, 'commit', '--allow-empty', '-m', 'direct change');
    const direct = git(f.dir, 'rev-parse', 'HEAD');
    git(f.dir, 'update-ref', 'refs/remotes/origin/main', direct);
    f.publish(direct, 2);
    await prepareNotice({ ...notice, key: `ready:${direct}`, ref: direct });
    expect((await sendPending(f.dir)).sent).toBe(1);
});

test('транспорт проверяет ok/message_id и сохраняет topic/keyboard', async () => {
    expect(
        await sendTelegram({
            text: '&lt;release&gt;',
            keyboard: [[{ text: 'Open', url: 'https://github.com' }]],
        }),
    ).toBe(7);
    const body = f.requests.find((request) => request.url.hostname === 'api.telegram.org')!.body;
    expect(body).toMatchObject({
        parse_mode: 'HTML',
        text: '&lt;release&gt;',
        message_thread_id: 123,
        reply_markup: { inline_keyboard: [[{ text: 'Open', url: 'https://github.com' }]] },
    });
    response = () => Response.json({ ok: false }, { status: 400 });
    await expect(sendTelegram({ text: 'x' })).rejects.toBeInstanceOf(TelegramRejectedError);
});

test('выбор queue и ключа не проверяет старый ready и не отправляет другие сообщения', async () => {
    await prepareNotice(notice);
    await prepareNotice({ ...notice, kind: 'queue', key: 'queue:chosen', reportUrl: null });
    await prepareNotice({ ...notice, kind: 'queue', key: 'queue:other', reportUrl: null });
    f.deploy(f.b);
    f.requests.length = 0;
    const result = await sendPending(f.dir, 'queue', 'queue:chosen');
    expect(result.sent).toBe(1);
    expect(posts).toBe(1);
    expect(f.statuses.get(1000)?.[0]?.state).toBe('pending');
    expect(f.statuses.get(1002)?.[0]?.state).toBe('pending');
    expect(f.requests.some((r) => r.url.searchParams.get('environment') === 'production')).toBe(
        false,
    );
    expect((await sendPending(f.dir, 'ready')).sent).toBe(0);
    expect(f.statuses.get(1000)?.[0]?.state).toBe('inactive');
});

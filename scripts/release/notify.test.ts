import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { ReleaseError } from './env.ts';
import { notify } from './notify.ts';

type TelegramRequest = {
    chat_id: string;
    text: string;
    parse_mode: string;
    reply_markup: { inline_keyboard: { text: string; url: string }[][] };
    message_thread_id?: number;
};

const fixtureEnv: Record<string, string | undefined> = {
    GITHUB_ACTOR: 'iRedTea',
    GITHUB_TRIGGERING_ACTOR: undefined,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '-1001234567890',
    TELEGRAM_TOPIC_ID: '42',
    GITHUB_REPOSITORY: 'example/frontend',
    GITHUB_RUN_ID: '123',
    GITHUB_SERVER_URL: 'https://github.com',
    TELEGRAM_API: 'https://telegram.invalid',
    TELEGRAM_USER_MAP: '{"iRedTea":"123456789"}',
};
const sha = 'a'.repeat(40);
const expectedMention = 'Запустил: <a href="tg://user?id=123456789">iRedTea</a>';
let savedEnv: Record<string, string | undefined>;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;

function setEnv(values: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

beforeEach(() => {
    savedEnv = Object.fromEntries(Object.keys(fixtureEnv).map((key) => [key, process.env[key]]));
    setEnv(fixtureEnv);
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});

afterEach(() => {
    setEnv(savedEnv);
    fetchSpy.mockRestore();
});

async function captureNotify(
    what: string,
    status: string,
    overrides: Record<string, string | undefined> = {},
): Promise<TelegramRequest> {
    setEnv(overrides);
    await notify(what, status, sha);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://telegram.invalid/bottest-token/sendMessage');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(typeof options?.body).toBe('string');
    return JSON.parse(options!.body as string) as TelegramRequest;
}

const operations = ['Заливка', 'Выкатка', 'Откат'];
const statuses = ['success', 'failure', 'cancelled'];
for (const operation of operations) {
    for (const status of statuses) {
        test(`упоминает инициатора для каждой операции и статуса: ${operation}, ${status}`, async () => {
            const request = await captureNotify(operation, status);
            expect(request.text.split('\n').at(-1)).toBe(expectedMention);
            expect(request.parse_mode).toBe('HTML');
        });
    }
}

const invalidMaps: [string, string | undefined][] = [
    ['карта отсутствует', undefined],
    ['пустая карта', ''],
    ['ошибка JSON', '{'],
    ['null вместо карты', 'null'],
    ['массив вместо карты', '[]'],
    ['число вместо карты', '7'],
    ['строка вместо карты', '"text"'],
    ['пустой объект', '{}'],
    ['только другой логин', '{"other":"123456789"}'],
];
const invalidIds: [string, unknown][] = [
    ['null', null],
    ['boolean', true],
    ['объект', {}],
    ['массив', []],
    ['пустая строка', ''],
    ['строковый ноль', '0'],
    ['ведущий ноль', '0123'],
    ['начальный пробел', ' 123'],
    ['конечный пробел', '123 '],
    ['конечный перевод строки', '123\n'],
    ['отрицательная строка', '-1'],
    ['дробная строка', '1.5'],
    ['экспоненциальная строка', '1e3'],
    ['кавычка и HTML', '123"><b>injected</b>'],
    ['числовой ноль', 0],
    ['отрицательное число', -1],
    ['дробное число', 1.5],
    ['небезопасное число', 9007199254740992],
];
for (const [name, id] of invalidIds) {
    invalidMaps.push([`ID: ${name}`, JSON.stringify({ iRedTea: id })]);
}
test.each(invalidMaps)(
    'сохраняет обычный логин при невалидной карте или ID: %s',
    async (_, rawMap) => {
        const request = await captureNotify('Выкатка', 'success', { TELEGRAM_USER_MAP: rawMap });
        expect(request.text.split('\n').at(-1)).toBe('Запустил: iRedTea');
        expect(request.text).not.toContain('tg://user');
    },
);

test('принимает числовой ID', async () => {
    const request = await captureNotify('Выкатка', 'success', {
        TELEGRAM_USER_MAP: '{"iRedTea":123456789}',
    });
    expect(request.text.split('\n').at(-1)).toBe(expectedMention);
});

test('сохраняет большой строковый ID', async () => {
    const request = await captureNotify('Выкатка', 'success', {
        TELEGRAM_USER_MAP: '{"iRedTea":"9007199254740993"}',
    });
    expect(request.text.split('\n').at(-1)).toBe(
        'Запустил: <a href="tg://user?id=9007199254740993">iRedTea</a>',
    );
});

test('не отвергает карту из-за чужой записи', async () => {
    const request = await captureNotify('Выкатка', 'success', {
        TELEGRAM_USER_MAP: '{"iRedTea":"123456789","other":"bad"}',
    });
    expect(request.text.split('\n').at(-1)).toBe(expectedMention);
});

test('сопоставляет точный регистр', async () => {
    const request = await captureNotify('Выкатка', 'success', {
        TELEGRAM_USER_MAP: '{"iredtea":"123456789"}',
    });
    expect(request.text.split('\n').at(-1)).toBe('Запустил: iRedTea');
});

test('не использует унаследованный ключ', async () => {
    const request = await captureNotify('Выкатка', 'success', {
        GITHUB_ACTOR: 'toString',
        TELEGRAM_USER_MAP: '{}',
    });
    expect(request.text.split('\n').at(-1)).toBe('Запустил: toString');
});

test.each([
    [
        'ссылка',
        '{"A<&B>":"123456789"}',
        'Запустил: <a href="tg://user?id=123456789">A&lt;&amp;B&gt;</a>',
    ],
    ['обычный логин', '{}', 'Запустил: A&lt;&amp;B&gt;'],
])('экранирует логин в обоих вариантах: %s', async (_, rawMap, expected) => {
    const request = await captureNotify('Выкатка', 'success', {
        GITHUB_ACTOR: 'A<&B>',
        TELEGRAM_USER_MAP: rawMap,
    });
    expect(request.text.split('\n').at(-1)).toBe(expected);
});

test.each([undefined, ''])('не добавляет строку без инициатора: %s', async (actor) => {
    const request = await captureNotify('Выкатка', 'success', { GITHUB_ACTOR: actor });
    expect(request.text).not.toContain('Запустил:');
});

test('сохраняет инициатора при повторном запуске', async () => {
    const request = await captureNotify('Выкатка', 'success', {
        GITHUB_TRIGGERING_ACTOR: 'other',
        TELEGRAM_USER_MAP: '{"iRedTea":"123456789","other":"987654321"}',
    });
    expect(request.text.split('\n').at(-1)).toBe(expectedMention);
});

test.each([
    ['Заливка', 'success', '📦 Релиз фронта залит, ждёт выкатки', 2],
    ['Заливка', 'failure', '❌ Заливка фронта: ошибка', 1],
    ['Заливка', 'cancelled', '⚪ Заливка фронта: отменено', 1],
    ['Выкатка', 'success', '✅ Выкатка фронта: успешно', 1],
    ['Выкатка', 'failure', '❌ Выкатка фронта: ошибка', 1],
    ['Выкатка', 'cancelled', '⚪ Выкатка фронта: отменено', 1],
    ['Откат', 'success', '✅ Откат фронта: успешно', 1],
    ['Откат', 'failure', '❌ Откат фронта: ошибка', 1],
    ['Откат', 'cancelled', '⚪ Откат фронта: отменено', 1],
] as const)('сохраняет остальные поля: %s, %s', async (operation, status, heading, buttonCount) => {
    const request = await captureNotify(operation, status);
    expect(request.chat_id).toBe('-1001234567890');
    expect(request.message_thread_id).toBe(42);
    expect(request.parse_mode).toBe('HTML');
    expect(request.text.split('\n')[0]).toBe(heading);
    expect(request.text).toContain('Релиз <code>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</code>');
    expect(request.reply_markup.inline_keyboard).toHaveLength(1);
    const buttons = request.reply_markup.inline_keyboard[0]!;
    expect(buttons).toHaveLength(buttonCount);
    expect(buttons[0]).toEqual({
        text: 'Запуск',
        url: 'https://github.com/example/frontend/actions/runs/123',
    });
    if (buttonCount === 2) {
        expect(buttons[1]).toEqual({
            text: 'Выкатить',
            url: 'https://github.com/example/frontend/actions/workflows/cd.yml',
        });
    }
});

test.each([undefined, ''])('сохраняет отсутствие topic: %s', async (topic) => {
    const request = await captureNotify('Выкатка', 'success', { TELEGRAM_TOPIC_ID: topic });
    expect(request).not.toHaveProperty('message_thread_id');
});

test('сохраняет ошибку Telegram', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 400 }));
    const result = notify('Выкатка', 'success', sha);
    await expect(result).rejects.toBeInstanceOf(ReleaseError);
    await expect(result).rejects.toThrow('Telegram не принял сообщение: ответ 400');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('сохраняет сетевую ошибку', async () => {
    const error = new Error('network-test');
    fetchSpy.mockRejectedValue(error);
    await expect(notify('Выкатка', 'success', sha)).rejects.toBe(error);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
});

type WorkflowStep = { run?: string; if?: string; env?: Record<string, string> };
type Workflow = { jobs: Record<string, { steps: WorkflowStep[] }> };

async function readWorkflow(name: string): Promise<Workflow> {
    const url = new URL(`../../.github/workflows/${name}.yml`, import.meta.url);
    return Bun.YAML.parse(await Bun.file(url).text()) as Workflow;
}

test('передаёт карту всем релизным уведомлениям', async () => {
    const workflows = [
        {
            name: 'ci',
            notifications: [
                { run: 'bun run release notify Заливка success "$GITHUB_SHA"', if: undefined },
                { run: 'bun run release notify Заливка failure "$GITHUB_SHA"', if: 'failure()' },
            ],
        },
        {
            name: 'cd',
            notifications: [
                { run: 'bun run release notify Выкатка "$STATUS" "$SHA"', if: 'always()' },
            ],
        },
        {
            name: 'rollback',
            notifications: [
                { run: 'bun run release notify Откат "$STATUS" "$SHA"', if: 'always()' },
            ],
        },
    ];
    const notifySteps: WorkflowStep[] = [];
    for (const { name, notifications } of workflows) {
        const workflow = await readWorkflow(name);
        const steps = Object.values(workflow.jobs)
            .flatMap((job) => job.steps)
            .filter((step) => step.run?.includes('bun run release notify'));
        expect(steps).toHaveLength(notifications.length);
        expect(steps.map((step) => ({ run: step.run, if: step.if }))).toEqual(notifications);
        notifySteps.push(...steps);
    }
    expect(notifySteps).toHaveLength(4);
    for (const step of notifySteps) {
        expect(step.env?.TELEGRAM_USER_MAP).toBe('${{ vars.TELEGRAM_USER_MAP }}');
        expect(step.env?.TELEGRAM_TOPIC_ID).toBe(
            '${{ vars.TELEGRAM_RELEASES_TOPIC_ID || vars.TELEGRAM_TOPIC_ID }}',
        );
    }
});

test('CI запускает целевые тесты до check и build', async () => {
    const workflow = await readWorkflow('ci');
    const steps = workflow.jobs.check!.steps;
    const installIndex = steps.findIndex((step) => step.run === 'bun install --frozen-lockfile');
    const testsIndex = steps.findIndex(
        (step) => step.run === 'bun test ./scripts/release/notify.test.ts',
    );
    const checkIndex = steps.findIndex((step) => step.run === 'bun run check');
    const buildIndex = steps.findIndex((step) => step.run === 'bun run build');
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(testsIndex).toBeGreaterThanOrEqual(0);
    expect(checkIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(installIndex).toBeLessThan(testsIndex);
    expect(testsIndex).toBeLessThan(checkIndex);
    expect(checkIndex).toBeLessThan(buildIndex);
});

import { expect, test } from 'bun:test';

interface Step {
    id?: string;
    name?: string;
    run?: string;
    uses?: string;
    if?: string;
    'continue-on-error'?: boolean;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
}
interface Workflow {
    on: Record<string, { types?: string[]; workflows?: string[]; branches?: string[] }>;
    permissions: Record<string, string>;
    concurrency?: { group: string; 'cancel-in-progress': boolean };
    jobs: Record<
        string,
        {
            environment?: unknown;
            steps: Step[];
            if?: string;
            env?: Record<string, string>;
            needs?: unknown;
            concurrency?: { group: string; 'cancel-in-progress': boolean };
            permissions?: Record<string, string>;
        }
    >;
}
async function workflow(name: string): Promise<Workflow> {
    return Bun.YAML.parse(
        await Bun.file(new URL(`../../.github/workflows/${name}`, import.meta.url)).text(),
    ) as Workflow;
}

test('CD сообщает о начале непосредственно перед Switch и сохраняет итог при ошибке', async () => {
    const cd = await workflow('cd.yml');
    const steps = cd.jobs.cd!.steps;
    const at = steps.findIndex((step) => step.id === 'switch');
    expect(steps[at - 2]?.run).toBe('bun run release notify start success "$SHA"');
    expect(steps[at - 2]?.['continue-on-error']).toBe(true);
    expect(steps[at - 2]?.if).toBeUndefined();
    expect(steps[at - 2]?.env?.RELEASE_BEFORE_SHA).toBe(
        '${{ steps.confirmed.outputs.before_sha }}',
    );
    expect(
        steps.find((step) => step.run === 'bun run release notify deploy "$STATUS" "$SHA"')?.if,
    ).toBe('always()');
});

test('синхронизация слушает main CI/CD и очередь, не исполняет head PR', async () => {
    const config = await workflow('release-status.yml');
    expect(config.on.workflow_run).toEqual({
        workflows: ['CI', 'CD', 'Rollback'],
        types: ['completed'],
        branches: ['main'],
    });
    expect(config.on.pull_request_target).toEqual({ types: ['enqueued'], branches: ['main'] });
    expect(config.on.workflow_dispatch).toBeDefined();
    expect(config.concurrency).toBeUndefined();
    const notifications = config.jobs.notifications!;
    const board = config.jobs.board!;
    expect(notifications.needs).toBeUndefined();
    expect(board.needs).toBeUndefined();
    expect(notifications.concurrency).toEqual({
        group: 'release-automation',
        'cancel-in-progress': false,
    });
    expect(board.concurrency).toEqual({ group: 'release-board', 'cancel-in-progress': false });
    expect(notifications.permissions?.deployments).toBe('write');
    expect(board.permissions?.deployments).toBe('read');
    expect(board.if).toContain("github.event_name != 'pull_request_target'");
    expect(notifications.env?.ADD_TO_PROJECT_PAT).toBeUndefined();
    expect(board.env?.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(board.env?.ADD_TO_PROJECT_PAT).toBeDefined();
    expect(notifications.env?.TELEGRAM_BOT_TOKEN).toBeDefined();
    for (const job of [notifications, board]) {
        expect(job.environment).toBeUndefined();
        const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout'))!;
        expect(checkout.with).toMatchObject({
            ref: 'main',
            'fetch-depth': 0,
            'persist-credentials': false,
        });
        expect(Object.keys(job.env ?? {}).some((key) => /S3|SSH|DEPLOY_SSH|VAULT/.test(key))).toBe(
            false,
        );
    }
    expect(board.steps.at(-1)?.run).toBe('bun run release sync');
    const current = notifications.steps.findIndex((step) => step.id === 'current');
    const send = notifications.steps[current + 1]!;
    expect(notifications.steps[current]?.run).toBe('bun run release prepare-notifications current');
    expect(send.run).toBe('bun run release notify-pending "$KIND" "$NOTICE_KEY"');
    expect(send.if).toBe(
        "always() && steps.current.outputs.allowed == 'true' && steps.current.outputs.first_key != ''",
    );
    expect(send.env).toMatchObject({
        KIND: '${{ steps.current.outputs.kind }}',
        NOTICE_KEY: '${{ steps.current.outputs.first_key }}',
    });
    expect(notifications.steps[current + 2]?.run).toBe(
        'bun run release prepare-notifications recover',
    );
    expect(notifications.steps[current + 2]?.if).toBe(
        "always() && steps.current.outputs.allowed == 'true'",
    );
    expect(notifications.steps[current + 3]?.if).toBe(
        "always() && steps.recovery.outputs.allowed == 'true'",
    );
});

test('CI оставляет только сообщение о провале публикации', async () => {
    const ci = await workflow('ci.yml');
    const send = ci.jobs.publish!.steps.find(
        (step) => step.run === 'bun run release notify publish "$STATUS" "$SHA"',
    )!;
    expect(send.if).toBe('failure() || cancelled()');
});

test('Rollback использует тип уведомления rollback', async () => {
    const config = await workflow('rollback.yml');
    expect(
        config.jobs.rollback!.steps.some(
            (step) => step.run === 'bun run release notify rollback "$STATUS" "$SHA"',
        ),
    ).toBe(true);
});

test.each(['cd.yml', 'rollback.yml'])(
    '%s разрешает чтение состава, итог отправляется при сбое',
    async (name) => {
        const config = await workflow(name);
        expect(config.permissions['pull-requests']).toBe('read');
        expect(config.permissions.issues).toBe('read');
        const send = Object.values(config.jobs)
            .flatMap((job) => job.steps)
            .find((step) => step.name === 'Send to tg')!;
        expect(send.if).toBe('always()');
        expect(send['continue-on-error']).toBe(true);
    },
);

test.each(['ci.yml', 'cd.yml', 'rollback.yml'])(
    '%s публикует отчёт до записи операции',
    async (name) => {
        const config = await workflow(name);
        const job =
            config.jobs[name === 'ci.yml' ? 'publish' : name === 'cd.yml' ? 'cd' : 'rollback']!;
        const report = job.steps.findIndex((step) => step.id === 'report');
        const record = job.steps.findIndex(
            (step) =>
                step.run?.startsWith('bun run release register ') ||
                step.run?.startsWith('bun run release start '),
        );
        expect(report).toBeGreaterThanOrEqual(0);
        expect(record).toBeGreaterThan(report);
        expect(job.steps[record]?.env?.RELEASE_REPORT_URL).toBe(
            '${{ steps.report.outputs.report_url }}',
        );
        if (name !== 'ci.yml') {
            const change = job.steps.findIndex((step) => step.id === 'switch');
            expect(job.steps[change - 1]?.id).toBe('start');
        }
    },
);

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
    concurrency: { group: string; 'cancel-in-progress': boolean };
    jobs: Record<
        string,
        { environment?: unknown; steps: Step[]; if?: string; env?: Record<string, string> }
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
    expect(steps[at - 1]?.run).toBe('bun run release notify start success "$SHA"');
    expect(steps[at - 1]?.['continue-on-error']).toBe(true);
    expect(steps[at - 1]?.if).toBeUndefined();
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
    expect(config.concurrency).toEqual({
        group: 'release-automation',
        'cancel-in-progress': false,
    });
    expect(config.permissions).toEqual({
        contents: 'read',
        actions: 'read',
        'pull-requests': 'read',
        issues: 'read',
        deployments: 'write',
    });
    const job = config.jobs.sync!;
    expect(job.environment).toBeUndefined();
    const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout'))!;
    expect(checkout.with).toMatchObject({
        ref: 'main',
        'fetch-depth': 0,
        'persist-credentials': false,
    });
    expect(job.steps.find((step) => step.id === 'sync')?.run).toBe('bun run release sync');
    const send = job.steps.find((step) => step.run === 'bun run release notify-pending')!;
    expect(send.if).toBe("always() && steps.sync.outputs.allowed == 'true'");
    expect(send['continue-on-error']).toBeUndefined();
    expect(Object.keys(job.env ?? {}).some((key) => /S3|SSH|DEPLOY_SSH|VAULT/.test(key))).toBe(
        false,
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

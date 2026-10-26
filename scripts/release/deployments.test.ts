import { expect, test } from 'bun:test';
import { chooseRollbackTarget, protectedReleases, readyArtifacts } from './deployments.ts';
import { ReleaseError } from './env.ts';
import type { ArtifactsPayload, Deployment, DeploymentState, ProductionPayload } from './github.ts';

const sha = (c: string) => c.repeat(40);
const ref = (c: string) => `ghcr.io/cringe-driven-development-team/bff@sha256:${c.repeat(64)}`;

let id = 0;
/** Запись production: от новых к старым, как отдаёт listDeployments. */
const prod = (
    commit: string,
    image: string,
    state: DeploymentState | undefined,
): Deployment<ProductionPayload> => ({
    id: ++id,
    sha: sha(commit),
    payload: {
        image_ref: ref(image),
        assets: `releases/${sha(commit)}/`,
        action: 'deploy',
        run: '',
    },
    createdAt: '',
    state,
});

test('после успешной выкатки откат — к предыдущему успешному с другим digest', () => {
    const target = chooseRollbackTarget([
        prod('c', 'c', 'success'),
        prod('c', 'c', 'success'), // повторная выкатка того же образа не цель
        prod('b', 'b', 'failure'),
        prod('a', 'a', 'success'),
    ]);
    expect(target).toMatchObject({ sha: sha('a'), imageRef: ref('a') });
});

test('после неудачной попытки откат — восстановление последнего успешного', () => {
    for (const state of ['failure', 'error'] as const) {
        const target = chooseRollbackTarget([
            prod('c', 'c', state),
            prod('b', 'b', 'success'),
            prod('a', 'a', 'success'),
        ]);
        expect(target).toMatchObject({ sha: sha('b'), imageRef: ref('b') });
    }
});

test('незавершённая или неизвестная попытка и отсутствие цели — ошибка до изменений', () => {
    for (const state of ['in_progress', 'queued', 'pending', undefined] as const) {
        expect(() =>
            chooseRollbackTarget([prod('b', 'b', state), prod('a', 'a', 'success')]),
        ).toThrow(ReleaseError);
    }
    expect(() => chooseRollbackTarget([])).toThrow('откатываться некуда');
    expect(() => chooseRollbackTarget([prod('a', 'a', 'success')])).toThrow('откатываться некуда');
    expect(() => chooseRollbackTarget([prod('a', 'a', 'failure')])).toThrow(
        'восстанавливать нечего',
    );
});

test('неоднозначный SHA → digest в истории — ошибка', () => {
    expect(() =>
        chooseRollbackTarget([
            prod('b', 'b', 'success'),
            prod('a', 'a', 'success'),
            prod('a', 'd', 'success'),
        ]),
    ).toThrow('цель неоднозначна');
});

test('inactive-записи не участвуют в выборе', () => {
    const target = chooseRollbackTarget([
        prod('c', 'c', 'inactive'),
        prod('b', 'b', 'success'),
        prod('a', 'a', 'success'),
    ]);
    expect(target.sha).toBe(sha('a'));
});

test('retention хранит текущий и предыдущий с другим digest, после неудачи — откладывает', () => {
    expect(
        protectedReleases([
            prod('c', 'c', 'success'),
            prod('c', 'c', 'success'),
            prod('a', 'a', 'success'),
        ]),
    ).toEqual([sha('c'), sha('a')]);
    expect(protectedReleases([prod('c', 'c', 'success')])).toEqual([sha('c')]);
    expect(protectedReleases([])).toEqual([]);
    for (const state of ['failure', 'error', 'in_progress', undefined] as const) {
        expect(
            protectedReleases([prod('c', 'c', state), prod('a', 'a', 'success')]),
        ).toBeUndefined();
    }
});

const artifacts = (
    commit: string,
    image: string,
    state: DeploymentState,
    assets = `releases/${sha(commit)}/`,
): Deployment<ArtifactsPayload> => ({
    id: ++id,
    sha: sha(commit),
    payload: { image_ref: ref(image), assets, ci_run: '' },
    createdAt: '',
    state,
});

test('готовый выпуск — успешная запись release-artifacts этого SHA', () => {
    expect(readyArtifacts([artifacts('a', 'a', 'success')], sha('a'))).toMatchObject({
        image_ref: ref('a'),
    });
    expect(readyArtifacts([artifacts('a', 'a', 'failure')], sha('a'))).toBeUndefined();
    expect(readyArtifacts([], sha('a'))).toBeUndefined();
    expect(() =>
        readyArtifacts([artifacts('a', 'a', 'success'), artifacts('a', 'b', 'success')], sha('a')),
    ).toThrow('разными образами');
    expect(() => readyArtifacts([artifacts('a', 'a', 'success', 'releases/x/')], sha('a'))).toThrow(
        'каталог',
    );
});

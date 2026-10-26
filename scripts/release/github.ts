import { ReleaseError, need } from './env.ts';

/** Окружения GitHub Deployments: готовые выпуски и история прода. */
export const ARTIFACTS_ENV = 'release-artifacts';
/** Окружение истории выкаток и откатов на прод. */
export const PRODUCTION_ENV = 'production';

/** Состояние статуса Deployment в GitHub. */
export type DeploymentState =
    | 'error'
    | 'failure'
    | 'inactive'
    | 'in_progress'
    | 'queued'
    | 'pending'
    | 'success';

/** Payload записи `release-artifacts`: что опубликовано для SHA. */
export interface ArtifactsPayload {
    image_ref: string;
    assets: string;
    ci_run: string;
}

/** Payload записи `production`: что выкатывалось и каким запуском. */
export interface ProductionPayload {
    image_ref: string;
    assets: string;
    action: 'deploy' | 'rollback';
    run: string;
}

/** Deployment GitHub с последним статусом. */
export interface Deployment<P> {
    id: number;
    sha: string;
    payload: P;
    createdAt: string;
    /** Последний статус; undefined — статуса ещё нет */
    state: DeploymentState | undefined;
}

interface RawDeployment {
    id: number;
    sha: string;
    payload: unknown;
    created_at: string;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const base = process.env.GITHUB_API_URL || 'https://api.github.com';
    const res = await fetch(`${base}/repos/${need('GITHUB_REPOSITORY')}${path}`, {
        ...init,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${need('GITHUB_TOKEN')}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
        throw new ReleaseError(
            `GitHub ${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`,
        );
    }
    return (await res.json()) as T;
}

function parsePayload(payload: unknown): unknown {
    // GitHub отдаёт payload объектом, но записи, созданные строкой, приходят строкой
    if (typeof payload !== 'string') return payload;
    try {
        return JSON.parse(payload);
    } catch {
        return undefined;
    }
}

/**
 * Deployments окружения, от новых к старым, с последним статусом каждого.
 * @param environment окружение
 * @param [sha] только записи этого коммита
 * @returns записи
 */
export async function listDeployments<P>(
    environment: string,
    sha?: string,
): Promise<Deployment<P>[]> {
    const query = new URLSearchParams({ environment, per_page: '100' });
    if (sha) query.set('sha', sha);
    const raw = await api<RawDeployment[]>(`/deployments?${query}`);
    const result: Deployment<P>[] = [];
    for (const item of raw) {
        const statuses = await api<{ state: DeploymentState }[]>(
            `/deployments/${item.id}/statuses?per_page=1`,
        );
        result.push({
            id: item.id,
            sha: item.sha,
            payload: parsePayload(item.payload) as P,
            createdAt: item.created_at,
            state: statuses[0]?.state,
        });
    }
    return result.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
}

/**
 * Создаёт запись Deployment без автоматического слияния и проверки статусов коммита.
 * @param options окружение, полный SHA, задача и payload
 * @param options.environment окружение
 * @param options.sha полный SHA выпуска
 * @param options.task `publish`, `deploy` или `rollback`
 * @param options.payload данные выпуска
 * @returns id записи
 */
export async function createDeployment(options: {
    environment: string;
    sha: string;
    task: string;
    payload: object;
}): Promise<number> {
    const production = options.environment === PRODUCTION_ENV;
    const created = await api<{ id: number }>('/deployments', {
        method: 'POST',
        body: JSON.stringify({
            ref: options.sha,
            task: options.task,
            environment: options.environment,
            payload: options.payload,
            auto_merge: false,
            required_contexts: [],
            production_environment: production,
            transient_environment: false,
            description: `${options.task} ${options.sha}`,
        }),
    });
    return created.id;
}

/**
 * Ставит статус записи Deployment.
 * @param id id записи
 * @param state новое состояние
 * @param description пояснение
 */
export async function setDeploymentState(
    id: number,
    state: DeploymentState,
    description: string,
): Promise<void> {
    await api(`/deployments/${id}/statuses`, {
        method: 'POST',
        body: JSON.stringify({
            state,
            description: description.slice(0, 140),
            log_url: runUrl(),
            // успех прежних выпусков не становится inactive: история нужна для выбора цели отката
            auto_inactive: false,
        }),
    });
}

/**
 * Ссылка на текущий запуск workflow.
 * @returns адрес запуска или пустая строка вне GitHub Actions
 */
export function runUrl(): string {
    const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
    if (!GITHUB_REPOSITORY || !GITHUB_RUN_ID) return '';
    return `${GITHUB_SERVER_URL || 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

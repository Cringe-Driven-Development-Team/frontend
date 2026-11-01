import { appendFileSync } from 'node:fs';
import { api, graphql, runUrl } from './github.ts';
import { need, ReleaseError } from './env.ts';
import {
    isDeployed,
    readReleaseSnapshot,
    readTrustedRun,
    type MergedPR,
    type ReleaseSnapshot,
} from './catalog.ts';
import { syncBoard, type BoardResult } from './board.ts';
import { ensureBaseline, prepareNotice } from './journal.ts';
import { queueMessage, readyMessage } from './notify.ts';

const REPOSITORY = 'Cringe-Driven-Development-Team/frontend';
/** Подготовка не отправляет Telegram; errors не скрывают независимые результаты. */
export interface SyncResult {
    allowed: boolean;
    board: BoardResult | null;
    prepared: number;
    errors: string[];
}
interface Event {
    action?: string;
    repository?: { full_name: string };
    workflow_run?: { id: number; event: string; head_branch: string };
    pull_request?: { number: number; base: { ref: string }; updated_at: string };
}
interface QueueEvent {
    id: string;
    createdAt: string;
    mergeQueue: { id: string };
}

async function queueEvents(number: number): Promise<QueueEvent[]> {
    const result: QueueEvent[] = [];
    let cursor: string | null = null;
    do {
        const data: {
            repository: {
                pullRequest: {
                    timelineItems: {
                        nodes: QueueEvent[];
                        pageInfo: { hasNextPage: boolean; endCursor: string | null };
                    };
                };
            };
        } = await graphql(
            `
                query QueueEvents($number: Int!, $cursor: String) {
                    repository(owner: "Cringe-Driven-Development-Team", name: "frontend") {
                        pullRequest(number: $number) {
                            timelineItems(
                                first: 100
                                after: $cursor
                                itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT]
                            ) {
                                nodes {
                                    ... on AddedToMergeQueueEvent {
                                        id
                                        createdAt
                                        mergeQueue {
                                            id
                                        }
                                    }
                                }
                                pageInfo {
                                    hasNextPage
                                    endCursor
                                }
                            }
                        }
                    }
                }
            `,
            { number, cursor },
            need('GITHUB_TOKEN'),
        );
        const connection = data.repository.pullRequest.timelineItems;
        result.push(...connection.nodes);
        cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
        if (connection.pageInfo.hasNextPage && !cursor)
            throw new ReleaseError('Queue timeline: нет курсора');
    } while (cursor);
    return result;
}

async function prepareQueue(baseline: string, source: Event, repoDir: string): Promise<number> {
    const data = await graphql<{ repository: { mergeQueue: { id: string } | null } }>(
        `
            query MainQueue {
                repository(owner: "Cringe-Driven-Development-Team", name: "frontend") {
                    mergeQueue(branch: "main") {
                        id
                    }
                }
            }
        `,
        {},
        need('GITHUB_TOKEN'),
    );
    const queueId = data.repository.mergeQueue?.id;
    if (!queueId) return 0;
    const main = Bun.spawnSync(['git', 'rev-parse', 'origin/main'], { cwd: repoDir });
    if (main.exitCode) throw new ReleaseError('Нет origin/main для уведомления очереди');
    const ref = main.stdout.toString().trim();
    let count = 0;
    let foundSource = false;
    for (let page = 1; ; page++) {
        const prs = await api<{ number: number; updated_at: string }[]>(
            `/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
        );
        for (const pr of prs) {
            if (Date.parse(pr.updated_at) < Date.parse(baseline)) continue;
            let events = await queueEvents(pr.number);
            if (
                process.env.GITHUB_EVENT_NAME === 'pull_request_target' &&
                source.pull_request?.number === pr.number
            ) {
                const since = Math.max(
                    Date.parse(baseline),
                    Date.parse(source.pull_request.updated_at),
                );
                for (
                    let attempt = 0;
                    !events.some(
                        (event) =>
                            event.mergeQueue?.id === queueId &&
                            Date.parse(event.createdAt) >= since,
                    ) && attempt < 5;
                    attempt++
                ) {
                    await Bun.sleep(2000);
                    events = await queueEvents(pr.number);
                }
                if (
                    !events.some(
                        (event) =>
                            event.mergeQueue?.id === queueId &&
                            Date.parse(event.createdAt) >= since,
                    )
                )
                    throw new ReleaseError(`PR #${pr.number}: enqueue ещё не появился в timeline`);
                foundSource = true;
            }
            for (const event of events) {
                if (!event.id || !Number.isFinite(Date.parse(event.createdAt)))
                    throw new ReleaseError('Некорректное событие queue timeline');
                if (
                    event.mergeQueue?.id !== queueId ||
                    Date.parse(event.createdAt) < Date.parse(baseline)
                )
                    continue;
                const prRef = {
                    number: pr.number,
                    url: `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${REPOSITORY}/pull/${pr.number}`,
                };
                if (
                    (await prepareNotice({
                        kind: 'queue',
                        key: `queue:${event.id}`,
                        ref,
                        source: prRef.url,
                        message: queueMessage(prRef),
                        prNumbers: [pr.number],
                        reportUrl: null,
                    })) === 'created'
                )
                    count++;
            }
        }
        if (prs.length < 100) break;
    }
    if (process.env.GITHUB_EVENT_NAME === 'pull_request_target' && !foundSource)
        throw new ReleaseError('Исходный PR очереди не найден среди обновлённых PR');
    return count;
}

async function prepareReady(
    snapshot: ReleaseSnapshot,
    baseline: string,
    repoDir: string,
): Promise<number> {
    let count = 0;
    const known = new Set<number>();
    const summary = need('GITHUB_STEP_SUMMARY');
    const reportUrl = `${runUrl()}#summary`;
    if (!runUrl()) throw new ReleaseError('Нет текущего Actions run для полного отчёта');
    for (const release of snapshot.published) {
        const prs: MergedPR[] = release.prNumbers
            .filter((number) => !known.has(number))
            .map((number) => snapshot.prs.get(number)!);
        for (const number of release.prNumbers) known.add(number);
        if (Date.parse(release.readyAt) < Date.parse(baseline)) {
            console.log(`release ${release.sha}: историческая публикация, без рассылки`);
            continue;
        }
        if (await isDeployed(release.sha, snapshot.deployedShas, repoDir)) {
            console.log(`release ${release.sha}: уже входил в production, без сообщения ожидания`);
            continue;
        }
        appendFileSync(
            summary,
            `\n## Выпуск ${release.sha}\n\n[CI](${release.ciRun}) · [Deployment](https://api.github.com/repos/${REPOSITORY}/deployments/${release.id})\n\n${prs.length ? prs.map((pr) => `- [#${pr.number}](${pr.url})`).join('\n') : 'Новых PR нет.'}\n`,
        );
        if (
            (await prepareNotice({
                kind: 'ready',
                key: `ready:${release.sha}`,
                ref: release.sha,
                source: release.ciRun,
                message: readyMessage(release, prs, reportUrl),
                prNumbers: prs.map((pr) => pr.number),
                reportUrl,
            })) === 'created'
        )
            count++;
    }
    return count;
}

/** Проверяет источник и готовит независимые изменения доски/уведомления для следующего шага. */
export async function prepareAutomation(repoDir: string): Promise<SyncResult> {
    const result: SyncResult = { allowed: false, board: null, prepared: 0, errors: [] };
    const recordError = (error: unknown) =>
        result.errors.push(error instanceof Error ? error.message : String(error));
    let event: Event;
    let baseline: string;
    try {
        if (
            process.env.GITHUB_REPOSITORY !== REPOSITORY ||
            process.env.GITHUB_REF !== 'refs/heads/main'
        )
            return result;
        event = (await Bun.file(need('GITHUB_EVENT_PATH')).json()) as Event;
        if (event.repository?.full_name !== REPOSITORY) return result;
        switch (process.env.GITHUB_EVENT_NAME) {
            case 'workflow_dispatch':
                break;
            case 'workflow_run': {
                const source = event.workflow_run;
                if (
                    !source ||
                    source.head_branch !== 'main' ||
                    !['push', 'workflow_dispatch'].includes(source.event)
                )
                    return result;
                const trusted = await readTrustedRun(source.id);
                if ((source.event === 'push') !== (trusted.kind === 'publish'))
                    throw new ReleaseError('Событие workflow_run не совпало с Actions API');
                break;
            }
            case 'pull_request_target':
                if (event.action !== 'enqueued' || event.pull_request?.base.ref !== 'main')
                    return result;
                break;
            default:
                return result;
        }
        result.allowed = true;
        baseline = await ensureBaseline(repoDir);
    } catch (error) {
        recordError(error);
        return result;
    }
    let snapshot: ReleaseSnapshot | undefined;
    try {
        snapshot = await readReleaseSnapshot(repoDir);
    } catch (error) {
        recordError(error);
    }
    try {
        result.prepared += await prepareQueue(baseline, event, repoDir);
    } catch (error) {
        recordError(error);
    }
    if (snapshot) {
        try {
            result.prepared += await prepareReady(snapshot, baseline, repoDir);
        } catch (error) {
            recordError(error);
        }
        try {
            result.board = await syncBoard(snapshot, repoDir);
            result.errors.push(...result.board.errors);
        } catch (error) {
            recordError(error);
        }
    }
    return result;
}

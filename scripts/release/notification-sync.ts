import { appendFileSync } from 'node:fs';
import { api, graphql, runUrl } from './github.ts';
import { need, ReleaseError } from './env.ts';
import {
    isDeployed,
    readReleaseCatalog,
    type MergedPR,
    type ReleaseCatalog,
    type TrustedRun,
} from './catalog.ts';
import { ensureBaseline, prepareNotice } from './journal.ts';
import { queueMessage, readyMessage } from './notify.ts';
import { readAutomationSource, type AutomationSource } from './source.ts';

const REPOSITORY = 'Cringe-Driven-Development-Team/frontend';
/** Итог подготовки одной фазы; доставка выполняется отдельным шагом. */
export interface NotificationResult {
    allowed: boolean;
    prepared: number;
    kind: 'queue' | 'ready' | 'all';
    firstKey?: string;
    errors: string[];
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

async function prepareQueue(
    baseline: string,
    repoDir: string,
    source?: Extract<AutomationSource, { kind: 'queue' }>,
): Promise<{ count: number; firstKey?: string }> {
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
    if (!queueId) return { count: 0 };
    const main = Bun.spawnSync(['git', 'rev-parse', 'origin/main'], { cwd: repoDir });
    if (main.exitCode) throw new ReleaseError('Нет origin/main для уведомления очереди');
    const ref = main.stdout.toString().trim();
    let count = 0;
    let firstKey: string | undefined;
    for (let page = 1; ; page++) {
        const prs = source
            ? [{ number: source.number, updated_at: source.updatedAt }]
            : await api<{ number: number; updated_at: string }[]>(
                  `/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
              );
        for (const pr of prs) {
            if (Date.parse(pr.updated_at) < Date.parse(baseline)) continue;
            const since = source
                ? Math.max(Date.parse(baseline), Date.parse(source.updatedAt))
                : Date.parse(baseline);
            const matching = async () =>
                (await queueEvents(pr.number))
                    .filter((event) => {
                        if (!event.id || !Number.isFinite(Date.parse(event.createdAt)))
                            throw new ReleaseError('Некорректное событие queue timeline');
                        return (
                            event.mergeQueue?.id === queueId && Date.parse(event.createdAt) >= since
                        );
                    })
                    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
            let events = await matching();
            if (source) {
                for (let attempt = 0; !events.length && attempt < 5; attempt++) {
                    await Bun.sleep(2000);
                    events = await matching();
                }
                if (!events.length)
                    throw new ReleaseError(`PR #${pr.number}: enqueue ещё не появился в timeline`);
                events = events.slice(0, 1);
            }
            for (const event of events) {
                const prRef = {
                    number: pr.number,
                    url: `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${REPOSITORY}/pull/${pr.number}`,
                };
                const key = `queue:${event.id}`;
                if (
                    (await prepareNotice({
                        kind: 'queue',
                        key,
                        ref,
                        source: prRef.url,
                        message: queueMessage(prRef),
                        prNumbers: [pr.number],
                        reportUrl: null,
                    })) === 'created'
                )
                    count++;
                if (source) firstKey = key;
            }
        }
        if (source || prs.length < 100) break;
    }
    return { count, firstKey };
}

async function prepareReady(
    snapshot: ReleaseCatalog,
    baseline: string,
    repoDir: string,
    current?: TrustedRun,
): Promise<{ count: number; firstKey?: string }> {
    let count = 0;
    let firstKey: string | undefined;
    const known = new Set<number>();
    const summary = need('GITHUB_STEP_SUMMARY');
    const reportUrl = `${runUrl()}#summary`;
    if (!runUrl()) throw new ReleaseError('Нет текущего Actions run для полного отчёта');
    for (const release of snapshot.published) {
        const prs: MergedPR[] = release.prNumbers
            .filter((number) => !known.has(number))
            .map((number) => snapshot.prs.get(number)!);
        for (const number of release.prNumbers) known.add(number);
        if (current && (release.sha !== current.sha || release.ciRun !== current.url)) continue;
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
        if (current) firstKey = `ready:${release.sha}`;
    }
    return { count, firstKey };
}

/** Готовит текущее уведомление либо восстанавливает пропущенные, без Project API. */
export async function prepareNotifications(
    repoDir: string,
    phase: 'current' | 'recover',
): Promise<NotificationResult> {
    const result: NotificationResult = { allowed: false, prepared: 0, kind: 'all', errors: [] };
    const recordError = (error: unknown) =>
        result.errors.push(error instanceof Error ? error.message : String(error));
    let source: AutomationSource;
    let baseline: string;
    try {
        const checked = await readAutomationSource();
        if (!checked) return result;
        source = checked;
        result.allowed = true;
        result.kind = source.kind === 'queue' ? 'queue' : 'all';
        if (
            phase === 'current' &&
            source.kind !== 'queue' &&
            !(source.kind === 'workflow' && source.run.kind === 'publish')
        )
            return result;
        baseline = await ensureBaseline(repoDir);
    } catch (error) {
        recordError(error);
        return result;
    }
    if (phase === 'current') {
        try {
            if (source.kind === 'queue') {
                const prepared = await prepareQueue(baseline, repoDir, source);
                result.prepared = prepared.count;
                result.firstKey = prepared.firstKey;
            } else if (source.kind === 'workflow') {
                result.kind = 'ready';
                const prepared = await prepareReady(
                    await readReleaseCatalog(repoDir),
                    baseline,
                    repoDir,
                    source.run,
                );
                result.prepared = prepared.count;
                result.firstKey = prepared.firstKey;
            }
        } catch (error) {
            recordError(error);
        }
    } else {
        try {
            result.prepared += (await prepareQueue(baseline, repoDir)).count;
        } catch (error) {
            recordError(error);
        }
        if (source.kind !== 'queue') {
            try {
                result.prepared += (
                    await prepareReady(await readReleaseCatalog(repoDir), baseline, repoDir)
                ).count;
            } catch (error) {
                recordError(error);
            }
        }
    }
    return result;
}

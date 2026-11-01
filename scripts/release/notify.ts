import { appendFileSync } from 'node:fs';
import { readPRChanges, type PRChanges } from './catalog.ts';
import { ReleaseError, checkSha, isSha, need, siteUrl } from './env.ts';
import { runUrl } from './github.ts';
import type { MergedPR, PublishedRelease } from './catalog.ts';

/** Сообщение и кнопки существующей темы выкаток. */
export interface TelegramMessage {
    text: string;
    keyboard?: { text: string; url: string }[][];
}
/** Подтверждённый отказ без доставки; его безопасно повторить. */
export class TelegramRejectedError extends ReleaseError {}

/** Единственный транспорт Telegram; возвращает подтверждённый message_id. */
export async function sendTelegram(message: TelegramMessage): Promise<number> {
    const token = need('TELEGRAM_BOT_TOKEN');
    const chat = need('TELEGRAM_CHAT_ID');
    const topic = process.env.TELEGRAM_TOPIC_ID;
    if (topic && (!Number.isSafeInteger(Number(topic)) || Number(topic) <= 0))
        throw new TelegramRejectedError('Некорректный TELEGRAM_TOPIC_ID');
    try {
        const res = await fetch(
            `${process.env.TELEGRAM_API || 'https://api.telegram.org'}/bot${token}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chat,
                    text: message.text,
                    parse_mode: 'HTML',
                    link_preview_options: { is_disabled: true },
                    ...(message.keyboard?.length
                        ? { reply_markup: { inline_keyboard: message.keyboard } }
                        : {}),
                    ...(topic ? { message_thread_id: Number(topic) } : {}),
                }),
                signal: AbortSignal.timeout(20_000),
            },
        );
        const body = (await res.json()) as { ok?: boolean; result?: { message_id?: number } };
        if (res.status >= 400 && res.status < 500 && body.ok === false)
            throw new TelegramRejectedError(`Telegram отклонил сообщение: HTTP ${res.status}`);
        const id = body.result?.message_id;
        if (!res.ok || body.ok !== true || !Number.isSafeInteger(id) || id! <= 0)
            throw new ReleaseError('Telegram: доставка не подтверждена');
        return id!;
    } catch (error) {
        if (error instanceof TelegramRejectedError) throw error;
        // Текст сетевой ошибки может содержать bot token в URL.
        throw new ReleaseError('Telegram: доставка не подтверждена; проверьте тему перед повтором');
    }
}

function escape(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function revision(sha: string | undefined, repo: string): string {
    return sha && isSha(sha)
        ? `<a href="${repo}/commit/${sha}">${sha.slice(0, 7)}</a>`
        : 'неизвестна';
}

function button(text: string, url: string): { text: string; url: string } {
    return { text, url };
}

/** Постановка конкретного PR в очередь, без обещания позиции. */
export function queueMessage(pr: Pick<MergedPR, 'number' | 'url'>): TelegramMessage {
    return { text: `<a href="${escape(pr.url)}">PR #${pr.number}</a> поставлен в очередь` };
}

/** Готовый выпуск с полным списком PR либо ссылкой на полный отчёт при переполнении. */
export function readyMessage(
    release: PublishedRelease,
    prs: readonly MergedPR[],
    reportUrl: string,
): TelegramMessage {
    const header = [
        '📦 Релиз фронта залит, ждёт выкатки',
        `Релиз <code>${release.sha}</code>`,
        `Образ BFF <code>${escape(release.imageRef.split('@')[1]!)}</code>`,
        `<a href="${escape(release.ciRun)}">CI выпуска</a>`,
    ];
    const full = [
        ...header,
        ...(prs.length
            ? prs.map((pr) => `• <a href="${escape(pr.url)}">#${pr.number}</a>`)
            : ['Новых PR нет.']),
    ].join('\n');
    const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' };
    const visible = full
        .replace(/<[^>]*>/g, '')
        .replace(/&(amp|lt|gt|quot);/g, (_, name: string) => entities[name]!);
    const text =
        [...visible].length <= 4096
            ? full
            : [
                  ...header,
                  `PR в выпуске: ${prs.length}`,
                  `<a href="${escape(reportUrl)}">Все PR выпуска</a>`,
              ].join('\n');
    return {
        text,
        keyboard: [
            [
                button(
                    'Выкатить',
                    `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${need('GITHUB_REPOSITORY')}/actions/workflows/cd.yml`,
                ),
            ],
        ],
    };
}

function markdown(value: string): string {
    return escape(value)
        .replace(/[\\`*_[\]()]/g, '\\$&')
        .replace(/[\r\n]+/g, ' ');
}

async function changes(
    base: string | undefined,
    head: string | undefined,
): Promise<{ data?: PRChanges; reportUrl?: string }> {
    let data: PRChanges | undefined;
    try {
        data = await readPRChanges(checkSha(base), checkSha(head));
    } catch {
        console.warn('::warning::Состав изменений недоступен; отправляем результат выкатки.');
    }
    let reportUrl: string | undefined;
    try {
        const url = runUrl();
        if (!url) throw new ReleaseError('Нет текущего Actions run');
        const report = [
            '## Состав выпуска',
            `${base && isSha(base) ? base : 'неизвестно'} → ${head && isSha(head) ? head : 'неизвестно'}`,
            ...(data
                ? [
                      `[Сравнение версий](${data.compareUrl})`,
                      ...data.prs.map((pr) =>
                          [
                              `- [#${pr.number}: ${markdown(pr.title)}](${pr.url})`,
                              ...data.issues
                                  .filter((issue) => issue.prNumbers.includes(pr.number))
                                  .map(
                                      (issue) =>
                                          `  - [${markdown(issue.title)}](${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${issue.repo}/issues/${issue.number})`,
                                  ),
                          ].join('\n'),
                      ),
                      ...(data.prs.length ? [] : ['Связанных PR нет']),
                  ]
                : ['Отчёт неполный: Состав изменений недоступен']),
        ].join('\n\n');
        appendFileSync(need('GITHUB_STEP_SUMMARY'), `\n${report}\n`);
        reportUrl = `${url}#summary`;
    } catch {
        console.warn('::warning::Полный отчёт недоступен; отправляем результат выкатки.');
    }
    return { data, reportUrl };
}

function titleLink(title: string, url: string): string {
    const chars = [...title.replace(/\s+/g, ' ')];
    const text = chars.length > 140 ? `${chars.slice(0, 139).join('')}…` : chars.join('');
    return `• <a href="${escape(url)}">${escape(text)}</a>`;
}

function taskLines(data: PRChanges): string[] {
    return [
        ...data.issues.map((issue) =>
            titleLink(
                issue.title,
                `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${issue.repo}/issues/${issue.number}`,
            ),
        ),
        ...data.prs
            .filter((pr) => !data.issues.some((issue) => issue.prNumbers.includes(pr.number)))
            .map((pr) => titleLink(pr.title, pr.url)),
        ...(data.prs.length ? [] : ['Связанных PR нет']),
    ];
}

function visibleLength(text: string): number {
    return [...text.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot);/g, '_')].length;
}

function fitList(before: string[], entries: string[], after: string[], reportUrl?: string): string {
    const footer = reportUrl
        ? `<a href="${escape(reportUrl)}">Полный список PR и задач</a>`
        : 'Полный отчёт недоступен';
    const selected: string[] = [];
    for (const entry of entries) {
        if (visibleLength([...before, ...selected, entry, footer, ...after].join('\n')) > 4096)
            break;
        selected.push(entry);
    }
    return [
        ...before,
        ...selected,
        ...(selected.length < entries.length ? [footer] : []),
        ...after,
    ].join('\n');
}

function deploymentState(status: string): string[] {
    const env = process.env;
    const stages = [
        ['RELEASE_TARGET_STATUS', 'Выбор цели отката'],
        ['RELEASE_ARTIFACTS_STATUS', 'Готовый выпуск'],
        ['RELEASE_IMAGE_STATUS', 'Проверка образа'],
        ['RELEASE_CHECK_STATUS', 'Release check'],
        ['RELEASE_START_STATUS', 'Запись production'],
        ['RELEASE_SWITCH_STATUS', 'Переключение BFF'],
        ['RELEASE_HEALTH_STATUS', 'Health check'],
        ['RELEASE_RETENTION_STATUS', 'Retention'],
    ];
    const failed = stages.find(([key]) => env[key!] === 'failure' || env[key!] === 'cancelled');
    const lines = failed
        ? [`<b>Этап сбоя:</b> ${failed[1]}`]
        : status === 'success'
          ? []
          : ['<b>Этап сбоя:</b> не определён — см. логи запуска.'];
    lines.push(
        `Health Check ${env.RELEASE_HEALTH_STATUS === 'success' ? '✅' : env.RELEASE_HEALTH_STATUS === 'failure' ? '❌' : '⚪'}`,
    );
    // результат этого запуска — по его проверкам, а не по истории GitHub
    if (env.RELEASE_HEALTH_STATUS === 'success') {
        return lines;
    } else if (env.RELEASE_SWITCH_STATUS === 'success') {
        lines.push(
            env.RELEASE_HEALTH_STATUS === 'failure'
                ? '<b>Этот запуск:</b> BFF переключён, проверка прода не пройдена.'
                : '<b>Этот запуск:</b> BFF переключён, результат проверки неизвестен.',
        );
        lines.push('Проверьте сайт и логи; при необходимости запустите откат.');
    } else if (
        env.RELEASE_SWITCH_STATUS === 'failure' ||
        env.RELEASE_SWITCH_STATUS === 'cancelled'
    ) {
        lines.push(
            '<b>Этот запуск:</b> переключение не завершилось — .env и Compose восстановлены, ' +
                'но контейнер мог смениться: состояние прода неизвестно, смотрите логи.',
        );
    } else {
        lines.push('<b>Этот запуск:</b> прод не менялся — переключение не выполнялось.');
    }
    return lines;
}

function digestOf(ref: string | undefined): string | undefined {
    return /@sha256:([0-9a-f]{64})$/.exec(ref ?? '')?.[1];
}

function mentionActor(actor: string, rawMap: string | undefined): string {
    const escaped = actor.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    if (!rawMap) return escaped;
    try {
        const map: unknown = JSON.parse(rawMap);
        if (!map || typeof map !== 'object' || Array.isArray(map) || !Object.hasOwn(map, actor))
            return escaped;
        const value: unknown = (map as Record<string, unknown>)[actor];
        const valid =
            typeof value === 'string'
                ? /^[1-9][0-9]*$/.test(value)
                : typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
        if (valid) return `<a href="tg://user?id=${value}">${escaped}</a>`;
    } catch {
        return escaped;
    }
    return escaped;
}

/**
 * Сообщение в Telegram о результате заливки, выкатки или отката.
 * @param what тип события: publish, deploy, rollback или start
 * @param status итог job: success, failure или cancelled
 * @param [sha] sha релиза
 */
export async function notify(what: string, status: string, sha?: string): Promise<void> {
    if (what === 'start') {
        if (status !== 'success')
            throw new ReleaseError('Начало выкатки отправляется только перед Switch');
        checkSha(sha);
        const actor = process.env.GITHUB_TRIGGERING_ACTOR || process.env.GITHUB_ACTOR;
        const report = await changes(process.env.RELEASE_BEFORE_SHA, sha);
        const entries = report.data
            ? report.data.prs.length
                ? report.data.prs.map((pr) => titleLink(pr.title, pr.url))
                : ['Связанных PR нет']
            : ['Состав изменений недоступен'];
        await sendTelegram({
            text: fitList(
                ['Выкатка началась'],
                entries,
                actor ? [`Запустил: ${mentionActor(actor, process.env.TELEGRAM_USER_MAP)}`] : [],
                report.reportUrl,
            ),
            keyboard: [[button('Логи выкатки', runUrl())]],
        });
        return;
    }
    const label = new Map([
        ['publish', 'Заливка'],
        ['deploy', 'Выкатка'],
        ['rollback', 'Откат'],
    ]).get(what);
    if (!label) throw new ReleaseError(`Неизвестный тип уведомления: ${what}`);
    const { GITHUB_ACTOR, GITHUB_REPOSITORY } = process.env;

    // залитый релиз пользователи не видят: выкатывает его человек, кнопка ведёт на запуск CD
    const uploaded = what === 'publish' && status === 'success';
    const lines = [
        uploaded
            ? '📦 Релиз фронта залит, ждёт выкатки'
            : status === 'success'
              ? `✅ ${label} фронта: успешно`
              : status === 'cancelled'
                ? `⚪ ${label} фронта: отменено`
                : `❌ ${label} фронта: ошибка`,
    ];
    if (sha) lines.push(`Релиз <code>${sha}</code>`);
    const digest = digestOf(process.env.RELEASE_IMAGE_REF);
    if (digest) lines.push(`Образ BFF <code>sha256:${digest}</code>`);
    if (GITHUB_ACTOR)
        lines.push(`Запустил: ${mentionActor(GITHUB_ACTOR, process.env.TELEGRAM_USER_MAP)}`);
    const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
    const repo = `${server}/${GITHUB_REPOSITORY}`;
    const keyboard = uploaded ? [[button('Выкатить', `${repo}/actions/workflows/cd.yml`)]] : [];
    let text = lines.join('\n');
    if (what === 'deploy' || what === 'rollback') {
        const before = process.env.RELEASE_BEFORE_SHA;
        const report = await changes(
            what === 'rollback' ? sha : before,
            what === 'rollback' ? before : sha,
        );
        const entries = report.data ? taskLines(report.data) : ['Состав изменений недоступен'];
        if (report.data && report.data.prs.length > 6 && !report.reportUrl)
            entries.push('Полный отчёт недоступен');
        text = fitList(
            [
                `<b>${lines[0]}</b>`,
                `${escape(siteUrl())} · production`,
                '',
                `<b>Версия:</b> ${revision(before, repo)} → ${revision(sha, repo)}`,
                '<i>Слева — последний подтверждённый выпуск по истории GitHub Deployments: он показывает прошлую проверку, а не то, что запущено сейчас.</i>',
                '',
                `<b>${what === 'rollback' ? 'Отменённые задачи' : 'Задачи'}</b>`,
            ],
            entries,
            ['', ...deploymentState(status), '', ...lines.slice(1)],
            report.reportUrl,
        );
        if (
            status === 'success' ||
            ['success', 'failure', 'cancelled'].includes(process.env.RELEASE_SWITCH_STATUS ?? '')
        ) {
            keyboard.push([
                button('🌐 Открыть прод', siteUrl()),
                button('↩️ Откатить', `${repo}/actions/workflows/rollback.yml`),
            ]);
        }
        const prs = report.data?.prs ?? [];
        if (prs.length > 6) {
            if (report.reportUrl) keyboard.push([button('Все PR выпуска', report.reportUrl)]);
        } else {
            const buttons = prs.map((pr) =>
                button(prs.length === 1 ? 'PR' : `PR #${pr.number}`, pr.url),
            );
            for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
        }
        if (process.env.GITHUB_RUN_ID)
            keyboard.push([button(what === 'rollback' ? 'Логи отката' : 'Логи выкатки', runUrl())]);
    }
    await sendTelegram({ text, keyboard });
}

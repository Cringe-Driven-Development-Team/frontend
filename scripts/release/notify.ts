import { ReleaseError, isSha, need, siteUrl } from './env.ts';
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

async function changes(range: string | undefined): Promise<string[]> {
    if (!range) return ['Список изменений недоступен: предыдущая версия неизвестна.'];
    try {
        const api = process.env.GITHUB_API_URL || 'https://api.github.com';
        const res = await fetch(
            `${api}/repos/${process.env.GITHUB_REPOSITORY}/compare/${range}?per_page=100`,
            {
                headers: {
                    Accept: 'application/vnd.github+json',
                    ...(process.env.GITHUB_TOKEN
                        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
                        : {}),
                },
                signal: AbortSignal.timeout(5000),
            },
        );
        if (!res.ok) throw new Error(`GitHub: ${res.status}`);
        const data = (await res.json()) as {
            total_commits: number;
            commits: { commit: { message: string } }[];
        };
        const entries = data.commits.slice(0, 3).map(({ commit }) => {
            const message = commit.message.startsWith('Merge pull request ')
                ? commit.message.split('\n').filter(Boolean).slice(1).join(' ')
                : commit.message.split('\n')[0]!;
            return `• ${escape(message.replace(/\s+/g, ' ').slice(0, 140))}`;
        });
        const remaining = data.total_commits - entries.length;
        if (remaining > 0) {
            const last = remaining % 10;
            const word =
                remaining % 100 >= 11 && remaining % 100 <= 14
                    ? 'коммитов'
                    : last === 1
                      ? 'коммит'
                      : last >= 2 && last <= 4
                        ? 'коммита'
                        : 'коммитов';
            entries.push(`Ещё ${remaining} ${word} — в сравнении.`);
        }
        return entries.length ? entries : ['Нет изменений между этими версиями.'];
    } catch {
        console.warn(
            '::warning::Список изменений GitHub недоступен; отправляем карточку со ссылками.',
        );
        return ['Список изменений недоступен — откройте сравнение версий.'];
    }
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
    // результат этого запуска — по его проверкам, а не по истории GitHub
    if (env.RELEASE_HEALTH_STATUS === 'success') {
        lines.push(
            '<b>Этот запуск:</b> проверен — работает выбранный образ, HTML, RPC и ассеты в порядке.',
        );
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
 * @param what что произошло: Заливка, Выкатка или Откат
 * @param status итог job: success, failure или cancelled
 * @param [sha] sha релиза
 */
export async function notify(what: string, status: string, sha?: string): Promise<void> {
    const { GITHUB_ACTOR, GITHUB_REPOSITORY } = process.env;

    // залитый релиз пользователи не видят: выкатывает его человек, кнопка ведёт на запуск CD
    const uploaded = what === 'Заливка' && status === 'success';
    const lines = [
        uploaded
            ? '📦 Релиз фронта залит, ждёт выкатки'
            : status === 'success'
              ? `✅ ${what} фронта: успешно`
              : status === 'cancelled'
                ? `⚪ ${what} фронта: отменено`
                : `❌ ${what} фронта: ошибка`,
    ];
    if (sha) lines.push(`Релиз <code>${sha}</code>`);
    const digest = digestOf(process.env.RELEASE_IMAGE_REF);
    if (digest) lines.push(`Образ BFF <code>sha256:${digest}</code>`);
    if (GITHUB_ACTOR)
        lines.push(`Запустил: ${mentionActor(GITHUB_ACTOR, process.env.TELEGRAM_USER_MAP)}`);
    const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
    const repo = `${server}/${GITHUB_REPOSITORY}`;
    const keyboard = uploaded ? [[button('Выкатить', `${repo}/actions/workflows/cd.yml`)]] : [];
    if (what === 'Выкатка' || what === 'Откат') {
        lines[0] = `<b>${lines[0]}</b>`;
        const before = process.env.RELEASE_BEFORE_SHA;
        const range =
            before && isSha(before) && sha && isSha(sha)
                ? what === 'Откат'
                    ? `${sha}...${before}`
                    : `${before}...${sha}`
                : undefined;
        // полные SHA и digest остаются в тексте, после хода выпуска
        lines.splice(
            1,
            0,
            `${escape(siteUrl())} · production`,
            '',
            `<b>Версия:</b> ${revision(before, repo)} → ${revision(sha, repo)}`,
            '<i>Слева — последний подтверждённый выпуск по истории GitHub Deployments: он показывает ' +
                'прошлую проверку, а не то, что запущено сейчас.</i>',
            '',
            `<b>${what === 'Откат' ? 'Отменённые изменения' : 'Изменения'}</b>`,
            ...(await changes(range)),
            '',
            ...deploymentState(status),
            '',
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
        const links = [
            button(
                'Изменения',
                range
                    ? `${repo}/compare/${range}`
                    : `${repo}/commits/${sha && isSha(sha) ? sha : 'main'}`,
            ),
        ];
        if (process.env.GITHUB_RUN_ID)
            links.push(
                button(
                    what === 'Откат' ? 'Логи отката' : 'Логи выкатки',
                    `${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
                ),
            );
        keyboard.push(links);
    }
    await sendTelegram({ text: lines.join('\n'), keyboard });
}

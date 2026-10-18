import { ReleaseError, isSha, need, siteUrl } from './env.ts';

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
        ['RELEASE_PREVIOUS_STATUS', 'Поиск предыдущего релиза'],
        ['RELEASE_EXISTS_STATUS', 'Release exists'],
        ['RELEASE_CHECK_STATUS', 'Release check'],
        ['RELEASE_SWITCH_STATUS', 'Переключение версии'],
        ['RELEASE_HEALTH_STATUS', 'Health check'],
        ['RELEASE_RETENTION_STATUS', 'Retention'],
    ];
    const failed = stages.find(([key]) => env[key!] === 'failure' || env[key!] === 'cancelled');
    const lines = failed
        ? [`<b>Этап сбоя:</b> ${failed[1]}`]
        : status === 'success'
          ? []
          : ['<b>Этап сбоя:</b> не определён — см. логи запуска.'];
    if (env.RELEASE_HEALTH_STATUS === 'success') {
        lines.push('<b>Проверка прода:</b> пройдена — сайт отдаёт целевую версию.');
    } else if (env.RELEASE_INDEX_PUBLISHED === 'true') {
        lines.push(
            env.RELEASE_HEALTH_STATUS === 'failure'
                ? '<b>Прод:</b> Версия переключена, проверка прода не пройдена.'
                : '<b>Прод:</b> Версия переключена, результат проверки неизвестен.',
        );
        lines.push(
            env.RELEASE_SWITCH_STATUS === 'failure'
                ? 'Указатель current.json мог не обновиться: проверьте его и логи перед откатом.'
                : 'Проверьте сайт и логи; при необходимости запустите откат.',
        );
    } else if (env.RELEASE_SWITCH_STATUS === 'skipped') {
        lines.push('<b>Прод:</b> Переключение не выполнялось.');
    } else {
        lines.push('<b>Прод:</b> Переключение не подтверждено — проверьте сайт и логи.');
    }
    return lines;
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
    const token = need('TELEGRAM_BOT_TOKEN');
    const chat = need('TELEGRAM_CHAT_ID');
    const topic = process.env.TELEGRAM_TOPIC_ID;
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
        lines.splice(
            1,
            sha ? 1 : 0,
            `${escape(siteUrl())} · production`,
            '',
            `<b>Версия:</b> ${revision(before, repo)} → ${revision(sha, repo)}`,
            '',
            `<b>${what === 'Откат' ? 'Отменённые изменения' : 'Изменения'}</b>`,
            ...(await changes(range)),
            '',
            ...deploymentState(status),
        );
        const switched = process.env.RELEASE_INDEX_PUBLISHED === 'true';
        if (
            status === 'success' ||
            switched ||
            ['failure', 'cancelled'].includes(process.env.RELEASE_SWITCH_STATUS ?? '')
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
    const api = process.env.TELEGRAM_API || 'https://api.telegram.org';
    const res = await fetch(`${api}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chat,
            text: lines.join('\n'),
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
            ...(topic ? { message_thread_id: Number(topic) } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new ReleaseError(`Telegram не принял сообщение: ответ ${res.status}`);
}

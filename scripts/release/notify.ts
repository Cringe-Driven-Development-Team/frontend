import { ReleaseError, need } from './env.ts';

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
    const api = process.env.TELEGRAM_API || 'https://api.telegram.org';
    const res = await fetch(`${api}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chat,
            text: lines.join('\n'),
            parse_mode: 'HTML',
            ...(uploaded
                ? {
                      reply_markup: {
                          inline_keyboard: [
                              [{ text: 'Выкатить', url: `${repo}/actions/workflows/cd.yml` }],
                          ],
                      },
                  }
                : {}),
            ...(topic ? { message_thread_id: Number(topic) } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new ReleaseError(`Telegram не принял сообщение: ответ ${res.status}`);
}

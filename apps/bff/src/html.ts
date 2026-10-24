import serialize from 'serialize-javascript';

import { createGo } from './go/api.ts';
import { SessionEnded } from './session/refresh.ts';
import { createSession } from './session/session.ts';
import type { BootstrapData } from './types.ts';

const HTML_HEADERS = {
    'Content-Type': 'text/html; charset=UTF-8',
    'Cache-Control': 'private, no-store',
};

/** Страница 503: Go недоступен. Без скриптов — приложение не запускается. */
export const UNAVAILABLE_HTML =
    '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Cellestial</title></head>' +
    '<body><p>Сервис временно недоступен. Обновите страницу чуть позже.</p></body></html>';

/**
 * HTML клиента с данными в `<script id="bootstrap" type="application/json">`. JSON сериализуется
 * `serialize-javascript` с `isJSON`: `</script>` и `<!--` в строках экранируются и не создают
 * элементов. `HTMLRewriter` — новый на каждый ответ, шаблон не меняется.
 * @param template проверенный HTML-шаблон клиента
 * @param data пользователь или `null`
 * @param headers заголовки ответа, уже с `Set-Cookie` сессии
 * @returns ответ 200 с `Cache-Control: private, no-store`
 */
export function renderBootstrap(template: string, data: BootstrapData, headers: Headers): Response {
    const json = serialize(data, { isJSON: true });
    for (const [name, value] of Object.entries(HTML_HEADERS)) headers.set(name, value);
    return new HTMLRewriter()
        .on('script#bootstrap', {
            element(el) {
                el.setInnerContent(json, { html: true });
            },
        })
        .transform(new Response(template, { status: 200, headers }));
}

/**
 * Обработчик HTML клиента. Без сессии — гость без вызова Go. С сессией — пользователь из Go
 * `GET /users/me` (общий слой сессии: refresh, повтор после 401). Сессия закончилась — гость и
 * cookie удаляется. Сбой Go — 503 без приложения, сессия не удаляется; новая cookie после удачного
 * refresh сохраняется и в 503.
 * @param template проверенный HTML-шаблон клиента
 * @returns обработчик GET-запросов страниц
 */
export function createHtmlHandler(template: string): (req: Request) => Promise<Response> {
    return async (req) => {
        const session = await createSession(req);
        const headers = new Headers();
        let user: BootstrapData['user'] = null;
        if (session.active) {
            try {
                const me = await createGo(session).getCurrentUser();
                // только DTO пользователя: лишние поля ответа Go в HTML не попадают
                user = { id: me.id, login: me.login };
            } catch (err) {
                if (!(err instanceof SessionEnded)) {
                    session.setCookies(headers);
                    for (const [name, value] of Object.entries(HTML_HEADERS))
                        headers.set(name, value);
                    return new Response(UNAVAILABLE_HTML, { status: 503, headers });
                }
            }
        }
        session.setCookies(headers);
        return renderBootstrap(template, { user }, headers);
    };
}

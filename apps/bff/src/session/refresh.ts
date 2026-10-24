import { RefreshTokenResponse } from '@cdd/schemas';

import { refreshToken, type TokenPair } from '../go/client.ts';
import { unwrap } from '../go/errors.ts';
import type { SessionData } from './crypto.ts';

/** Сессия закончилась: Go отказал в refresh или повторно ответил 401. Cookie удаляется. */
export class SessionEnded extends Error {
    constructor() {
        super('Сессия закончилась');
        this.name = 'SessionEnded';
    }
}

const CACHE_MS = 10_000;
// одновременные refresh одного токена (HTML и RPC) — один вызов Go
const inflight = new Map<string, Promise<SessionData>>();
// refresh-токены вышедших сессий: их пара не выдаётся ни из кеша, ни в Set-Cookie запроса, который
// был в пути во время выхода. Срок — дольше самого долгого запроса (до четырёх вызовов Go по 5 с)
const revoked = new Map<string, number>();
const REVOKED_MS = 30_000;

/**
 * Вышла ли сессия с этим refresh-токеном.
 * @param refresh refresh-токен сессии
 * @returns `true`, если после выхода не прошло `REVOKED_MS`
 */
export function isRevoked(refresh: string): boolean {
    return (revoked.get(refresh) ?? 0) > Date.now();
}

/**
 * Выход: пара с этим refresh-токеном больше не выдаётся — ни из кеша refresh, ни в `Set-Cookie`
 * запроса, начатого до выхода.
 * @param refresh refresh-токен сессии, которая вышла
 */
export function revokeRefresh(refresh: string): void {
    const t = Date.now();
    // срок у всех записей один, Map хранит порядок вставки: просроченные — в начале
    for (const [token, until] of revoked) {
        if (until > t) break;
        revoked.delete(token);
    }
    revoked.delete(refresh);
    revoked.set(refresh, t + REVOKED_MS);
}

const now = (): number => Math.floor(Date.now() / 1000);

/**
 * Сессия из пары токенов Go (уже проверенной схемой ответа): сроки — от текущего момента.
 * @param tokens пара токенов из ответа Go
 * @returns токены и сроки сессии
 */
export function toSessionData(tokens: TokenPair): SessionData {
    const t = now();
    return {
        access: tokens.access_token,
        refresh: tokens.refresh_token,
        accessExp: t + tokens.access_expires_in,
        refreshExp: t + tokens.refresh_expires_in,
    };
}

async function sha256(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Buffer.from(digest).toString('hex');
}

/**
 * Обновляет токены в Go. Одновременные вызовы с одним refresh-токеном получают один результат;
 * удачный держится 10 с, неудачный сразу забывается. 401 от Go — `SessionEnded`, прочие сбои —
 * `GoError`.
 * @param refresh refresh-токен сессии
 * @param requestId `X-Request-ID` для Go
 * @returns новые токены и сроки
 */
export async function refreshTokens(refresh: string, requestId?: string): Promise<SessionData> {
    const id = await sha256(refresh);
    const data = await (inflight.get(id) ?? start(id, refresh, requestId));
    if (isRevoked(data.refresh)) throw new SessionEnded();
    return data;
}

function start(id: string, refresh: string, requestId?: string): Promise<SessionData> {
    const pending = (async () => {
        const res = await refreshToken(
            { refresh_token: refresh },
            { headers: requestId ? { 'X-Request-ID': requestId } : {} },
        );
        if (res.status === 401) throw new SessionEnded();
        return toSessionData(unwrap(res, [200], RefreshTokenResponse));
    })();
    inflight.set(id, pending);
    const forget = () => {
        if (inflight.get(id) === pending) inflight.delete(id);
    };
    pending.then(() => setTimeout(forget, CACHE_MS), forget);
    return pending;
}

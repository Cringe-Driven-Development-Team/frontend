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
// одновременные refresh одного токена (HTML и RPC, вкладки) — один вызов Go. from — исходный
// refresh-токен (для отзыва цепочки при выходе), result — пара после успеха
type Entry = { from: string; pending: Promise<SessionData>; result?: SessionData };
const inflight = new Map<string, Entry>();
// refresh-токены вышедших сессий: результат из кеша с ними больше не выдаётся (срок — с запасом
// на кеш и запрос, который был в пути во время выхода)
const revoked = new Map<string, number>();
const REVOKED_MS = 2 * CACHE_MS;

const isRevoked = (refresh: string): boolean => {
    const until = revoked.get(refresh);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    revoked.delete(refresh);
    return false;
};

/**
 * Выход: refresh-токен сессии и вся цепочка, из которой он получен через кеш, больше не выдаются.
 * Иначе запрос другой вкладки со старой cookie, пришедший после выхода, получил бы из кеша пару
 * этой сессии и снова поставил cookie.
 * @param refresh refresh-токен сессии, которая вышла
 */
export function revokeRefresh(refresh: string): void {
    revoked.set(refresh, Date.now() + REVOKED_MS);
    for (const [id, entry] of inflight) {
        if (entry.result?.refresh !== refresh) continue;
        inflight.delete(id);
        revokeRefresh(entry.from);
    }
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
    const entry = inflight.get(id) ?? start(id, refresh, requestId);
    const data = await entry.pending;
    if (isRevoked(data.refresh)) throw new SessionEnded();
    return data;
}

function start(id: string, refresh: string, requestId?: string): Entry {
    const pending = (async () => {
        const res = await refreshToken(
            { refresh_token: refresh },
            { headers: requestId ? { 'X-Request-ID': requestId } : {} },
        );
        if (res.status === 401) throw new SessionEnded();
        return toSessionData(unwrap(res, [200], RefreshTokenResponse));
    })();
    const entry: Entry = { from: refresh, pending };
    inflight.set(id, entry);
    pending.then(
        (result) => {
            entry.result = result;
            setTimeout(() => {
                if (inflight.get(id) === entry) inflight.delete(id);
            }, CACHE_MS);
        },
        () => {
            if (inflight.get(id) === entry) inflight.delete(id);
        },
    );
    return entry;
}

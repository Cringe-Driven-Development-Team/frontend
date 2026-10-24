import type { AppRouter, RouterOutputs } from '@cdd/bff';
import { TRPCClientError, createTRPCClient, httpBatchLink } from '@trpc/client';

/** Пользователь, как его отдаёт `users.me`. */
export type User = RouterOutputs['users']['me'];

/** Ошибка процедуры BFF: `data.code`, `data.appCode`, `data.zodError`. */
export type RpcError = TRPCClientError<AppRouter>;

/**
 * Клиент BFF: процедуры на `/api/trpc` своего origin, запросы одного тика — одним батчем.
 * Сессия — в HttpOnly-cookie, её прикладывает браузер; токены и refresh — забота BFF.
 */
export const trpc = createTRPCClient<AppRouter>({
    links: [
        httpBatchLink({
            url: '/api/trpc',
            // длинный батч GET делится, чтобы не упереться в лимит URL прокси
            maxURLLength: 2000,
            headers: { 'X-CSRF': '1' },
            fetch: (url, init) => fetch(url, { ...init, credentials: 'same-origin' }),
        }),
    ],
});

/**
 * Ошибка от BFF, а не сбой сети или ответ не по протоколу tRPC.
 * @param error пойманная ошибка
 * @returns ошибка процедуры с `data` от BFF
 */
export function isRpcError(error: unknown): error is RpcError {
    return error instanceof TRPCClientError && error.data !== undefined && error.data !== null;
}

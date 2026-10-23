import type { Session } from '../session/session.ts';
import {
    createCell,
    createNotebook,
    deleteCell,
    getCurrentUser,
    getNotebook,
    listNotebooks,
    loginUser,
    logoutUser,
    registerUser,
    type Cell,
    type CreateCellRequest,
    type CreateNotebookRequest,
    type Credentials,
    type Notebook,
    type NotebookSummary,
    type TokenPair,
    type User,
} from './client.ts';
import { GoError, unwrap } from './errors.ts';

/** Вызовы Go от имени сессии. */
export type Go = {
    getCurrentUser(): Promise<User>;
    listNotebooks(): Promise<NotebookSummary[]>;
    getNotebook(id: number): Promise<Notebook>;
    createNotebook(body: CreateNotebookRequest): Promise<Notebook>;
    createCell(id: number, body: CreateCellRequest): Promise<Cell>;
    deleteCell(id: number, index: number): Promise<void>;
    logout(): Promise<void>;
};

/**
 * Клиент Go поверх сессии: токены, refresh и повтор после 401 — в `session.call`. Заголовки
 * браузера в Go не уходят: `init` собирает сессия.
 * @param session сессия запроса
 * @returns вызовы Go
 */
export function createGo(session: Session): Go {
    return {
        getCurrentUser: async () => unwrap<User>(await session.call(getCurrentUser), [200]),
        listNotebooks: async () =>
            unwrap<NotebookSummary[]>(await session.call(listNotebooks), [200]),
        getNotebook: async (id) =>
            unwrap<Notebook>(await session.call((init) => getNotebook(id, init)), [200]),
        createNotebook: async (body) =>
            unwrap<Notebook>(await session.call((init) => createNotebook(body, init)), [201]),
        createCell: async (id, body) =>
            unwrap<Cell>(await session.call((init) => createCell(id, body, init)), [201]),
        deleteCell: async (id, index) => {
            unwrap<void>(await session.call((init) => deleteCell(id, index, init)), [204]);
        },
        // refresh-токен читается в момент вызова: call мог его только что обновить
        logout: async () => {
            unwrap<void>(
                await session.call((init) =>
                    logoutUser({ refresh_token: session.refreshToken ?? '' }, init),
                ),
                [204],
            );
        },
    };
}

/** Пользователь и пара токенов после входа или регистрации. */
export type AuthResult = { user: User; tokens: TokenPair };

const authResult = (data: unknown): AuthResult => {
    const v = data as Partial<AuthResult>;
    if (
        typeof v.user !== 'object' ||
        v.user === null ||
        typeof v.tokens !== 'object' ||
        v.tokens === null
    ) {
        throw new GoError('unexpected', 'Go вернул ответ входа не того вида');
    }
    return v as AuthResult;
};

const withRequestId = (requestId?: string): RequestInit => ({
    headers: requestId ? { 'X-Request-ID': requestId } : {},
});

/** Вызовы Go без сессии — вход и регистрация. */
export const publicGo = {
    /**
     * Регистрация в Go.
     * @param body логин и пароль
     * @param requestId `X-Request-ID` для Go
     * @returns пользователь и токены
     */
    register: async (body: Credentials, requestId?: string): Promise<AuthResult> =>
        authResult(unwrap<unknown>(await registerUser(body, withRequestId(requestId)), [201])),
    /**
     * Вход в Go.
     * @param body логин и пароль
     * @param requestId `X-Request-ID` для Go
     * @returns пользователь и токены
     */
    login: async (body: Credentials, requestId?: string): Promise<AuthResult> =>
        authResult(unwrap<unknown>(await loginUser(body, withRequestId(requestId)), [200])),
};

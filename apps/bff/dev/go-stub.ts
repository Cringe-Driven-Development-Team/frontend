// Заглушка Go по целевому контракту (spec/openapi.json) для приёмки BFF.
// Только для разработки: работает в памяти, в образ BFF не попадает.

const PORT = Number(process.env.STUB_PORT ?? 8080);
const ACCESS_TTL = Number(process.env.STUB_ACCESS_TTL ?? 60);
const REFRESH_TTL = Number(process.env.STUB_REFRESH_TTL ?? 3600);
const BFF_KEY = process.env.STUB_BFF_KEY;
const SLOW_MS = 7000;

type FailMode = '500' | 'slow' | 's2s' | 'refresh401' | 'me500' | 'me-garbage';
const FAIL_MODES: readonly string[] = ['500', 'slow', 's2s', 'refresh401', 'me500', 'me-garbage'];

interface User {
    id: number;
    login: string;
}
interface Cell {
    id: string;
    kind: 'code' | 'markdown';
    source: string;
}
interface Notebook {
    id: number;
    userId: number;
    name: string;
    cells: Cell[];
    created_at: string;
    updated_at: string;
}

const users = new Map<string, User & { password: string }>();
const access = new Map<string, { userId: number; exp: number }>();
const refresh = new Map<string, { userId: number; exp: number }>();
const notebooks: Notebook[] = [];
let nextUserId = 1;
let nextNotebookId = 1;
let refreshCalls = 0;
let fail: { mode: FailMode; count: number } | null = null;

const json = (body: unknown, status = 200) => Response.json(body, { status });
const err = (status: number, code: string, message: string) => json({ code, message }, status);
const token = () =>
    crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

/** Выдаёт новую пару токенов. */
function issue(userId: number) {
    const now = Date.now();
    const pair = {
        access_token: token(),
        access_expires_in: ACCESS_TTL,
        refresh_token: token(),
        refresh_expires_in: REFRESH_TTL,
    };
    access.set(pair.access_token, { userId, exp: now + ACCESS_TTL * 1000 });
    refresh.set(pair.refresh_token, { userId, exp: now + REFRESH_TTL * 1000 });
    return pair;
}

/** Достаёт пользователя по Bearer, если access жив. */
function authed(req: Request): User | null {
    const raw = req.headers.get('authorization');
    const t = raw?.startsWith('Bearer ') ? raw.slice(7) : '';
    const rec = access.get(t);
    if (!rec || rec.exp <= Date.now()) return null;
    for (const u of users.values()) if (u.id === rec.userId) return { id: u.id, login: u.login };
    return null;
}

/** Режим сбоя, который действует на этот вызов; уменьшает счётчик. */
function takeFail(path: string): FailMode | null {
    if (!fail) return null;
    const own =
        (fail.mode === 'refresh401' && path !== '/auth/refresh') ||
        ((fail.mode === 'me500' || fail.mode === 'me-garbage') && path !== '/users/me');
    if (own) return null;
    const mode = fail.mode;
    if (--fail.count <= 0) fail = null;
    return mode;
}

const unauthorized = () => err(401, 'unauthorized', 'Нет авторизации');
const invalid = () => err(400, 'validation_error', 'Невалидный запрос');

async function body(req: Request): Promise<Record<string, unknown> | null> {
    try {
        const v = await req.json();
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

async function api(req: Request, path: string): Promise<Response> {
    if (BFF_KEY && req.headers.get('x-bff-key') !== BFF_KEY) {
        return err(403, 's2s_forbidden', 'S2S-ключ не принят');
    }
    const mode = takeFail(path);
    if (mode === 's2s') return err(403, 's2s_forbidden', 'S2S-ключ не принят');
    if (mode === '500') return err(500, 'internal', 'Внутренняя ошибка');
    if (mode === 'slow') await Bun.sleep(SLOW_MS);
    const m = req.method;

    if (m === 'POST' && (path === '/auth/register' || path === '/auth/login')) {
        const b = await body(req);
        const login = b?.login;
        const password = b?.password;
        if (typeof login !== 'string' || typeof password !== 'string') return invalid();
        if (path === '/auth/register') {
            if (login.length < 3 || login.length > 32 || !/^[a-zA-Z0-9_]+$/.test(login))
                return invalid();
            if (password.length < 8 || password.length > 72) return invalid();
            if (users.has(login)) return err(409, 'login_taken', 'Логин занят');
            const user = { id: nextUserId++, login, password };
            users.set(login, user);
            return json({ user: { id: user.id, login }, tokens: issue(user.id) }, 201);
        }
        const user = users.get(login);
        if (!user || user.password !== password) {
            return err(401, 'invalid_credentials', 'Неверный логин или пароль');
        }
        return json({ user: { id: user.id, login }, tokens: issue(user.id) });
    }

    if (m === 'POST' && path === '/auth/refresh') {
        refreshCalls++;
        const b = await body(req);
        if (typeof b?.refresh_token !== 'string') return invalid();
        if (mode === 'refresh401') return unauthorized();
        const rec = refresh.get(b.refresh_token);
        if (!rec || rec.exp <= Date.now()) return unauthorized();
        refresh.delete(b.refresh_token);
        return json(issue(rec.userId));
    }

    if (m === 'POST' && path === '/auth/logout') {
        const b = await body(req);
        if (typeof b?.refresh_token !== 'string') return invalid();
        if (!authed(req)) return unauthorized();
        refresh.delete(b.refresh_token);
        return new Response(null, { status: 204 });
    }

    const user = authed(req);
    if (!user) return unauthorized();

    if (m === 'GET' && path === '/users/me') {
        if (mode === 'me500') return err(500, 'internal', 'Внутренняя ошибка');
        if (mode === 'me-garbage') return new Response('oops', { status: 200 });
        return json(user);
    }

    const own = notebooks.filter((n) => n.userId === user.id);
    const publicNb = ({ userId: _userId, ...rest }: Notebook) => rest;

    if (path === '/notebooks') {
        if (m === 'GET') {
            return json(
                own.map((n) => ({
                    id: n.id,
                    name: n.name,
                    updated_at: n.updated_at,
                    cells_count: n.cells.length,
                })),
            );
        }
        if (m === 'POST') {
            const b = await body(req);
            const name = b?.name;
            if (typeof name !== 'string' || name.length < 1 || name.length > 128) return invalid();
            const now = new Date().toISOString();
            const nb: Notebook = {
                id: nextNotebookId++,
                userId: user.id,
                name,
                cells: [],
                created_at: now,
                updated_at: now,
            };
            notebooks.push(nb);
            return json(publicNb(nb), 201);
        }
    }

    const nbMatch = path.match(/^\/notebooks\/(\d+)(?:\/cells(?:\/(\d+))?)?$/);
    if (nbMatch) {
        const nb = own.find((n) => n.id === Number(nbMatch[1]));
        if (!nb) return err(404, 'not_found', 'Блокнот не найден');
        const isCells = path.includes('/cells');
        if (m === 'GET' && !isCells) return json(publicNb(nb));
        if (m === 'POST' && isCells && nbMatch[2] === undefined) {
            const b = await body(req);
            const kind = b?.kind;
            const index = b?.index ?? nb.cells.length;
            if (kind !== 'code' && kind !== 'markdown') return invalid();
            if (typeof index !== 'number' || !Number.isInteger(index) || index < 0)
                return invalid();
            if (index > nb.cells.length)
                return err(409, 'validation_error', 'Позиция вне блокнота');
            const cell: Cell = { id: crypto.randomUUID().slice(0, 8), kind, source: '' };
            nb.cells.splice(index, 0, cell);
            nb.updated_at = new Date().toISOString();
            return json(cell, 201);
        }
        if (m === 'DELETE' && isCells && nbMatch[2] !== undefined) {
            const i = Number(nbMatch[2]);
            if (i >= nb.cells.length) return err(404, 'not_found', 'Блок не найден');
            nb.cells.splice(i, 1);
            nb.updated_at = new Date().toISOString();
            return new Response(null, { status: 204 });
        }
    }
    return err(404, 'not_found', 'Не найдено');
}

async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === '/health') return json({ status: 'ok' });
    if (path === '/__stub/stats') return json({ refreshCalls });
    if (path === '/__stub/reset') {
        for (const s of [users, access, refresh]) s.clear();
        notebooks.length = 0;
        nextUserId = nextNotebookId = 1;
        refreshCalls = 0;
        fail = null;
        return json({ ok: true });
    }
    if (path === '/__stub/fail' && req.method === 'POST') {
        const b = await body(req);
        if (typeof b?.mode !== 'string' || !FAIL_MODES.includes(b.mode)) return invalid();
        const count = typeof b.count === 'number' && b.count > 0 ? b.count : 1;
        fail = { mode: b.mode as FailMode, count };
        return json({ ok: true });
    }
    if (path.startsWith('/api/v1/')) return api(req, path.slice('/api/v1'.length));
    return err(404, 'not_found', 'Не найдено');
}

Bun.serve({
    port: PORT,
    idleTimeout: 30,
    async fetch(req) {
        const res = await handle(req);
        const h = req.headers;
        const flag = (n: string) => `${n}=${h.has(n)}`;
        console.log(
            req.method,
            new URL(req.url).pathname,
            res.status,
            ['authorization', 'x-bff-key', 'cookie', 'x-csrf-token', 'x-request-id']
                .map(flag)
                .join(' '),
        );
        return res;
    },
});
console.log(`go-stub: http://127.0.0.1:${PORT}`);

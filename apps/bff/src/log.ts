import type { MiddlewareHandler } from 'hono';

const TRPC_PREFIX = '/api/trpc/';

/**
 * Access-лог: одна строка JSON в stdout на запрос — `time`, `method`, `path`, `procedure`
 * (для tRPC), `status`, `ms`. `path` без query: в `?input=` лежит вход процедуры. `/health` не
 * логируется, его опрашивает healthcheck.
 * @param c контекст Hono
 * @param next следующий обработчик
 */
export const accessLog: MiddlewareHandler = async (c, next) => {
    if (c.req.path === '/health') return next();
    const start = performance.now();
    await next();
    const path = c.req.path;
    console.log(
        JSON.stringify({
            time: new Date().toISOString(),
            // HEAD приходит в Hono как GET (index.ts), исходный метод — в env
            method: (c.env as { method?: string } | undefined)?.method ?? c.req.method,
            path,
            procedure: path.startsWith(TRPC_PREFIX) ? path.slice(TRPC_PREFIX.length) : undefined,
            status: c.res.status,
            ms: Math.round(performance.now() - start),
        }),
    );
};

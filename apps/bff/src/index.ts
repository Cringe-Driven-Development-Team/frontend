// Точка входа BFF: запросы принимаются только после проверки конфигурации, шаблона и public.
import { dirname, join } from 'node:path';

import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { createApp } from './app.ts';
import { createContext } from './context.ts';
import { createHtmlHandler } from './html.ts';
import { env } from './env.ts';
import { logTrpcError } from './log.ts';
import { loadPublicFiles } from './public.ts';
import { appRouter } from './router/index.ts';
import { loadTemplate } from './template.ts';

const STOP_TIMEOUT_MS = 10_000;

async function start(): Promise<void> {
    let template: string;
    let publicFiles: Map<string, Bun.BunFile>;
    try {
        template = await loadTemplate(env.HTML_TEMPLATE);
        publicFiles = await loadPublicFiles(join(dirname(env.HTML_TEMPLATE), 'public'));
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    const app = createApp({
        template,
        publicFiles,
        html: createHtmlHandler(template),
        trpc: (req) =>
            fetchRequestHandler({
                endpoint: '/api/trpc',
                req,
                router: appRouter,
                createContext,
                onError: logTrpcError,
            }),
    });
    // HEAD — тот же ответ GET: Bun сам отбросит тело и сохранит Content-Length. Hono превращал бы HEAD
    // в ответ без тела с Content-Length: 0. Исходный метод — в env Hono, для access-лога.
    const server = Bun.serve({
        port: env.PORT,
        fetch: (req) =>
            req.method === 'HEAD'
                ? app.fetch(new Request(req, { method: 'GET' }), { method: 'HEAD' })
                : app.fetch(req),
    });
    console.log(
        JSON.stringify({ time: new Date().toISOString(), msg: 'listening', port: server.port }),
    );

    let stopping = false;
    const stop = async (): Promise<void> => {
        if (stopping) return;
        stopping = true;
        // новые запросы не принимаются, текущие завершаются; по сроку — принудительно
        const force = setTimeout(() => void server.stop(true), STOP_TIMEOUT_MS);
        await server.stop();
        clearTimeout(force);
        process.exit(0);
    };
    process.on('SIGTERM', () => void stop());
    process.on('SIGINT', () => void stop());
}

await start();

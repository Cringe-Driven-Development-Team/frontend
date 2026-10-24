import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Адрес без слеша в конце; без протокола считается https.
 * @param url адрес из переменной окружения
 * @returns нормализованный адрес
 */
const toUrl = (url: string) =>
    (/^https?:\/\//.test(url) ? url : `https://${url}`).replace(/\/+$/, '');

// .env лежит в корне монорепы: его же читают скрипты apidog и release
const envDir = '../..';

// сертификат локального HTTPS (docs/local-development.md, «Клиент через BFF»): cookie сессии BFF — Secure
const CERT = resolve(envDir, '.cert/localhost.pem');
const CERT_KEY = resolve(envDir, '.cert/localhost-key.pem');

// заголовки браузера, нужные BFF для HTML: сессия, тип ответа и признаки CSRF
const HTML_REQUEST_HEADERS = ['accept', 'cookie', 'sec-fetch-site', 'user-agent', 'x-request-id'];

/**
 * HTML страниц в dev — от BFF: пользователь в bootstrap и `Set-Cookie` сессии, как на проде. Vite
 * затем добавляет в него свой клиент HMR и прочие преобразования `index.html`.
 * @param bffUrl адрес локального BFF
 * @returns плагин dev-сервера
 */
function bffHtml(bffUrl: string): Plugin {
    return {
        name: 'bff-html',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const page = req.method === 'GET' || req.method === 'HEAD';
                if (!page || !req.headers.accept?.includes('text/html')) return next();
                const url = req.originalUrl ?? '/';
                void (async () => {
                    const headers = new Headers();
                    for (const name of HTML_REQUEST_HEADERS) {
                        const value = req.headers[name];
                        if (typeof value === 'string') headers.set(name, value);
                    }
                    const answer = await fetch(bffUrl + url, { headers });
                    const html = await server.transformIndexHtml(url, await answer.text());
                    res.statusCode = answer.status;
                    for (const [name, value] of answer.headers) {
                        if (!['content-length', 'content-encoding', 'set-cookie'].includes(name)) {
                            res.setHeader(name, value);
                        }
                    }
                    const cookies = answer.headers.getSetCookie();
                    if (cookies.length > 0) res.setHeader('Set-Cookie', cookies);
                    res.end(req.method === 'HEAD' ? undefined : html);
                })().catch(next);
            });
        },
    };
}

export default defineConfig(({ mode }) => {
    // RELEASE_SHA и CDN_URL задаёт CI при сборке релиза; без них (локально и в PR) base остаётся '/'
    // STATIC_URL — адрес static (картинки и шрифты), BFF_URL — адрес локального BFF
    const { RELEASE_SHA: sha, CDN_URL: cdn, STATIC_URL, BFF_URL } = loadEnv(mode, envDir, '');
    const bffUrl = BFF_URL || 'http://127.0.0.1:3000';
    const https = existsSync(CERT) && existsSync(CERT_KEY);
    const cdnUrl = cdn && toUrl(cdn);
    const staticUrl = toUrl(STATIC_URL || 'https://static.cellestial.ru');

    return {
        envDir,
        // чанки релиза лежат в S3 под своим sha и грузятся с CDN: открытая вкладка живёт на своём релизе
        base: sha && cdnUrl ? `${cdnUrl}/releases/${sha}/` : '/',
        // алиасы папок src берутся из paths в tsconfig.json
        resolve: { tsconfigPaths: true },
        // один origin с API: https://localhost:5173 — его же BFF ждёт в APP_ORIGIN
        server: {
            host: 'localhost',
            port: 5173,
            strictPort: true,
            https: https ? { cert: readFileSync(CERT), key: readFileSync(CERT_KEY) } : undefined,
            proxy: { '/api/trpc': bffUrl },
        },
        build: { outDir: 'dist', sourcemap: true },
        plugins: [
            bffHtml(bffUrl),
            {
                // var() не работает внутри url() и в @font-face: адрес static подставляется
                // вместо %STATIC_URL% в CSS и index.html
                name: 'static-url',
                enforce: 'pre',
                transform: (code: string, id: string) =>
                    /\.css($|\?)/.test(id)
                        ? { code: code.replaceAll('%STATIC_URL%', staticUrl), map: null }
                        : undefined,
                transformIndexHtml: {
                    order: 'pre',
                    handler: (html) => html.replaceAll('%STATIC_URL%', staticUrl),
                },
            },
            {
                name: 'release-meta',
                transformIndexHtml: () => [
                    {
                        tag: 'meta',
                        attrs: { name: 'release', content: sha || 'dev' },
                        injectTo: 'head',
                    },
                ],
            },
        ],
    };
});

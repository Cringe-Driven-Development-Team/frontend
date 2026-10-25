import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { bffHtml } from '@cdd-team/vite-plugin-bff-html';
import { defineConfig, loadEnv } from 'vite';
import mkcert from 'vite-plugin-mkcert';

/**
 * Адрес без слеша в конце; без протокола считается https.
 * @param url адрес из переменной окружения
 * @returns нормализованный адрес
 */
const toUrl = (url: string) =>
    (/^https?:\/\//.test(url) ? url : `https://${url}`).replace(/\/+$/, '');

/**
 * Каталог из PATH в виде для сравнения: на Windows регистр в путях не важен.
 * @param dir каталог
 * @returns нормализованный путь
 */
const pathKey = (dir: string) => {
    const path = resolve(dir);
    return process.platform === 'win32' ? path.toLowerCase() : path;
};

/**
 * Убирает из PATH dev-сервера каталоги с чужим `mkcert`. Пока своего бинарника в
 * `~/.vite-plugin-mkcert` нет, vite-plugin-mkcert берёт первый `mkcert` из PATH и не скачивает
 * официальный. В WSL и Windows первым бывает npm-пакет `mkcert` с другим CLI: `-CAROOT` он не знает
 * (WSL) или не запускается без shell (Windows), и dev не стартует. Подходящим считается `mkcert`,
 * который отвечает на `-CAROOT`, как его вызывает плагин.
 */
function hideForeignMkcert() {
    const binary = process.platform === 'win32' ? 'mkcert.exe' : 'mkcert';
    if (existsSync(join(homedir(), '.vite-plugin-mkcert', binary))) return;
    const lookup = process.platform === 'win32' ? 'where mkcert' : 'command -v mkcert';
    for (;;) {
        let found: string | undefined;
        try {
            const output = execSync(lookup, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            found = output.split(/\r?\n/)[0]?.trim();
        } catch {
            return;
        }
        if (!found) return;
        try {
            execFileSync(found, ['-CAROOT'], { stdio: 'ignore', timeout: 10_000 });
            return;
        } catch {
            // не FiloSottile/mkcert: каталог убирается, поиск продолжается
        }
        const path = (process.env.PATH ?? '').split(delimiter);
        const rest = path.filter((dir) => pathKey(dir) !== pathKey(dirname(found)));
        if (rest.length === path.length) return;
        process.env.PATH = rest.join(delimiter);
        console.warn(`${found} — не mkcert для HTTPS: его каталог убран из PATH dev-сервера`);
    }
}

// .env лежит в корне монорепы: его же читают скрипты apidog и release
const envDir = '../..';

export default defineConfig(({ command, mode }) => {
    if (command === 'serve') hideForeignMkcert();
    // RELEASE_SHA и CDN_URL задаёт CI при сборке релиза; без них (локально и в PR) base остаётся '/'
    // STATIC_URL — адрес static (картинки и шрифты), BFF_URL — адрес локального BFF
    const { RELEASE_SHA: sha, CDN_URL: cdn, STATIC_URL, BFF_URL } = loadEnv(mode, envDir, '');
    const bffUrl = BFF_URL || 'http://127.0.0.1:3000';
    const cdnUrl = cdn && toUrl(cdn);
    const staticUrl = toUrl(STATIC_URL || 'https://static.cellestial.ru');

    return {
        envDir,
        // чанки релиза лежат в S3 под своим sha и грузятся с CDN: открытая вкладка живёт на своём релизе
        base: sha && cdnUrl ? `${cdnUrl}/releases/${sha}/` : '/',
        // алиасы папок src берутся из paths в tsconfig.json
        resolve: { tsconfigPaths: true },
        // один origin с API: https://localhost:5173 — его же BFF ждёт в APP_ORIGIN. Vite слушает
        // 127.0.0.1: с host localhost на Windows он недоступен; открывать всё равно https://localhost:5173
        server: {
            host: '127.0.0.1',
            port: 5173,
            strictPort: true,
            proxy: { '/api/trpc': bffUrl },
        },
        build: { outDir: 'dist', sourcemap: true },
        plugins: [
            // локальный HTTPS: cookie сессии BFF — Secure; сертификат выпускает и доверяет mkcert
            mkcert({ hosts: ['localhost', '127.0.0.1'] }),
            // HTML страниц — от BFF (пользователь в bootstrap и Set-Cookie сессии, как на проде),
            // Vite добавляет в него клиент HMR; /api/trpc из server.proxy плагин не трогает
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

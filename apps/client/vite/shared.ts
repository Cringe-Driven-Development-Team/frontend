import { loadEnv, type UserConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { releaseMetaPlugin, staticUrlPlugin } from './plugins.ts';

// .env лежит в корне монорепы: его же читают скрипты apidog и release
const envDir = '../..';

/**
 * Адрес без слеша в конце; без протокола считается https.
 * @param url адрес из переменной окружения
 * @returns нормализованный адрес
 */
export const toUrl = (url: string) =>
    (/^https?:\/\//.test(url) ? url : `https://${url}`).replace(/\/+$/, '');

/**
 * Переменные сборки из корневого `.env` и окружения.
 * @param mode режим Vite
 * @returns переменные окружения
 */
export const loadClientEnv = (mode: string) => loadEnv(mode, envDir, '');

/**
 * Общая часть dev- и prod-конфига: алиасы, адрес static в HTML и CSS, метатег `release`.
 * @param env переменные из {@link loadClientEnv}
 * @param release sha релиза или `dev`
 * @returns часть конфига Vite
 */
export const sharedConfig = (env: Record<string, string>, release: string): UserConfig => {
    // VITE_STATIC_URL — публичный адрес static (картинки и шрифты)
    const staticUrl = toUrl(env.VITE_STATIC_URL || 'https://static.cellestial.ru');
    return {
        envDir,
        // алиасы папок src берутся из paths в tsconfig.json
        resolve: { tsconfigPaths: true },
        // %VITE_STATIC_URL% в index.html подставляет сам Vite и берёт значение и из define: так
        // в HTML попадает адрес по умолчанию и тот же нормализованный адрес, что и в CSS
        define: { 'import.meta.env.VITE_STATIC_URL': JSON.stringify(staticUrl) },
        plugins: [
            staticUrlPlugin(staticUrl),
            releaseMetaPlugin(release),
            // и в dev: там нет SW, но клиенту нужен модуль virtual:pwa-register
            VitePWA({
                // манифест и иконки отдаёт BFF со своего origin (PUBLIC_FILES): с CDN манифест не примут
                base: '/',
                // регистрирует src/serviceWorker.ts
                injectRegister: false,
                includeManifestIcons: false,
                workbox: {
                    // sw.js — один файл: его, как и манифест, отдаёт BFF
                    inlineWorkboxRuntime: true,
                    sourcemap: false,
                    // кеш — только самостоятельная офлайн-страница; JS и CSS SPA всегда с CDN, а HTML
                    // и RPC с данными пользователя не кешируются (docs: трек «Офлайн-режим»)
                    globPatterns: ['offline.html'],
                    navigateFallback: null,
                    runtimeCaching: [
                        {
                            urlPattern: ({ request }) => request.mode === 'navigate',
                            handler: 'NetworkOnly',
                            options: { precacheFallback: { fallbackURL: '/offline.html' } },
                        },
                    ],
                    // в кеше нет файлов SPA, поэтому новая версия не расходится с открытой вкладкой
                    // и вступает сразу, без перезагрузки
                    skipWaiting: true,
                    clientsClaim: true,
                    cleanupOutdatedCaches: true,
                },
                manifest: {
                    name: 'Cellestial',
                    short_name: 'Cellestial',
                    lang: 'ru',
                    start_url: '/',
                    scope: '/',
                    display: 'standalone',
                    background_color: '#05030f',
                    theme_color: '#05030f',
                    icons: [
                        { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
                        { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
                        {
                            src: '/pwa-maskable-512.png',
                            sizes: '512x512',
                            type: 'image/png',
                            purpose: 'maskable',
                        },
                    ],
                },
            }),
        ],
    };
};

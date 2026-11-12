import type { Plugin } from 'vite';
import { pwa } from '@cdd-team/vite-plugin-pwa';

/**
 * Подставляет адрес static вместо `%VITE_STATIC_URL%` в CSS. `var()` не работает внутри `url()` и в
 * `@font-face`, а HTML-подстановку Vite к CSS не применяет.
 * @param staticUrl нормализованный адрес static
 */
export const staticUrlPlugin = (staticUrl: string): Plugin => ({
    name: 'static-url',
    enforce: 'pre',
    transform: (code, id) =>
        /\.css($|\?)/.test(id)
            ? { code: code.replaceAll('%VITE_STATIC_URL%', staticUrl), map: null }
            : undefined,
});

/**
 * Добавляет в `<head>` метатег `<meta name="release">` с версией сборки.
 * @param release SHA релиза или `dev`
 */
export const releaseMetaPlugin = (release: string): Plugin => ({
    name: 'release-meta',
    transformIndexHtml: () => [
        { tag: 'meta', attrs: { name: 'release', content: release }, injectTo: 'head' },
    ],
});

/**
 * Манифест и `sw.js`. Регистрирует service worker `src/serviceWorker.ts`; в dev плагин отдаёт только
 * манифест.
 */
export const vitepwaPlugin = (): Plugin =>
    pwa({
        /** Манифест, `sw.js` и офлайн-файлы отдаёт BFF со своего origin (`PUBLIC_FILES`), не CDN */
        publicPath: '/',
        /**
         * Кеш — только офлайн-страница, её стили (CSP запрещает встроенные), шрифт и манифест; JS и
         * CSS SPA всегда с CDN, HTML и RPC с данными пользователя не кешируются (docs: трек
         * «Офлайн-режим»)
         */
        precache: ['offline.html', 'offline.css', 'onest-variable.woff2', 'manifest.webmanifest'],
        fallback: '/offline.html',
        cacheNamespace: 'cellestial',
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
    });

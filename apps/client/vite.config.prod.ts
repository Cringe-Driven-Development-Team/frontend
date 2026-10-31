import { defineConfig, mergeConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { loadClientEnv, sharedConfig, toUrl } from './vite/shared.ts';

export default defineConfig(({ mode }) => {
    // RELEASE_SHA и CDN_URL задаёт CI при сборке релиза; без них (локально и в PR) base остаётся '/'
    const env = loadClientEnv(mode);
    const sha = env.RELEASE_SHA;
    const cdnUrl = env.CDN_URL && toUrl(env.CDN_URL);

    return mergeConfig(sharedConfig(env, sha || 'dev'), {
        // чанки релиза лежат в S3 под своим sha и грузятся с CDN: открытая вкладка живёт на своём релизе
        base: sha && cdnUrl ? `${cdnUrl}/releases/${sha}/` : '/',
        build: { outDir: 'dist', sourcemap: true },
        plugins: [
            VitePWA({
                // манифест и иконки отдаёт BFF со своего origin (PUBLIC_FILES): с CDN манифест не примут
                base: '/',
                // service worker регистрирует frontend#49
                injectRegister: false,
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
    });
});

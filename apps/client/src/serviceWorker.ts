import { register } from '@cdd-team/workbox/window';

/**
 * Регистрирует service worker: `/sw.js` на origin приложения, scope `/`, только в production-сборке.
 * Отказ регистрации не мешает работе приложения: без него нет только офлайн-страницы. Новая версия
 * SW вступает в силу без перезагрузки вкладки: файлов SPA в его кеше нет.
 */
export function registerServiceWorker(): void {
    if (!import.meta.env.PROD) return;
    register('/sw.js', '/').catch(console.error);
}

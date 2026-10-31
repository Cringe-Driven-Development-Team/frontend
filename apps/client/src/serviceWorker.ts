/**
 * Регистрирует service worker в сборке. Адрес — на origin приложения, не на CDN: scope `/`.
 * Отказ регистрации не мешает работе приложения: без него нет только офлайн-страницы.
 */
export function registerServiceWorker(): void {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(console.error);
}

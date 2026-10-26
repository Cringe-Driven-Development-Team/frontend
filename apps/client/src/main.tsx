import { createRoot } from '@cdd-team/react';

import { onSessionLost } from './api/trpc';
import { readBootstrap } from './bootstrap';
import { RouterProvider } from './modules/router';
import { router } from './router';
import { setPreloadedNotebook } from './stores/preloaded';
import { initSession, loseSession } from './stores/session';
import { showToast } from './stores/toast';
import './styles/tokens.css';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден элемент #root');

// Пользователь — из первого HTML: первый рендер уже знает, гость это или вошедший.
// Сломанный bootstrap — ошибка запуска, гостем и запасным users.me она не прикрывается.
let started = false;
try {
    const { user, notebook } = readBootstrap();
    initSession(user);
    setPreloadedNotebook(notebook);
    started = true;
} catch (error) {
    console.error(error);
    container.textContent = 'Не удалось запустить приложение. Обновите страницу.';
}

// BFF не смог продлить сессию: гость и вход, прежние данные с экрана уходят вместе с маршрутом
onSessionLost(() => {
    loseSession();
    showToast('Сессия закончилась — войдите снова', 'info');
    void router.navigate({ to: '/login', replace: true });
});

if (started) createRoot(container).render(<RouterProvider router={router} />);

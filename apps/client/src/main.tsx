import { createRoot } from '@cdd-team/react';

import { readBootstrap } from './bootstrap';
import { RouterProvider } from './modules/router';
import { router } from './router';
import { initSession } from './stores/session';
import './styles/tokens.css';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден элемент #root');

// Пользователь — из первого HTML: первый рендер уже знает, гость это или вошедший.
// Сломанный bootstrap — ошибка запуска, гостем и запасным users.me она не прикрывается.
let started = false;
try {
    initSession(readBootstrap().user);
    started = true;
} catch (error) {
    console.error(error);
    container.textContent = 'Не удалось запустить приложение. Обновите страницу.';
}

if (started) createRoot(container).render(<RouterProvider router={router} />);

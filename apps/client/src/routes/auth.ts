import { createRoute, redirect } from '@cdd-team/router';
import { useSessionStore } from '@stores/session';
import { rootRoute } from './root';

/** Обёртка страниц для вошедшего пользователя: гостя перенаправляет на вход. */
export const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_auth',
    beforeLoad: () => {
        if (useSessionStore.getState().status !== 'authed') throw redirect({ to: '/login' });
    },
});

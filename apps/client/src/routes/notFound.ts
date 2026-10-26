import { PAGES } from '@cdd/bff/pages';
import { createRoute } from '@modules/router';
import { NotFoundPage } from '@pages/NotFoundPage';
import { rootRoute } from './root';

/** Страница «Не найдено»: `/404`, открыта и гостю, и вошедшему. BFF отдаёт её со статусом 404. */
export const notFoundRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: PAGES.notFound,
    component: NotFoundPage,
});

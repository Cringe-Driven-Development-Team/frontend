import { PAGES } from '@cdd/bff/pages';
import { createRoute } from '@cdd-team/router';
import { NotebooksPage } from '@pages/NotebooksPage/NotebooksPage';
import { authRoute } from './auth';

/** Главная: список блокнотов. */
export const indexRoute = createRoute({
    getParentRoute: () => authRoute,
    path: PAGES.index,
    component: NotebooksPage,
});

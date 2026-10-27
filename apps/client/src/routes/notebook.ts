import { PAGES } from '@cdd/bff/pages';
import { createRoute } from '@cdd-team/router';
import { NotebookPage } from '@pages/NotebookPage/NotebookPage';
import { authRoute } from './auth';

/** Страница блокнота: `/notebooks/$notebookId`. */
export const notebookRoute = createRoute({
    getParentRoute: () => authRoute,
    path: PAGES.notebook,
    component: NotebookPage,
});

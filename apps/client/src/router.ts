import { createRouter } from '@cdd-team/router';
import { routeTree } from './routes/routeTree';

/** Роутер приложения. */
export const router = createRouter({ routeTree });

declare module '@cdd-team/router' {
    interface Register {
        router: typeof router;
    }
}

// Типы BFF для клиента: только `import type`, кода в бандл клиента не попадает
import type { inferRouterOutputs } from '@trpc/server';

import type { AppRouter } from './router/index.ts';

export type { AppRouter };

/** Пользователь, как его отдаёт `users.me`. */
export type CurrentUser = inferRouterOutputs<AppRouter>['users']['me'];

/** Данные, которые BFF кладёт в `<script id="bootstrap">` первого HTML. */
export type BootstrapData = { user: CurrentUser | null };

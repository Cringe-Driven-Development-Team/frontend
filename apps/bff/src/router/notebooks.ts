import { CreateNotebookBody } from '@cdd/schemas';
import { z } from 'zod';

import { authedProcedure, router } from '../trpc.ts';

/** Блокноты пользователя. */
export const notebooks = router({
    list: authedProcedure.query(({ ctx }) => ctx.go.listNotebooks()),
    get: authedProcedure
        .input(z.object({ id: z.number().int().positive() }))
        .query(({ ctx, input }) => ctx.go.getNotebook(input.id)),
    create: authedProcedure
        .input(CreateNotebookBody)
        .mutation(({ ctx, input }) => ctx.go.createNotebook(input)),
});

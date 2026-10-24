import { CreateCellBody } from '@cdd/schemas';
import { z } from 'zod';

import { authedProcedure, router } from '../trpc.ts';

/** Блоки блокнота. */
export const cells = router({
    // strictObject: в контракте у тела additionalProperties: false
    create: authedProcedure
        .input(z.strictObject({ notebookId: z.number().int().positive(), ...CreateCellBody.shape }))
        .mutation(({ ctx, input: { notebookId, ...body } }) => ctx.go.createCell(notebookId, body)),
    delete: authedProcedure
        .input(
            z.object({ notebookId: z.number().int().positive(), index: z.number().int().min(0) }),
        )
        .mutation(async ({ ctx, input }) => {
            await ctx.go.deleteCell(input.notebookId, input.index);
            return { ok: true as const };
        }),
});

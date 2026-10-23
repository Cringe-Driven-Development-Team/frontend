import { authedProcedure, router } from '../trpc.ts';

/** Текущий пользователь. */
export const users = router({
    me: authedProcedure.query(({ ctx }) => ctx.go.getCurrentUser()),
});

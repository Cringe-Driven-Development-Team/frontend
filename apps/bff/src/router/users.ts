import { RegisterUserBody } from '@cdd/schemas';
import { z } from 'zod';

import { authedProcedure, router } from '../trpc.ts';

/** Текущий пользователь: данные профиля, смена логина и пароля. */
export const users = router({
    me: authedProcedure.query(({ ctx }) => ctx.go.getCurrentUser()),
    updateLogin: authedProcedure
        .input(RegisterUserBody.pick({ login: true }))
        .mutation(({ ctx, input }) => ctx.go.updateLogin(input.login)),
    changePassword: authedProcedure
        .input(
            z.object({
                current_password: z.string().min(1),
                new_password: RegisterUserBody.shape.password,
            }),
        )
        .mutation(async ({ ctx, input }) => {
            await ctx.go.changePassword(input);
            return { ok: true as const };
        }),
});

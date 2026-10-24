import { LoginUserBody, RegisterUserBody } from '@cdd/schemas';

import { publicGo } from '../go/api.ts';
import { revokeRefresh } from '../session/refresh.ts';
import { optionalSessionProcedure, publicProcedure, router } from '../trpc.ts';

/** Вход, регистрация и выход. Токены Go остаются в cookie сессии, клиенту — только пользователь. */
export const auth = router({
    register: publicProcedure.input(RegisterUserBody).mutation(async ({ ctx, input }) => {
        const { user, tokens } = await publicGo.register(input, ctx.session.requestId);
        await ctx.session.start(tokens);
        ctx.session.clearLegacy();
        return user;
    }),
    login: publicProcedure.input(LoginUserBody).mutation(async ({ ctx, input }) => {
        const { user, tokens } = await publicGo.login(input, ctx.session.requestId);
        await ctx.session.start(tokens);
        ctx.session.clearLegacy();
        return user;
    }),
    // выход всегда успешен: отзыв refresh в Go — по возможности, cookie удаляется в любом случае
    logout: optionalSessionProcedure.mutation(async ({ ctx }) => {
        if (ctx.session.active) await ctx.go.logout().catch(() => undefined);
        // refresh-токен читается после logout: перед ним call мог обновить пару
        const refresh = ctx.session.refreshToken;
        if (refresh) revokeRefresh(refresh);
        ctx.session.end();
        ctx.session.clearLegacy();
        return { ok: true as const };
    }),
});

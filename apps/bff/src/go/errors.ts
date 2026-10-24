import type { z } from 'zod';

/** Вид сбоя обращения к Go. */
export type GoErrorKind = 'http' | 'network' | 'timeout' | 'unexpected';

/**
 * Сбой обращения к Go: HTTP-статус вне ожидаемых (`http`), сеть (`network`), таймаут (`timeout`)
 * или ответ не того вида (`unexpected`). Сессию не трогает — это решает вызывающий код.
 */
export class GoError extends Error {
    readonly kind: GoErrorKind;
    readonly status?: number;
    readonly code?: string;

    /**
     * @param kind вид сбоя
     * @param message описание без секретов и тел запросов
     * @param details статус ответа Go и `code` из его тела `Error`
     */
    constructor(
        kind: GoErrorKind,
        message: string,
        details: { status?: number; code?: string } = {},
    ) {
        super(message);
        this.name = 'GoError';
        this.kind = kind;
        this.status = details.status;
        this.code = details.code;
    }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

/**
 * Достаёт тело успешного ответа Orval-клиента и проверяет его zod-схемой ответа операции из
 * `@cdd/schemas`. Статус вне `ok` — `GoError('http')` с `code` из тела `Error`; статус из `ok`, но
 * тело не по схеме — `GoError('unexpected')`. Без схемы (ответ 204) возвращает `undefined`. Лишние
 * поля ответа схема отбрасывает.
 * @param res ответ Orval-клиента
 * @param ok успешные статусы операции по контракту
 * @param schema схема тела успешного ответа
 * @returns тело ответа, проверенное схемой
 */
export function unwrap<T = undefined>(
    res: { status: number; data: unknown },
    ok: number[],
    schema?: z.ZodType<T>,
): T {
    if (!ok.includes(res.status)) {
        const code =
            isObject(res.data) && typeof res.data.code === 'string' ? res.data.code : undefined;
        throw new GoError('http', `Go ответил ${res.status}`, { status: res.status, code });
    }
    if (!schema) return undefined as T;
    const parsed = schema.safeParse(res.data);
    if (!parsed.success) {
        throw new GoError('unexpected', `Go ответил ${res.status} с телом не по контракту`, {
            status: res.status,
        });
    }
    return parsed.data;
}

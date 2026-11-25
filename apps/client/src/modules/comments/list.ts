import type { Output } from '@api/bff';

/** Комментарий к ячейке, как его отдаёт BFF. */
export type Comment = Output<'/api/comments/create'>;

/**
 * Лента из страницы Go: Go отдаёт новые первыми, в треде старые сверху.
 * @param items сообщения страницы
 * @returns сообщения от старых к новым
 */
export function fromPage(items: readonly Comment[]): Comment[] {
    return items.toReversed();
}

/**
 * Более ранняя страница над лентой; уже показанные сообщения не дублируются.
 * @param list текущая лента
 * @param items следующая страница Go
 * @returns лента с ранними сообщениями сверху
 */
export function prependOlder(list: readonly Comment[], items: readonly Comment[]): Comment[] {
    const shown = new Set(list.map((item) => item.id));
    return [...fromPage(items.filter((item) => !shown.has(item.id))), ...list];
}

/**
 * Своё новое сообщение — в конец ленты.
 * @param list текущая лента
 * @param comment созданное сообщение
 * @returns лента с сообщением
 */
export function append(list: readonly Comment[], comment: Comment): Comment[] {
    return [...list, comment];
}

/**
 * Сообщение после правки вместо прежнего.
 * @param list текущая лента
 * @param comment ответ Go на правку
 * @returns лента с новым текстом
 */
export function replace(list: readonly Comment[], comment: Comment): Comment[] {
    return list.map((item) => (item.id === comment.id ? comment : item));
}

/**
 * Лента без удалённого сообщения.
 * @param list текущая лента
 * @param id удалённое сообщение
 * @returns лента без него
 */
export function remove(list: readonly Comment[], id: number): Comment[] {
    return list.filter((item) => item.id !== id);
}

import { api } from '@api/bff';
import type { Comment } from './list';

/**
 * Страница ленты ячейки: новые первыми.
 * @param notebookId блокнот
 * @param cellId ячейка
 * @param cursor продолжение из `next_cursor`; без него — первая страница
 * @returns сообщения и курсор следующей страницы
 */
export function loadComments(notebookId: number, cellId: string, cursor?: string) {
    const query = cursor === undefined ? { notebookId, cellId } : { notebookId, cellId, cursor };
    return api('GET', '/api/comments/list', { params: { query } });
}

/**
 * Новое сообщение в ленту ячейки.
 * @param notebookId блокнот
 * @param cellId ячейка
 * @param text текст как введён: пробелы по краям обрезает Go
 * @returns созданное сообщение
 */
export function sendComment(notebookId: number, cellId: string, text: string): Promise<Comment> {
    return api('POST', '/api/comments/create', {
        contentType: 'application/json',
        body: { notebookId, cellId, text },
    });
}

/**
 * Новый текст своего сообщения.
 * @param notebookId блокнот
 * @param cellId ячейка
 * @param commentId сообщение
 * @param text новый текст
 * @returns сообщение после правки
 */
export function editComment(
    notebookId: number,
    cellId: string,
    commentId: number,
    text: string,
): Promise<Comment> {
    return api('POST', '/api/comments/update', {
        contentType: 'application/json',
        body: { notebookId, cellId, commentId, text },
    });
}

/**
 * Удаляет сообщение: своё или, владельцу блокнота, любое.
 * @param notebookId блокнот
 * @param cellId ячейка
 * @param commentId сообщение
 */
export async function deleteComment(
    notebookId: number,
    cellId: string,
    commentId: number,
): Promise<void> {
    await api('POST', '/api/comments/delete', {
        contentType: 'application/json',
        body: { notebookId, cellId, commentId },
    });
}

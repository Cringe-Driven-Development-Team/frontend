import {
    createCommentInput,
    deleteCommentInput,
    listCommentsInput,
    updateCommentInput,
} from '@cdd/schemas/validate';

import { route } from '../http.ts';

/**
 * Комментарии к ячейке: плоская лента, права на правку и удаление проверяет Go и сообщает
 * в `can_edit` / `can_delete`. Hash блокнота не участвует: комментарии не меняют содержимое.
 */
export const comments = [
    /** Страница ленты: новые первыми, следующая — по `cursor`. */
    route({
        method: 'GET',
        path: '/api/comments/list',
        access: 'authed',
        input: { from: 'query', validate: listCommentsInput },
        handle: ({ go }, { notebookId, cellId, cursor }) =>
            go.listComments(notebookId, cellId, cursor === undefined ? {} : { cursor }),
    }),
    route({
        method: 'POST',
        path: '/api/comments/create',
        access: 'authed',
        input: { from: 'json', validate: createCommentInput },
        handle: ({ go }, { notebookId, cellId, text }) =>
            go.createComment(notebookId, cellId, { text }),
    }),
    route({
        method: 'POST',
        path: '/api/comments/update',
        access: 'authed',
        input: { from: 'json', validate: updateCommentInput },
        handle: ({ go }, { notebookId, cellId, commentId, text }) =>
            go.updateComment(notebookId, cellId, commentId, { text }),
    }),
    route({
        method: 'POST',
        path: '/api/comments/delete',
        access: 'authed',
        input: { from: 'json', validate: deleteCommentInput },
        handle: ({ go }, { notebookId, cellId, commentId }) =>
            go.deleteComment(notebookId, cellId, commentId),
    }),
] as const;

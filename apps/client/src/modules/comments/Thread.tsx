import { useEffect, useRef, useState } from '@cdd-team/react';
import { clsx } from '@cdd-team/clsx';
import { commentTextValue } from '@cdd/schemas/validate';
import { Button } from '@components/Button/Button';
import { StateBlock } from '@components/StateBlock/StateBlock';
import { changeCount, closeThread } from '@stores/comments';
import { hideSnackbar, showSnackbar } from '@stores/snackbar';
import { deleteComment, editComment, loadComments, sendComment } from './actions';
import { Field } from './Field';
import { append, fromPage, prependOlder, remove, replace, type Comment } from './list';
import { Message } from './Message';
import styles from './Thread.module.css';

/** Свойства {@link Thread}. */
interface ThreadProps {
    notebookId: number;
    cellId: string;
    className?: string;
}

type Feed =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; items: Comment[]; cursor: string | null; older: boolean };

/** Фокус обратно на маркер или кнопку, открывшие тред. */
const focusToggle = (cellId: string): void => {
    document
        .querySelector<HTMLElement>(
            `[data-comment-toggle="${cellId}"] button, button[data-comment-toggle="${cellId}"]`,
        )
        ?.focus();
};

/**
 * Тред ячейки: лента от старых к новым, подгрузка ранних и поле «Ответить». Лента, черновик и
 * ошибки живут в компоненте: закрытый тред при следующем открытии грузится заново. Закрывается
 * по Esc, кликом вне треда и повторным нажатием маркера или кнопки ячейки.
 */
export function Thread({ notebookId, cellId, className }: ThreadProps) {
    const [feed, setFeed] = useState<Feed>({ status: 'loading' });
    const [attempt, setAttempt] = useState(0);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const rootRef = useRef<HTMLElement>(null);
    const aliveRef = useRef(true);
    /** Снекбар «Повторить» этого треда: закрытие треда его снимает */
    const retryRef = useRef<number | undefined>(undefined);
    /** Отправка идёт: рендер асинхронный, `sending` в обработчиках до коммита ещё прежний */
    const sendingRef = useRef(false);
    const fieldId = `comment-field-${cellId}`;

    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
            if (retryRef.current !== undefined) hideSnackbar(retryRef.current);
        };
    }, []);

    useEffect(() => {
        setFeed({ status: 'loading' });
        void loadComments(notebookId, cellId).then(
            (page) => {
                if (!aliveRef.current) return;
                setFeed({
                    status: 'ready',
                    items: fromPage(page.items),
                    cursor: page.next_cursor,
                    older: false,
                });
            },
            () => {
                if (aliveRef.current) setFeed({ status: 'error' });
            },
        );
    }, [notebookId, cellId, attempt]);

    // поле появляется с лентой: туда фокус, чтобы сразу писать
    useEffect(() => {
        if (feed.status === 'ready') document.getElementById(fieldId)?.focus();
    }, [feed.status, fieldId]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !rootRef.current?.contains(event.target as Node)) return;
            closeThread();
            focusToggle(cellId);
        };
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Element;
            // снекбар «Повторить» и диалог удаления — вне треда, но относятся к нему
            if (
                rootRef.current?.contains(target) ||
                target.closest(`[data-comment-toggle="${cellId}"], [role="alert"]`) ||
                document.querySelector('[aria-modal="true"]')
            ) {
                return;
            }
            closeThread();
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [cellId]);

    const loadOlder = (cursor: string) => {
        setFeed((current) => (current.status === 'ready' ? { ...current, older: true } : current));
        void loadComments(notebookId, cellId, cursor).then(
            (page) => {
                if (!aliveRef.current) return;
                setFeed((current) =>
                    current.status === 'ready'
                        ? {
                              status: 'ready',
                              items: prependOlder(current.items, page.items),
                              cursor: page.next_cursor,
                              older: false,
                          }
                        : current,
                );
            },
            () => {
                if (!aliveRef.current) return;
                setFeed((current) =>
                    current.status === 'ready' ? { ...current, older: false } : current,
                );
                showSnackbar('Не удалось загрузить ранние комментарии');
            },
        );
    };

    const send = async (text: string): Promise<void> => {
        if (sendingRef.current) return;
        sendingRef.current = true;
        if (retryRef.current !== undefined) hideSnackbar(retryRef.current);
        setSending(true);
        try {
            const comment = await sendComment(notebookId, cellId, text);
            changeCount(cellId, 1);
            if (!aliveRef.current) return;
            setFeed((current) =>
                current.status === 'ready'
                    ? { ...current, items: append(current.items, comment) }
                    : current,
            );
            setDraft((current) => (current === text ? '' : current));
        } catch {
            if (!aliveRef.current) return;
            retryRef.current = showSnackbar('Не удалось отправить комментарий', {
                label: 'Повторить',
                onClick: () => void send(text),
            });
        } finally {
            sendingRef.current = false;
            if (aliveRef.current) setSending(false);
        }
    };

    const save = async (comment: Comment, text: string): Promise<boolean> => {
        try {
            const saved = await editComment(notebookId, cellId, comment.id, text);
            if (aliveRef.current) {
                setFeed((current) =>
                    current.status === 'ready'
                        ? { ...current, items: replace(current.items, saved) }
                        : current,
                );
            }
            return true;
        } catch {
            if (aliveRef.current) showSnackbar('Не удалось сохранить комментарий');
            return false;
        }
    };

    const drop = async (comment: Comment): Promise<boolean> => {
        try {
            await deleteComment(notebookId, cellId, comment.id);
            changeCount(cellId, -1);
            if (aliveRef.current) {
                setFeed((current) =>
                    current.status === 'ready'
                        ? { ...current, items: remove(current.items, comment.id) }
                        : current,
                );
            }
            return true;
        } catch {
            if (aliveRef.current) showSnackbar('Не удалось удалить комментарий');
            return false;
        }
    };

    const canSend = !sending && commentTextValue(draft).success;
    const submit = () => {
        if (canSend) void send(draft);
    };
    const hasItems = feed.status === 'ready' && feed.items.length > 0;

    return (
        <section
            ref={rootRef}
            className={clsx(styles.thread, className)}
            aria-label="Комментарии к ячейке"
        >
            {feed.status === 'loading' && (
                <div key="loading" className={styles.skeleton} aria-busy="true">
                    <span key="a" className={styles.bar} />
                    <span key="b" className={styles.bar} />
                </div>
            )}
            {feed.status === 'error' && (
                <StateBlock
                    key="error"
                    title="Не удалось загрузить комментарии"
                    description="Проверьте подключение и попробуйте ещё раз."
                    error
                >
                    <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                        Повторить
                    </Button>
                </StateBlock>
            )}
            {feed.status === 'ready' && feed.cursor !== null && (
                <Button
                    key="older"
                    variant="secondary"
                    loading={feed.older}
                    onClick={() => {
                        if (feed.cursor !== null) loadOlder(feed.cursor);
                    }}
                >
                    Показать ранние
                </Button>
            )}
            {feed.status === 'ready' && hasItems && (
                <ul key="list" className={styles.list}>
                    {feed.items.map((comment) => (
                        <Message
                            key={comment.id}
                            comment={comment}
                            onSave={(text) => save(comment, text)}
                            onDelete={() => drop(comment)}
                        />
                    ))}
                </ul>
            )}
            {feed.status === 'ready' && (
                <form
                    key="form"
                    className={styles.form}
                    onSubmit={(event) => {
                        event.preventDefault();
                        submit();
                    }}
                >
                    <Field
                        key="field"
                        id={fieldId}
                        label="Комментарий к ячейке"
                        placeholder={hasItems ? 'Ответить…' : 'Комментарий к ячейке…'}
                        value={draft}
                        onInput={setDraft}
                        onSubmit={submit}
                    />
                    <Button
                        key="send"
                        type="submit"
                        variant="primary"
                        loading={sending}
                        disabled={!canSend}
                        className={styles.send}
                    >
                        {hasItems ? 'Ответить' : 'Отправить'}
                    </Button>
                </form>
            )}
        </section>
    );
}

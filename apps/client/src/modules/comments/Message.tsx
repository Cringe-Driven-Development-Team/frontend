import { useEffect, useRef, useState } from '@cdd-team/react';
import { clsx } from '@cdd-team/clsx';
import { commentTextValue } from '@cdd/schemas/validate';
import { Avatar } from '@components/Avatar/Avatar';
import { Button } from '@components/Button/Button';
import { IconButton } from '@components/IconButton/IconButton';
import { Modal } from '@components/Modal/Modal';
import { useTouchDevice } from '@utils/media';
import { timeAgo } from '@utils/date';
import { Field } from './Field';
import type { Comment } from './list';
import styles from './Message.module.css';

/** Свойства {@link Message}. */
interface MessageProps {
    comment: Comment;
    /** Сохранить новый текст; `true` — сохранён */
    onSave: (text: string) => Promise<boolean>;
    /** Удалить сообщение; `true` — удалено */
    onDelete: () => Promise<boolean>;
}

/**
 * Сообщение треда: аватар автора, логин, время и текст с переносами. «Редактировать» и «Удалить» —
 * только по `can_edit` / `can_delete` из ответа Go; на десктопе видны при наведении и фокусе, на
 * таче — всегда. Отмена правки возвращает исходный текст; при ошибке введённый текст остаётся.
 */
export function Message({ comment, onSave, onDelete }: MessageProps) {
    const touch = useTouchDevice();
    /** Текст в поле правки; null — сообщение не редактируется */
    const [draft, setDraft] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    /** Запрос идёт: рендер асинхронный, состояние в обработчиках до коммита ещё прежнее */
    const busyRef = useRef(false);
    const itemRef = useRef<HTMLLIElement>(null);
    /** Правка закрыта с клавиатуры или кнопкой: фокус обратно на «Редактировать» */
    const [refocus, setRefocus] = useState(false);
    useEffect(() => {
        if (!refocus) return;
        setRefocus(false);
        itemRef.current
            ?.querySelector<HTMLElement>('button[aria-label="Редактировать комментарий"]')
            ?.focus();
    }, [refocus]);
    const closeEdit = () => {
        setDraft(null);
        setRefocus(true);
    };
    const fieldId = `comment-edit-${comment.id}`;
    const cancelId = `comment-delete-cancel-${comment.id}`;

    const canSave = draft !== null && !saving && commentTextValue(draft).success;
    const save = async () => {
        if (!canSave || busyRef.current) return;
        busyRef.current = true;
        setSaving(true);
        const saved = await onSave(draft);
        busyRef.current = false;
        setSaving(false);
        if (saved) closeEdit();
    };
    const remove = async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        setDeleting(true);
        const removed = await onDelete();
        busyRef.current = false;
        // удалённое сообщение размонтируется вместе с диалогом
        if (!removed) {
            setDeleting(false);
            setConfirming(false);
        }
    };

    return (
        <li ref={itemRef} className={styles.message}>
            <div key="head" className={styles.head}>
                <Avatar
                    key="avatar"
                    login={comment.author.login}
                    src={comment.author.avatar_url}
                    className={styles.avatar}
                />
                <div key="who" className={styles.who}>
                    <span key="login" className={styles.login}>
                        {comment.author.login}
                    </span>
                    <span
                        key="time"
                        className={styles.time}
                        title={new Date(comment.created_at).toLocaleString('ru')}
                    >
                        {timeAgo(comment.created_at)}
                    </span>
                </div>
                {draft === null && (comment.can_edit || comment.can_delete) && (
                    <div key="actions" className={clsx(styles.actions, touch && styles.touch)}>
                        {comment.can_edit && (
                            <IconButton
                                key="edit"
                                icon="pencil"
                                label="Редактировать комментарий"
                                className={styles.action}
                                onClick={() => setDraft(comment.text)}
                            />
                        )}
                        {comment.can_delete && (
                            <IconButton
                                key="delete"
                                icon="trash"
                                label="Удалить комментарий"
                                className={clsx(styles.action, styles.delete)}
                                onClick={() => setConfirming(true)}
                            />
                        )}
                    </div>
                )}
            </div>
            {draft === null ? (
                <p key="text" className={styles.text}>
                    {comment.text}
                </p>
            ) : (
                <form
                    key="edit"
                    className={styles.edit}
                    onSubmit={(event) => {
                        event.preventDefault();
                        void save();
                    }}
                >
                    <Field
                        key="field"
                        id={fieldId}
                        label="Текст комментария"
                        value={draft}
                        disabled={saving}
                        focusOnMount
                        onInput={setDraft}
                        onSubmit={() => void save()}
                        onEscape={() => {
                            if (!saving) closeEdit();
                        }}
                    />
                    <div key="buttons" className={styles.buttons}>
                        <Button
                            key="save"
                            type="submit"
                            variant="primary"
                            loading={saving}
                            disabled={!canSave}
                        >
                            Сохранить
                        </Button>
                        <Button
                            key="cancel"
                            variant="secondary"
                            disabled={saving}
                            onClick={closeEdit}
                        >
                            Отмена
                        </Button>
                    </div>
                </form>
            )}
            {confirming && (
                <Modal
                    key="confirm"
                    title="Удалить комментарий?"
                    description="Комментарий исчезнет из обсуждения ячейки. Это действие нельзя отменить."
                    initialFocusId={cancelId}
                    locked={deleting}
                    onClose={() => setConfirming(false)}
                >
                    <div className={styles.buttons}>
                        <Button
                            key="cancel"
                            id={cancelId}
                            variant="secondary"
                            disabled={deleting}
                            onClick={() => setConfirming(false)}
                        >
                            Отмена
                        </Button>
                        <Button
                            key="delete"
                            variant="danger"
                            loading={deleting}
                            onClick={() => void remove()}
                        >
                            Удалить
                        </Button>
                    </div>
                </Modal>
            )}
        </li>
    );
}

import { timeAgo } from '@utils/date';
import type { Comment } from './list';
import styles from './Message.module.css';

/** Свойства {@link Message}. */
interface MessageProps {
    comment: Comment;
}

/** Сообщение треда: буква логина, логин, время и текст с переносами. */
export function Message({ comment }: MessageProps) {
    return (
        <li className={styles.message}>
            <div key="head" className={styles.head}>
                <span key="avatar" className={styles.avatar} aria-hidden="true">
                    {comment.author.login.charAt(0).toUpperCase()}
                </span>
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
            </div>
            <p key="text" className={styles.text}>
                {comment.text}
            </p>
        </li>
    );
}

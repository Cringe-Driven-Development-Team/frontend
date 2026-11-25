import { clsx } from '@cdd-team/clsx';
import { Icon } from '@components/Icon/Icon';
import { toggleThread, useCommentsStore } from '@stores/comments';
import { plural } from '@utils/plural';
import styles from './Marker.module.css';

/**
 * Маркер у ячейки с комментариями: число и открытие треда. Без комментариев не показывается.
 * @param props.cellId ячейка
 * @param props.className положение у ячейки — задаёт страница
 */
export function Marker({ cellId, className }: { cellId: string; className?: string }) {
    const count = useCommentsStore((state) => state.counts[cellId] ?? 0);
    const open = useCommentsStore((state) => state.openCellId === cellId);
    if (count === 0) return null;
    return (
        <button
            type="button"
            className={clsx(styles.marker, className)}
            data-comment-toggle={cellId}
            aria-expanded={open}
            aria-label={plural(count, 'комментарий', 'комментария', 'комментариев')}
            onClick={() => toggleThread(cellId)}
        >
            <Icon key="icon" name="comment" size={14} />
            <span key="count" aria-hidden="true">
                {count}
            </span>
        </button>
    );
}

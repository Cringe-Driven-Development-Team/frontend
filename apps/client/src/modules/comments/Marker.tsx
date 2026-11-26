import { clsx } from '@cdd-team/clsx';
import { Icon } from '@components/Icon/Icon';
import { toggleThread, useCommentsStore } from '@stores/comments';
import { plural } from '@utils/plural';
import styles from './Marker.module.css';

/** Свойства {@link Marker}. */
interface MarkerProps {
    /** Ячейка */
    cellId: string;
    /** Положение у ячейки — задаёт страница */
    className?: string;
}

/** Маркер у ячейки с комментариями: число и открытие треда. Без комментариев не показывается. */
export function Marker({ cellId, className }: MarkerProps) {
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

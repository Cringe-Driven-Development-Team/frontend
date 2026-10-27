import type { ReactNode } from '@cdd-team/react';
import emptyPlanetUrl from '@assets/empty-planet.svg';
import { clsx } from '@cdd-team/clsx';
import styles from './StateBlock.module.css';

/** Свойства {@link StateBlock}. */
interface StateBlockProps {
    title: string;
    description: string;
    /** Кнопки под описанием */
    children?: ReactNode;
    /** Класс блока кнопок */
    actionsClassName?: string;
}

/**
 * Заглушка пустого состояния (Components → StateBlock).
 * @param props свойства заглушки
 * @returns заглушка
 */
export function StateBlock({ title, description, children, actionsClassName }: StateBlockProps) {
    return (
        <div className={styles.block}>
            <img key="icon" src={emptyPlanetUrl} alt="" width={56} height={56} />
            <h2 key="title" className={styles.title}>
                {title}
            </h2>
            <p key="description" className={styles.description}>
                {description}
            </p>
            {children && (
                <div key="actions" className={clsx(styles.actions, actionsClassName)}>
                    {children}
                </div>
            )}
        </div>
    );
}

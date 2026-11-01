import { useConnectionStore } from '@stores/connection';
import styles from './OfflineBanner.module.css';

/**
 * Предупреждение о проблеме соединения поверх текущего экрана. Экран и введённые данные остаются.
 * @returns предупреждение или null
 */
export const OfflineBanner = () => {
    const lost = useConnectionStore((state) => state.lost);
    if (!lost) return null;
    return (
        <div className={styles.banner} aria-live="polite">
            Нет сети или сервер недоступен
        </div>
    );
};

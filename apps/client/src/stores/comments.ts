import { create } from '@cdd-team/zustand';

interface CommentsState {
    /** Число комментариев по id ячейки; ячеек без комментариев нет */
    counts: Record<string, number>;
    /** Ячейка с открытым тредом; null — тред закрыт */
    openCellId: string | null;
}

/** Стор комментариев открытого блокнота: счётчики маркеров и открытый тред. */
export const useCommentsStore = create<CommentsState>()(() => ({ counts: {}, openCellId: null }));

/**
 * Счётчики нового блокнота; открытый тред закрывается.
 * @param counts число комментариев по ячейкам из данных блокнота
 */
export function initComments(counts: Record<string, number>): void {
    useCommentsStore.setState({ counts: { ...counts }, openCellId: null });
}

/**
 * Открывает тред ячейки, предыдущий закрывается.
 * @param cellId id ячейки
 */
export function openThread(cellId: string): void {
    useCommentsStore.setState({ openCellId: cellId });
}

/** Закрывает тред. */
export function closeThread(): void {
    useCommentsStore.setState({ openCellId: null });
}

/**
 * Открывает тред ячейки или закрывает, если открыт он же.
 * @param cellId id ячейки
 */
export function toggleThread(cellId: string): void {
    const { openCellId } = useCommentsStore.getState();
    useCommentsStore.setState({ openCellId: openCellId === cellId ? null : cellId });
}

/**
 * Меняет счётчик после успешного добавления или удаления.
 * @param cellId id ячейки
 * @param delta +1 — добавлен, −1 — удалён
 */
export function changeCount(cellId: string, delta: 1 | -1): void {
    const { [cellId]: current = 0, ...rest } = useCommentsStore.getState().counts;
    const next = current + delta;
    useCommentsStore.setState({ counts: next > 0 ? { ...rest, [cellId]: next } : rest });
}

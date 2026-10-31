import { create } from '@cdd-team/zustand';
import { showToast } from '@stores/toast';

interface ConnectionState {
    /** Запрос к BFF не получил ответа или браузер сообщил об отсутствии сети */
    lost: boolean;
}

/** Стор соединения. `navigator.onLine` — подсказка: снимает предупреждение только ответ BFF. */
export const useConnectionStore = create<ConnectionState>()(() => ({
    lost: navigator.onLine === false,
}));

const setLost = (lost: boolean): void => useConnectionStore.setState({ lost });

// Уведомляет один раз: только на переходе от потери соединения к полученному ответу BFF
const confirmConnection = (): void => {
    if (useConnectionStore.getState().lost) showToast('Соединение восстановлено');
    setLost(false);
};

/**
 * `fetch`, который следит за соединением: любой полученный целиком HTTP-ответ, в том числе ошибка,
 * означает, что BFF доступен, а отказ запроса или обрыв тела — что ответа получить не удалось.
 * @param input адрес
 * @param [init] параметры запроса
 * @returns ответ `fetch`
 */
export async function fetchTracked(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<Response> {
    try {
        const response = await fetch(input, init);
        // тело тоже может оборваться: BFF доступен, только когда ответ получен целиком
        await response.clone().arrayBuffer();
        confirmConnection();
        return response;
    } catch (error) {
        setLost(true);
        throw error;
    }
}

/** Подписывается на сигналы браузера: `online` лишь запускает проверку доступности BFF. */
export function watchConnection(): void {
    window.addEventListener('offline', () => setLost(true));
    window.addEventListener('online', () => {
        fetchTracked('/robots.txt', { cache: 'no-store' }).catch(() => undefined);
    });
}

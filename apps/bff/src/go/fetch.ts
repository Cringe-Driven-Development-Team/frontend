// Адрес Go: на одной VPS — сервис api в сети Compose, на двух — приватный адрес VPS2
const goApiUrl = process.env.GO_API_URL ?? 'http://api:8080/api/v1';

/**
 * Мутатор клиента Go, сгенерированного Orval (`orval.config.ts`): дописывает адрес Go к пути
 * операции и отдаёт ответ в форме, которую ждёт клиент. `Authorization: Bearer <access>` передаёт
 * вызывающий код в заголовках запроса.
 * @param path путь операции из контракта Go, например `/notebooks/1/cells`
 * @param init параметры запроса: метод, заголовки, тело
 * @returns статус, заголовки и тело ответа (JSON, иначе текст; без тела — `undefined`)
 */
export const bearerFetch = async <T>(path: string, init: RequestInit): Promise<T> => {
    const response = await fetch(`${goApiUrl}${path}`, init);
    const text = await response.text();
    let data: unknown;
    if (text !== '') {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }
    return { data, status: response.status, headers: response.headers } as T;
};

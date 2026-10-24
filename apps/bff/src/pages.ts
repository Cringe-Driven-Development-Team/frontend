// Модуль без зависимостей: его импортируют и BFF, и маршруты клиента (`@cdd/bff/pages`)

/**
 * Пути страниц клиента — `path` маршрутов в `apps/client/src/routes`. Обёртки `_auth` и `_guest`
 * сегмента не добавляют, поэтому путь маршрута — он же путь адреса. Новая страница добавляется
 * сюда: по этому списку BFF отвечает на неизвестный адрес 404.
 */
export const PAGES = {
    index: '/',
    login: 'login',
    register: 'register',
    notebook: 'notebooks/$notebookId',
} as const;

const segments = (path: string) => path.split('/').filter(Boolean);

const decode = (segment: string) => {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
};

/**
 * Есть ли у клиента страница по этому адресу. Сопоставление как у роутера клиента: `$param` —
 * любой непустой сегмент, регистр статичных сегментов и завершающий слэш не учитываются.
 * @param pathname путь адреса
 * @returns `true`, если адрес — страница клиента
 */
export function isPage(pathname: string): boolean {
    const path = segments(pathname).map(decode);
    return Object.values(PAGES).some((page) => {
        const pattern = segments(page);
        return (
            pattern.length === path.length &&
            pattern.every(
                (segment, i) =>
                    segment.startsWith('$') || segment.toLowerCase() === path[i]?.toLowerCase(),
            )
        );
    });
}

import { join } from 'node:path';

/**
 * Публичные файлы клиента, которые BFF отдаёт по корневому пути (`/favicon.ico`). Тот же список
 * копирует в образ упаковка. JS и CSS сюда не входят: они на CDN.
 */
export const PUBLIC_FILES: readonly string[] = [
    'manifest.webmanifest',
    'pwa-192.png',
    'pwa-512.png',
    'pwa-maskable-512.png',
    'apple-touch-icon.png',
];

/**
 * Открывает файлы из `PUBLIC_FILES`. Бросает, если какого-то нет: такой образ собран неверно.
 * @param dir каталог сборки клиента, в нём же лежит шаблон
 * @returns файлы по имени
 */
export async function loadPublicFiles(dir: string): Promise<Map<string, Bun.BunFile>> {
    const files = new Map<string, Bun.BunFile>();
    for (const name of PUBLIC_FILES) {
        const file = Bun.file(join(dir, name));
        if (!(await file.exists())) throw new Error(`Нет публичного файла: ${name}`);
        files.set(name, file);
    }
    return files;
}

import { appendFileSync } from 'node:fs';

/** Ошибка шага выкатки: печатается аннотацией GitHub Actions, шаг завершается с кодом 1 */
export class ReleaseError extends Error {}

/**
 * Обязательная переменная окружения; если её нет или она пустая — ReleaseError.
 * @param name имя переменной
 * @returns значение переменной
 */
export function need(name: string): string {
    const value = process.env[name];
    if (!value) throw new ReleaseError(`Не задана переменная ${name}`);
    return value;
}

/**
 * Проверяет аргумент команды: нужен полный sha коммита, иначе ReleaseError.
 * @param sha аргумент команды
 * @returns тот же sha
 */
export function checkSha(sha: string | undefined): string {
    if (!sha || !isSha(sha))
        throw new ReleaseError(`Ожидается sha коммита, получено: '${sha ?? ''}'`);
    return sha;
}

/**
 * Похожа ли строка на полный sha коммита.
 * @param value строка
 * @returns true, если это 40 шестнадцатеричных символов в нижнем регистре
 */
export function isSha(value: string): boolean {
    return /^[0-9a-f]{40}$/.test(value);
}

function baseUrl(value: string): string {
    return (/^https?:\/\//.test(value) ? value : `https://${value}`).replace(/\/+$/, '');
}

/**
 * Адрес CDN релизов из переменной CDN_URL.
 * @returns адрес со схемой и без завершающего слэша
 */
export function cdnUrl(): string {
    return baseUrl(need('CDN_URL'));
}

/**
 * Адрес сайта из переменной SITE_URL (по умолчанию https://cellestial.ru).
 * @returns адрес со схемой и без завершающего слэша
 */
export function siteUrl(): string {
    return baseUrl(process.env.SITE_URL || 'https://cellestial.ru');
}

/**
 * Выход шага workflow; вне GitHub Actions ничего не делает.
 * @param name имя выхода
 * @param value значение
 */
export function output(name: string, value: string): void {
    const file = process.env.GITHUB_OUTPUT;
    if (file) appendFileSync(file, `${name}=${value}\n`);
}

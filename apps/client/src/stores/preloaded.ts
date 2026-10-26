import type { Notebook } from '@api/trpc';

// Блокнот из первого HTML: BFF кладёт его в bootstrap при прямом открытии своего блокнота
let preloaded: Notebook | undefined;

/**
 * Запоминает блокнот из bootstrap до первого показа его страницы.
 * @param notebook блокнот из bootstrap или `undefined`
 */
export function setPreloadedNotebook(notebook: Notebook | undefined): void {
    preloaded = notebook;
}

/**
 * Блокнот из первого HTML, если открыт именно он, без изъятия: для начального состояния страницы.
 * @param id ID открытого блокнота
 * @returns блокнот или `undefined`
 */
export function peekPreloadedNotebook(id: number): Notebook | undefined {
    return preloaded?.id === id ? preloaded : undefined;
}

/**
 * Блокнот из первого HTML, если открыт именно он. Отдаётся один раз: дальше страница берёт блокнот
 * у `notebooks.get`.
 * @param id ID открытого блокнота
 * @returns блокнот или `undefined`
 */
export function takePreloadedNotebook(id: number): Notebook | undefined {
    const notebook = preloaded;
    preloaded = undefined;
    return notebook?.id === id ? notebook : undefined;
}

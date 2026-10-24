/**
 * Читает HTML-шаблон клиента и проверяет маркер bootstrap: ровно один элемент
 * `id="bootstrap"`, и это `<script type="application/json">`.
 * @param path путь к `index.html` сборки клиента
 * @returns текст шаблона
 */
export async function loadTemplate(path: string): Promise<string> {
    const file = Bun.file(path);
    if (!(await file.exists())) throw new Error(`HTML-шаблон не найден: ${path}`);
    const html = await file.text();

    let markers = 0;
    let valid = true;
    new HTMLRewriter()
        .on('[id="bootstrap"]', {
            element(el) {
                markers++;
                if (el.tagName !== 'script' || el.getAttribute('type') !== 'application/json') {
                    valid = false;
                }
            },
        })
        .transform(html);

    if (markers !== 1 || !valid) {
        throw new Error(
            `HTML-шаблон ${path}: нужен ровно один <script id="bootstrap" type="application/json">`,
        );
    }
    return html;
}

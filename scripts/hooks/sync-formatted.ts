// post-commit: pre-commit отформатировал только индекс. Файл рабочего каталога, который отличается
// от коммита одним форматированием, приводится к закоммиченному виду. Файл с неиндексированными
// правками не трогается: после форматирования он не совпадает с коммитом.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { format, git, isFormatted } from './format.ts';

const root = git(['rev-parse', '--show-toplevel']).toString().trim();
const changed = git([
    'diff-tree',
    '--root',
    '--no-commit-id',
    '--name-only',
    '-r',
    '-z',
    '--diff-filter=ACMR',
    'HEAD',
])
    .toString()
    .split('\0')
    .filter((path) => path && isFormatted(path));

for (const path of changed) {
    const file = join(root, path);
    if (!existsSync(file)) continue;
    const committed = git(['cat-file', 'blob', `HEAD:${path}`]);
    const working = readFileSync(file);
    if (working.equals(committed)) continue;
    try {
        if (format(path, working).equals(committed)) writeFileSync(file, committed);
    } catch {
        // не форматируется (синтаксис) — значит, это не чистое форматирование: не трогаем
    }
}

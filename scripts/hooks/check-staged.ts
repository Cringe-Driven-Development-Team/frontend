// `bun run check` по тому, что уходит в коммит. На время проверки рабочий каталог совпадает
// с индексом: неиндексированные правки и новые файлы лежат в .git/check-staged/, потом
// возвращаются. Общий для worktree `git stash` не используется.
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { git as gitArgs } from './format.ts';

const git = (...args: string[]): Buffer => gitArgs(args);

async function run(cmd: string[]): Promise<number> {
    const proc = Bun.spawn(cmd, { stdio: ['inherit', 'inherit', 'inherit'] });
    return proc.exited;
}

async function main(): Promise<number> {
    const check = ['bun', 'run', 'check'];
    const backup = join(git('rev-parse', '--absolute-git-dir').toString().trim(), 'check-staged');
    if (existsSync(backup)) {
        console.error(`${backup} остался от прошлой проверки: верните правки оттуда и удалите его`);
        return 1;
    }
    const patch = git('diff', '--binary');
    const untracked = git('ls-files', '--others', '--exclude-standard', '-z')
        .toString()
        .split('\0')
        .filter(Boolean);
    if (patch.length === 0 && untracked.length === 0) return run(check);

    const patchFile = join(backup, 'unstaged.patch');
    const moved: string[] = [];
    let worktreeReset = false;
    // Ctrl+C получает и сама проверка: дождаться её и вернуть правки. Обработчик и finally —
    // до первой правки рабочего каталога: прерывание на любом шаге возвращает то, что успели убрать
    process.on('SIGINT', () => {});
    try {
        await mkdir(join(backup, 'untracked'), { recursive: true });
        await Bun.write(patchFile, patch);
        for (const file of untracked) {
            const to = join(backup, 'untracked', file);
            await mkdir(dirname(to), { recursive: true });
            await rename(file, to);
            moved.push(file);
        }
        if (patch.length > 0) {
            // до вызова: прерванный restore мог успеть откатить часть файлов
            worktreeReset = true;
            git('restore', '--worktree', '--', ':/');
        }
        return await run(check);
    } finally {
        let restored = true;
        try {
            for (const file of moved) {
                await mkdir(dirname(file), { recursive: true });
                await rename(join(backup, 'untracked', file), file);
            }
            if (worktreeReset) git('apply', '--binary', patchFile);
        } catch (error) {
            restored = false;
            console.error(`Не удалось вернуть правки (${String(error)}): они лежат в ${backup}`);
        }
        if (restored) await rm(backup, { recursive: true });
    }
}

process.exit(await main());

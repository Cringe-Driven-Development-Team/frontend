// `bun run check` по тому, что уходит в коммит. На время проверки рабочий каталог совпадает
// с индексом: неиндексированные правки и новые файлы лежат в .git/check-staged/, потом
// возвращаются. Общий для worktree `git stash` не используется.
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function git(...args: string[]): Buffer {
    const res = Bun.spawnSync(['git', ...args], { stderr: 'inherit' });
    if (!res.success) throw new Error(`git ${args.join(' ')}: код ${res.exitCode}`);
    return res.stdout;
}

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
    await mkdir(join(backup, 'untracked'), { recursive: true });
    await Bun.write(patchFile, patch);
    for (const file of untracked) {
        const to = join(backup, 'untracked', file);
        await mkdir(dirname(to), { recursive: true });
        await rename(file, to);
    }
    if (patch.length > 0) git('restore', '--worktree', '--', ':/');

    // Ctrl+C получает и сама проверка: дождаться её и вернуть правки
    process.on('SIGINT', () => {});
    try {
        return await run(check);
    } finally {
        for (const file of untracked) {
            await mkdir(dirname(file), { recursive: true });
            await rename(join(backup, 'untracked', file), file);
        }
        if (patch.length > 0) git('apply', '--binary', patchFile);
        await rm(backup, { recursive: true });
    }
}

process.exit(await main());

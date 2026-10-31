import { expect, test } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('formatter and staged hook preserve generated wiki and format handwritten instructions', () => {
    const root = resolve(import.meta.dir, '../..');
    const cwd = mkdtempSync(join(tmpdir(), 'frontend-format-'));
    const run = (args: string[]) => Bun.spawnSync(args, { cwd });
    try {
        cpSync(join(root, 'oxfmt.config.ts'), join(cwd, 'oxfmt.config.ts'));
        cpSync(join(root, 'scripts/hooks'), join(cwd, 'scripts/hooks'), { recursive: true });
        symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'));
        mkdirSync(join(cwd, 'openwiki/.claims'), { recursive: true });
        const generated = {
            'openwiki/index.md': '# Generated\n\n-   managed page\n',
            'openwiki/.claims/page.json': '{"claims":[]}\n',
            'openwiki/.last-update.json': '{"status":"complete"}\n',
        };
        for (const [path, content] of Object.entries(generated)) {
            writeFileSync(join(cwd, path), content);
        }
        const instructions = 'openwiki/INSTRUCTIONS.md';
        writeFileSync(join(cwd, instructions), '# Instructions\n\n-   handwritten\n');
        expect(run(['git', 'init', '-q']).exitCode).toBe(0);
        expect(run(['git', 'add', 'openwiki']).exitCode).toBe(0);
        expect(run(['bun', 'scripts/hooks/format-staged.ts']).exitCode).toBe(0);
        for (const [path, content] of Object.entries(generated)) {
            expect(run(['git', 'show', `:${path}`]).stdout.toString()).toBe(content);
        }
        expect(run(['git', 'show', `:${instructions}`]).stdout.toString()).toBe(
            '# Instructions\n\n- handwritten\n',
        );
        const formatter = join(root, 'node_modules/.bin/oxfmt');
        expect(run([formatter, '--check', 'openwiki']).exitCode).toBe(1);
        expect(run([formatter, 'openwiki']).exitCode).toBe(0);
        expect(run([formatter, '--check', 'openwiki']).exitCode).toBe(0);
        for (const [path, content] of Object.entries(generated)) {
            expect(Bun.file(join(cwd, path)).size).toBe(Buffer.byteLength(content));
            expect(run(['git', 'diff', '--', path]).stdout.toString()).toBe('');
        }
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});

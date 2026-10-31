import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUBLIC_FILES, loadClientAssets } from '../src/public.ts';

// без файла в allowlist или COPY образ не собирается либо BFF не стартует
test('публичные файлы попадают в образ', async () => {
    const dockerfile = await Bun.file(new URL('../Dockerfile', import.meta.url)).text();
    const ignore = await Bun.file(new URL('../Dockerfile.dockerignore', import.meta.url)).text();
    for (const name of PUBLIC_FILES) {
        expect(dockerfile).toContain(`apps/client/dist/${name}`);
        expect(ignore).toContain(`!apps/client/dist/${name}`);
    }
    // строка с отступом — только продолжение инструкции предыдущей
    const lines = dockerfile.split('\n');
    lines.forEach((line, index) => {
        if (line.startsWith(' ')) expect(lines[index - 1]).toEndWith('\\');
    });
    // одна обратная косая в конце строки — продолжение инструкции
    expect(dockerfile).not.toContain('\\\\');
});

test('JS и CSS сборки открываются только из assets/', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'client-'));
    await mkdir(join(dir, 'assets'));
    await Bun.write(join(dir, 'assets/index.js'), '1');
    await Bun.write(join(dir, 'index.html'), '<html>');
    await Bun.write(join(dir, 'secret.txt'), 'x');
    expect([...(await loadClientAssets(dir)).keys()]).toEqual(['assets/index.js']);
    await rm(dir, { recursive: true });
});

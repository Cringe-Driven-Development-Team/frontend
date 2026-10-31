import { expect, test } from 'bun:test';
import { PUBLIC_FILES } from '../src/public.ts';

// без файла в allowlist или COPY образ не собирается либо BFF не стартует
test('публичные файлы попадают в образ', async () => {
    const dockerfile = await Bun.file(new URL('../Dockerfile', import.meta.url)).text();
    const ignore = await Bun.file(new URL('../Dockerfile.dockerignore', import.meta.url)).text();
    for (const name of PUBLIC_FILES) {
        expect(dockerfile).toContain(`apps/client/dist/${name}`);
        expect(ignore).toContain(`!apps/client/dist/${name}`);
    }
    // одна обратная косая в конце строки — продолжение инструкции
    expect(dockerfile).not.toContain('\\\\');
});

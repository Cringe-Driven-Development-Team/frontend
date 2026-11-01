import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('тесты уведомлений не пишут в унаследованный Summary CI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'notify-summary-'));
    try {
        const summary = join(dir, 'ci-summary.md');
        writeFileSync(summary, 'Existing CI summary\n');
        const result = Bun.spawnSync(
            [
                process.execPath,
                'test',
                fileURLToPath(new URL('./notify.test.ts', import.meta.url)),
                '--test-name-pattern',
                '^(карточка выкатки показывает полные SHA и digest|CLI rollback сохраняет русский текст уведомления)$',
            ],
            {
                env: {
                    ...process.env,
                    GITHUB_STEP_SUMMARY: summary,
                    GITHUB_RUN_ID: '12',
                    GITHUB_SERVER_URL: 'https://github.com',
                },
            },
        );
        expect(result.exitCode).toBe(0);
        expect(readFileSync(summary, 'utf8')).toBe('Existing CI summary\n');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

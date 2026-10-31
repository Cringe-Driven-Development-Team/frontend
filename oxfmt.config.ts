import { defineConfig } from 'oxfmt';

export default defineConfig({
    singleQuote: true,
    printWidth: 100,
    endOfLine: 'lf',
    tabWidth: 4,
    ignorePatterns: [
        '.claude/**',
        '.github/**',
        'README.md',
        '**/dist/**',
        '.turbo/**',
        'spec/**',
        'openwiki/**',
        '!openwiki/INSTRUCTIONS.md',
        'apps/bff/src/go/client.ts',
        'packages/schemas/src/zod.ts',
    ],
});

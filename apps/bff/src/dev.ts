// Локальный запуск — `bun run dev` из корня (turbo запускает и клиент): BFF за Vite на
// https://localhost:5173, Go — Cloud Mock Apidog. Переменные из корневого .env важнее этих.
process.env.HTML_TEMPLATE ??= '../client/index.html';
process.env.APP_ORIGIN ??= 'https://localhost:5173';
process.env.GO_API_URL ??= 'https://mock.apidog.com/m1/1382426-0-default';
// постоянный ключ только для dev: сессия переживает перезапуск --watch; на проде SESSION_KEY — из Vault
process.env.SESSION_KEY ??= 'Y2VsbGVzdGlhbC1sb2NhbC1kZXYtc2Vzc2lvbi1rZXk=';

await import('./index.ts');

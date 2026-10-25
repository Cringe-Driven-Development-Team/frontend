import { fileURLToPath } from 'node:url';

// Окружение тестов BFF. Go не нужен: его ответы управляются в test/fake-go.ts.
process.env.SESSION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.GO_API_URL = 'http://go.test/api/v1';
// fileURLToPath, а не .pathname: на Windows .pathname даёт /C:/…, такой файл Bun.file не находит
process.env.HTML_TEMPLATE = fileURLToPath(new URL('./index.html', import.meta.url));

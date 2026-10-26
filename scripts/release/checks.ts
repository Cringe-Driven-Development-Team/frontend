import { ReleaseError, cdnUrl, siteUrl } from './env.ts';

const TIMEOUT_MS = 10_000;
const INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 5000);
// после переключения Caddy и BFF отвечают не сразу
const HEALTH_WAIT_MS = Number(process.env.HEALTH_WAIT_MS || 120_000);
const RELEASE_CHECK_TRIES = 3;

function releaseOf(html: string): string | undefined {
    return /<meta name="release" content="([^"]*)"/.exec(html)?.[1];
}

async function get(url: string, headers?: Record<string, string>): Promise<Response> {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${url}: ответ ${res.status}`);
    return res;
}

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

async function releaseCheckOnce(sha: string): Promise<string> {
    const cdn = cdnUrl();
    const site = siteUrl();
    const base = `${cdn}/releases/${sha}/`;
    const html = await (await get(`${base}index.html`)).text();
    if (releaseOf(html) !== sha) {
        throw new Error(`${base}index.html: release='${releaseOf(html) ?? ''}', нужен '${sha}'`);
    }
    const chunk = new RegExp(`src="(${RegExp.escape(base)}[^"]*\\.js)"`).exec(html)?.[1];
    if (!chunk) throw new Error(`В ${base}index.html нет чанка с ${base}`);
    // чанки подключены как <script type="module" crossorigin>: без CORS браузер их не выполнит
    const res = await get(chunk, { Origin: site });
    await res.body?.cancel();
    const origin = res.headers.get('access-control-allow-origin');
    if (origin !== '*' && origin !== site) {
        throw new Error(`${chunk}: Access-Control-Allow-Origin='${origin ?? ''}', нужен '${site}'`);
    }
    return chunk;
}

/**
 * Релиз отдаётся с CDN: его index.html и чанк из него. Выполняется после заливки и до переключения.
 * @param sha sha релиза
 */
export async function releaseCheck(sha: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            const chunk = await releaseCheckOnce(sha);
            console.log(`OK: релиз ${sha} отдаётся с CDN, ${chunk} грузится с ${siteUrl()}`);
            return;
        } catch (err) {
            console.log(message(err));
            if (attempt === RELEASE_CHECK_TRIES) break;
            await Bun.sleep(INTERVAL_MS);
        }
    }
    throw new ReleaseError(`Release check не прошёл: релиз ${sha} не отдаётся с CDN`);
}

async function healthOnce(sha: string): Promise<string> {
    const site = siteUrl();
    const base = `${cdnUrl()}/releases/${sha}/`;
    // гостю HTML отдаёт /login: защищённые страницы ведут его туда редиректом BFF
    const page = await get(`${site}/login`, { Accept: 'text/html' });
    if (page.headers.get('cache-control') !== 'private, no-store') {
        throw new Error(
            `${site}/login: Cache-Control='${page.headers.get('cache-control') ?? ''}'`,
        );
    }
    const html = await page.text();
    const bootstraps = [
        ...html.matchAll(/<script id="bootstrap" type="application\/json">([^<]*)<\/script>/g),
    ];
    if (bootstraps.length !== 1 || bootstraps[0]![1] !== '{"user":null}') {
        throw new Error(`${site}/login: нужен ровно один bootstrap {"user":null}`);
    }
    if (releaseOf(html) !== sha) {
        throw new Error(`${site}/login: release='${releaseOf(html) ?? ''}', ждём '${sha}'`);
    }
    // JS и CSS выпуска — с CDN своего SHA; чанки — с CORS для <script type="module" crossorigin>
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(js|css))"/g)].map(([, url, kind]) => ({
        url: url!,
        kind: kind!,
    }));
    if (
        !assets.some(({ kind }) => kind === 'js') ||
        assets.some(({ url }) => !url.startsWith(base))
    ) {
        throw new Error(`${site}/login: JS и CSS должны идти с ${base}`);
    }
    for (const { url, kind } of assets) {
        const res = await get(url, { Origin: site });
        await res.body?.cancel();
        const origin = res.headers.get('access-control-allow-origin');
        if (kind === 'js' && origin !== '*' && origin !== site) {
            throw new Error(`${url}: Access-Control-Allow-Origin='${origin ?? ''}'`);
        }
    }
    const rpc = await fetch(`${site}/api/trpc/users.me`, {
        headers: { 'X-CSRF': '1' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await rpc.json().catch(() => undefined)) as
        | { error?: { data?: { code?: string } } }
        | undefined;
    if (rpc.status !== 401 || body?.error?.data?.code !== 'UNAUTHORIZED') {
        throw new Error(
            `${site}/api/trpc/users.me без сессии: ${rpc.status}, нужен tRPC UNAUTHORIZED`,
        );
    }
    const unknown = await fetch(`${site}/api/unknown`, {
        headers: { Accept: 'text/html' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await unknown.body?.cancel();
    if (
        unknown.status !== 404 ||
        (unknown.headers.get('content-type') ?? '').includes('text/html')
    ) {
        throw new Error(`${site}/api/unknown: ${unknown.status}, нужен 404 не HTML`);
    }
    return `${assets.length} ассетов`;
}

/**
 * Прод отдаёт выпуск через BFF: гостевой HTML с одним bootstrap и релизом SHA, его JS и CSS с CDN,
 * tRPC UNAUTHORIZED без сессии и 404 не HTML на неизвестном /api. Выполняется после переключения;
 * образ, healthy и внутренний /health проверяет Ansible (deploy-bff.yml).
 * @param sha sha релиза
 */
export async function health(sha: string): Promise<void> {
    const deadline = Date.now() + HEALTH_WAIT_MS;
    for (;;) {
        try {
            const assets = await healthOnce(sha);
            console.log(`OK: ${siteUrl()} отдаёт выпуск ${sha} через BFF, ${assets} с CDN`);
            return;
        } catch (err) {
            console.log(message(err));
        }
        if (Date.now() + INTERVAL_MS > deadline) break;
        await Bun.sleep(INTERVAL_MS);
    }
    throw new ReleaseError(`Health check не прошёл: ${siteUrl()} не отдаёт выпуск ${sha}`);
}

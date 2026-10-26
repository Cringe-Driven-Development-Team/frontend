import { afterEach, expect, test } from 'bun:test';
import { ReleaseError } from './env.ts';
import { checkImage, checkImageRef } from './image.ts';

const SHA = 'a'.repeat(40);
const DIGEST = `sha256:${'1'.repeat(64)}`;
const REF = `ghcr.io/cringe-driven-development-team/bff@${DIGEST}`;
const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

/**
 * Подменяет GHCR: анонимный токен, индекс с linux/amd64, манифест и config с меткой ревизии.
 * @param options метка ревизии и коды ответов
 * @param options.revision значение org.opencontainers.image.revision
 * @param options.tokenStatus ответ на запрос анонимного токена
 * @param options.manifestStatus ответ на запрос манифеста по digest
 * @returns запрошенные адреса и их Authorization
 */
function ghcr(options: { revision?: string; tokenStatus?: number; manifestStatus?: number } = {}) {
    const calls: { url: string; auth: string | null }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
        if (url.includes('/token?')) {
            return Response.json({ token: 'anonymous' }, { status: options.tokenStatus ?? 200 });
        }
        if (url.endsWith(`/manifests/${DIGEST}`)) {
            return Response.json(
                {
                    mediaType: 'application/vnd.oci.image.index.v1+json',
                    manifests: [
                        {
                            digest: 'sha256:attestation',
                            platform: { os: 'unknown', architecture: 'unknown' },
                        },
                        {
                            digest: 'sha256:amd64',
                            platform: { os: 'linux', architecture: 'amd64' },
                        },
                    ],
                },
                {
                    status: options.manifestStatus ?? 200,
                    headers: { 'Docker-Content-Digest': DIGEST },
                },
            );
        }
        if (url.endsWith('/manifests/sha256:amd64'))
            return Response.json({ config: { digest: 'sha256:cfg' } });
        if (url.endsWith('/blobs/sha256:cfg')) {
            return Response.json({
                config: {
                    Labels: { 'org.opencontainers.image.revision': options.revision ?? SHA },
                },
            });
        }
        return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return calls;
}

test('образ скачивается анонимно и помечен своим SHA', async () => {
    const calls = ghcr();
    await checkImage(REF, SHA);
    expect(calls[0]!.url).toBe(
        'https://ghcr.io/token?service=ghcr.io&scope=repository:cringe-driven-development-team/bff:pull',
    );
    // никаких учётных данных: только анонимный токен реестра
    expect(calls[0]!.auth).toBeNull();
    expect(calls.slice(1).every((call) => call.auth === 'Bearer anonymous')).toBe(true);
});

test('чужая ревизия, приватный package и неизвестный digest — ошибка', async () => {
    ghcr({ revision: 'b'.repeat(40) });
    await expect(checkImage(REF, SHA)).rejects.toThrow("revision='" + 'b'.repeat(40));
    ghcr({ tokenStatus: 403 });
    await expect(checkImage(REF, SHA)).rejects.toThrow('публичным');
    ghcr({ manifestStatus: 404 });
    await expect(checkImage(REF, SHA)).rejects.toThrow('не скачивается анонимно');
});

test('только образ BFF по digest', () => {
    expect(checkImageRef(REF)).toBe(REF);
    for (const ref of [
        undefined,
        'ghcr.io/cringe-driven-development-team/bff:sha-' + SHA,
        'ghcr.io/cringe-driven-development-team/backend@' + DIGEST,
        'docker.io/cringe-driven-development-team/bff@' + DIGEST,
        REF + ';echo',
    ]) {
        expect(() => checkImageRef(ref)).toThrow(ReleaseError);
    }
});

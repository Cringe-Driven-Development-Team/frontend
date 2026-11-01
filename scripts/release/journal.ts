import { activationTime, isDeployed, readReleaseCatalog } from './catalog.ts';
import { checkSha, ReleaseError } from './env.ts';
import {
    createDeployment,
    listDeployments,
    setDeploymentState,
    type Deployment,
} from './github.ts';
import { sendTelegram, TelegramRejectedError, type TelegramMessage } from './notify.ts';

const ENVIRONMENT = 'release-automation';
/** Неизменяемый текст и источник события. */
export interface Notice {
    kind: 'queue' | 'ready';
    key: string;
    ref: string;
    source: string;
    message: TelegramMessage;
    prNumbers: number[];
    reportUrl: string | null;
}
/** Итог доставки: неоднозначные сообщения не мешают остальным. */
export interface DeliveryResult {
    sent: number;
    skipped: number;
    errors: string[];
}
interface Baseline {
    kind: 'baseline';
    key: 'baseline';
    activatedAt: string;
}
type Payload = Omit<Notice, 'ref'> | Baseline;

async function journal(): Promise<Deployment<Payload>[]> {
    const records = await listDeployments<Payload>(ENVIRONMENT);
    const keys = new Set<string>();
    for (const record of records) {
        const value = record.payload;
        if (
            !value ||
            typeof value.key !== 'string' ||
            !['baseline', 'queue', 'ready'].includes(value.kind) ||
            keys.has(value.key)
        )
            throw new ReleaseError(`Неоднозначный журнал Deployment ${record.id}`);
        keys.add(value.key);
        if (value.kind === 'baseline') {
            if (value.key !== 'baseline' || !Number.isFinite(Date.parse(value.activatedAt)))
                throw new ReleaseError('Некорректная граница baseline');
        } else if (
            !value.key.startsWith(`${value.kind}:`) ||
            typeof value.message?.text !== 'string' ||
            !value.message.text ||
            !Array.isArray(value.prNumbers) ||
            value.prNumbers.some((number) => !Number.isSafeInteger(number) || number <= 0) ||
            typeof value.source !== 'string' ||
            (value.kind === 'ready' && typeof value.reportUrl !== 'string')
        )
            throw new ReleaseError(`Некорректное уведомление ${record.id}`);
    }
    return records.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
}

/** Записывает границу из main один раз; это не уведомление. */
export async function ensureBaseline(repoDir: string): Promise<string> {
    const existing = (await journal()).find((record) => record.payload.kind === 'baseline');
    if (existing?.payload.kind === 'baseline') {
        if (existing.state !== 'success')
            await setDeploymentState(existing.id, 'success', 'Граница включения сохранена');
        return existing.payload.activatedAt;
    }
    const activatedAt = await activationTime(repoDir);
    const ref = Bun.spawnSync(['git', 'rev-parse', 'origin/main'], { cwd: repoDir });
    if (ref.exitCode) throw new ReleaseError('Не удалось определить main для baseline');
    const id = await createDeployment({
        environment: ENVIRONMENT,
        sha: checkSha(ref.stdout.toString().trim()),
        task: 'baseline',
        payload: { kind: 'baseline', key: 'baseline', activatedAt },
    });
    await setDeploymentState(id, 'success', 'Граница включения сохранена');
    return activatedAt;
}

/** Создаёт pending только для нового ключа, не переписывая уже подготовленное сообщение. */
export async function prepareNotice(notice: Notice): Promise<'created' | 'existing'> {
    checkSha(notice.ref);
    if ((await journal()).some((record) => record.payload.key === notice.key)) return 'existing';
    const { ref, ...payload } = notice;
    const id = await createDeployment({
        environment: ENVIRONMENT,
        sha: ref,
        task: notice.kind,
        payload,
    });
    await setDeploymentState(id, 'pending', notice.key);
    return 'created';
}

/** Доставляет ожидающие сообщения; неизвестный исход требует ручной проверки. */
export async function sendPending(
    repoDir: string,
    kind?: Notice['kind'],
    key?: string,
): Promise<DeliveryResult> {
    const result: DeliveryResult = { sent: 0, skipped: 0, errors: [] };
    for (const record of await journal()) {
        const payload = record.payload;
        if (
            payload.kind === 'baseline' ||
            (kind && payload.kind !== kind) ||
            (key && payload.key !== key)
        )
            continue;
        try {
            if (record.state === 'success' || record.state === 'inactive') {
                result.skipped++;
                continue;
            }
            if (record.state && record.state !== 'pending')
                throw new ReleaseError(
                    `${payload.key}: ${record.state}, проверьте Telegram и Deployment ${record.id} перед повтором`,
                );
            if (
                payload.kind === 'ready' &&
                (await isDeployed(
                    record.sha,
                    (await readReleaseCatalog(repoDir)).deployedShas,
                    repoDir,
                ))
            ) {
                await setDeploymentState(record.id, 'inactive', 'already_deployed');
                result.skipped++;
                continue;
            }
            await setDeploymentState(record.id, 'in_progress', payload.key);
            let messageId: number;
            try {
                messageId = await sendTelegram(payload.message);
            } catch (error) {
                if (error instanceof TelegramRejectedError)
                    await setDeploymentState(record.id, 'pending', error.message);
                throw error;
            }
            await setDeploymentState(record.id, 'success', `telegram_message_id=${messageId}`);
            console.log(`${payload.key}, Deployment ${record.id}: Telegram message ${messageId}`);
            result.sent++;
        } catch (error) {
            const message = `${payload.key}, Deployment ${record.id}: ${error instanceof Error ? error.message : String(error)}`;
            console.error(`::error::${message}`);
            result.errors.push(message);
        }
    }
    return result;
}

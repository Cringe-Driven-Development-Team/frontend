import { afterEach, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { readChangeReport, writeChangeSummary, reportRelease } from './report.ts';
import { register, startProduction } from './deployments.ts';
import { fixture, IMAGE, REPO } from './test/fixture.ts';
const sha = (n: number) => n.toString(16).padStart(40, '0');
let f: ReturnType<typeof fixture>;
beforeEach(() => {
    f = fixture();
    delete process.env.GITHUB_STEP_SUMMARY;
    process.env.GITHUB_RUN_ID = '77';
    process.env.GITHUB_RUN_ATTEMPT = '2';
    f.extra = (url) => {
        const match = /\/commits\/([0-9a-f]{40})\/pulls$/.exec(url.pathname);
        if (match) return Response.json(f.pulls.filter((p) => p.merge_commit_sha === match[1]));
        return undefined;
    };
});
afterEach(() => f.restore());
test('range_collects_all_pages_and_only_merged_prs', async () => {
    const extra = f.extra;
    const commits = [...Array.from({ length: 100 }, (_, i) => ({ sha: sha(i + 1) })), { sha: f.b }];
    f.extra = (url, body, init) => {
        if (url.pathname.includes('/compare/')) {
            const page = Number(url.searchParams.get('page') ?? 1);
            return Response.json({
                total_commits: 101,
                commits: commits.slice((page - 1) * 100, page * 100),
            });
        }
        if (/\/commits\//.test(url.pathname))
            return Response.json(
                url.pathname.includes(f.b) ? [f.pulls[1], { ...f.pulls[0], merged_at: null }] : [],
            );
        return extra?.(url, body, init);
    };
    const result = await readChangeReport(REPO, f.a, f.b);
    expect(result.complete).toBe(true);
    expect(result.prs.map((p) => p.number)).toEqual([2]);
    expect(result.issues.map((p) => p.number)).toEqual([2]);
    expect(
        f.requests.some(
            (r) => r.url.pathname.endsWith('/pulls') && !r.url.pathname.includes('/commits/'),
        ),
    ).toBe(false);
});
test('null_base_does_not_scan_all_prs', async () => {
    const report = await readChangeReport(REPO, null, f.b);
    expect(report).toMatchObject({
        complete: false,
        baseSha: null,
        headSha: f.b,
        prs: [],
        issues: [],
    });
    expect(f.requests).toHaveLength(0);
});
test('rollback_uses_target_to_before', async () => {
    process.env.RELEASE_BEFORE_SHA = f.b;
    process.env.GITHUB_STEP_SUMMARY = join(f.dir, 'report.md');
    process.env.GITHUB_OUTPUT = join(f.dir, 'outputs');
    await reportRelease('rollback', f.a, f.dir);
    expect(f.requests.some((r) => r.url.pathname.endsWith(`/compare/${f.a}...${f.b}`))).toBe(true);
    expect(readFileSync(process.env.GITHUB_OUTPUT, 'utf8')).toContain(`report_base_sha=${f.b}`);
    expect(readFileSync(process.env.GITHUB_STEP_SUMMARY, 'utf8')).toContain('#2: PR 2');
});
test('unknown_base_does_not_invent_sha', async () => {
    process.env.GITHUB_STEP_SUMMARY = join(f.dir, 'unknown.md');
    const report = await readChangeReport(REPO, null, f.b);
    expect(writeChangeSummary(report)).toBeNull();
    const summary = readFileSync(process.env.GITHUB_STEP_SUMMARY, 'utf8');
    expect(summary).toContain('база неизвестна');
    expect(summary).not.toContain('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
});
test('operation_records_include_source_attempt_and_report_metadata', async () => {
    process.env.RELEASE_REPORT_BASE_SHA = f.a;
    process.env.RELEASE_REPORT_URL = `https://github.com/${REPO}/actions/runs/77#summary`;
    await register(f.b, IMAGE);
    await startProduction(f.b, IMAGE, 'deploy');
    for (const environment of ['release-artifacts', 'production']) {
        expect(f.records[environment]![0]!.payload).toMatchObject({
            notification: {
                base_sha: f.a,
                report_url: `https://github.com/${REPO}/actions/runs/77#summary`,
                run_attempt: 2,
            },
        });
    }
});
test('operation_rejects_foreign_report_and_invalid_attempt_before_write', async () => {
    process.env.RELEASE_REPORT_URL = 'https://evil.invalid/report';
    await expect(register(f.b, IMAGE)).rejects.toThrow();
    delete process.env.RELEASE_REPORT_URL;
    process.env.GITHUB_RUN_ATTEMPT = '0';
    await expect(startProduction(f.b, IMAGE, 'deploy')).rejects.toThrow();
    expect(f.records.production).toHaveLength(0);
});
test('publication_uses_nearest_verified_ancestor', async () => {
    f.publish(f.a);
    process.env.GITHUB_OUTPUT = join(f.dir, 'outputs');
    process.env.GITHUB_STEP_SUMMARY = join(f.dir, 'report.md');
    await reportRelease('publish', f.b, f.dir);
    expect(readFileSync(process.env.GITHUB_OUTPUT, 'utf8')).toContain(`report_base_sha=${f.a}`);
});
test('foreign_publication_url_does_not_become_report_base', async () => {
    f.publish(f.a).payload.ci_run = 'https://evil.invalid/actions/runs/1';
    process.env.GITHUB_OUTPUT = join(f.dir, 'outputs');
    await reportRelease('publish', f.b, f.dir);
    expect(readFileSync(process.env.GITHUB_OUTPUT, 'utf8')).toContain('report_base_sha=\n');
});
test('failed_enrichment_writes_incomplete_summary_without_advertising_it', async () => {
    process.env.RELEASE_BEFORE_SHA = f.a;
    process.env.GITHUB_STEP_SUMMARY = join(f.dir, 'failed.md');
    process.env.GITHUB_OUTPUT = join(f.dir, 'outputs');
    f.extra = () => Response.json({ error: 'denied' }, { status: 403 });
    await reportRelease('deploy', f.b, f.dir);
    expect(readFileSync(process.env.GITHUB_STEP_SUMMARY, 'utf8')).toContain('Отчёт неполный');
    expect(readFileSync(process.env.GITHUB_OUTPUT, 'utf8')).toContain('report_url=\n');
});

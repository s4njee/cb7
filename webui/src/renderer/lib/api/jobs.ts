import { get } from './client';
import type { IngestFailureRecord, IngestProgress, IngestProgressEvent } from './types';

/** Mirror of the server `scan_jobs` row (see src/main/db/jobs.ts). */
export interface ScanJob {
  id: string;
  kind: string;
  status: 'queued' | 'active' | 'done' | 'failed';
  targetPath: string | null;
  folderId: number | null;
  discovered: number;
  processed: number;
  added: number;
  currentFile: string | null;
  error: string | null;
  /** Per-file ingest failures captured by the worker (empty while running). */
  failures: IngestFailureRecord[];
  createdAt: string;
  updatedAt: string;
}

/** Response from the enqueue routes (add-path, folder rescan). */
export interface EnqueueResponse {
  jobId: string | null;
  alreadyQueued?: boolean;
}

export const getJob = (id: string): Promise<ScanJob> =>
  get<ScanJob>(`/api/jobs/${encodeURIComponent(id)}`);

export const listActiveJobs = (): Promise<{ jobs: ScanJob[] }> =>
  get<{ jobs: ScanJob[] }>('/api/jobs');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a background scan/backfill job to completion, adapting its progress to the
 * legacy `onProgress(IngestProgressEvent)` callback so existing ingest panels work
 * unchanged. Resolves with the same `IngestProgress` shape the old NDJSON stream
 * returned. Transient poll errors are retried; the loop only ends on a terminal
 * job status.
 */
export async function pollIngestJob(
  jobId: string,
  onProgress?: (event: IngestProgressEvent) => void,
  pollMs = 600,
): Promise<IngestProgress> {
  for (;;) {
    let job: ScanJob;
    try {
      job = await getJob(jobId);
    } catch {
      await delay(pollMs);
      continue;
    }
    onProgress?.({
      type: 'progress',
      phase: job.status === 'queued' ? 'discover' : 'process',
      discovered: job.discovered,
      processed: job.processed,
      currentFile: job.currentFile ?? '',
    });
    if (job.status === 'done' || job.status === 'failed') {
      // The worker records per-file failures on the job. Older server builds
      // omit the field during the rollout, so default to an empty list.
      const failures = job.failures ?? [];
      const byClass: Record<string, number> = {};
      for (const failure of failures) {
        byClass[failure.errorClass] = (byClass[failure.errorClass] ?? 0) + 1;
      }
      return {
        added: job.added,
        errors: job.error ? [job.error] : [],
        failuresSummary: failures.length > 0
          ? {
              type: 'failures-summary',
              total: failures.length,
              byClass,
              sample: failures.slice(0, 5).map((failure) => ({
                path: failure.path,
                errorClass: failure.errorClass,
                message: failure.message,
              })),
            }
          : null,
      };
    }
    await delay(pollMs);
  }
}

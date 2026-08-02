import { get } from './client';
import type { IngestProgress, IngestProgressEvent } from './types';

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
      return {
        added: job.added,
        errors: job.error ? [job.error] : [],
        failuresSummary: null,
      };
    }
    await delay(pollMs);
  }
}

import { useQuery } from '@tanstack/react-query';
import { fetchJobsOverview } from '@/lib/api/jobs';

/**
 * Poll the admin jobs overview — in-flight scans, the worker's liveness
 * heartbeat, and live queue depth. The API only *enqueues* work; if the
 * worker process is down, scans are queued but never run, so the UI polls this
 * wherever an operator would wait for a scan or check server health.
 */
export function useWorkerStatus(refetchIntervalMs = 15_000) {
  return useQuery({
    queryKey: ['jobs-overview'],
    queryFn: fetchJobsOverview,
    refetchInterval: refetchIntervalMs,
  });
}

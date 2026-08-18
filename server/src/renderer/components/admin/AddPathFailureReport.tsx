import type * as api from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  failureReportDetails,
  ingestFailureLabel,
  pathBasename,
} from './addPathPanelHelpers';

/**
 * @module
 * Add-Path Scan Failure Report
 *
 * Architecture overview for Junior Devs:
 * After a library scan finishes with errors, this presentational component shows
 * the summary: how many items were added, how many failed, a breakdown by failure
 * reason, and a sample of the first failures. It is stateless — the report data is
 * passed in via props, and the actual number-crunching/wording lives in
 * `addPathPanelHelpers` (`failureReportDetails`, `ingestFailureLabel`,
 * `pathBasename`). It reports the user's choice back via `onClearLog` / `onClose`.
 */

/** The data needed to render a scan-failure report. */
export type AddPathFailureReportData = {
  added: number;
  failuresSummary: api.IngestFailuresSummaryEvent | null;
};

interface AddPathFailureReportProps {
  report: AddPathFailureReportData;
  onClearLog: () => void;
  onClose: () => void;
}

/**
 * Render the post-scan failure report.
 * Stateless. The by-reason breakdown and the samples list each render
 *          only when they have entries; the full failure list is recorded
 *          server-side in the `ingest_errors` table referenced in the summary text.
 * - **report:** The scan result (items added + failures summary).
 * - **onClearLog:** Called to clear the on-disk error log.
 * - **onClose:** Called to dismiss the report.
 * @returns The rendered failure report.
 */
export default function AddPathFailureReport({
  report,
  onClearLog,
  onClose,
}: AddPathFailureReportProps) {
  const summary = report.failuresSummary;
  const { byClass, samples } = failureReportDetails(summary);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold tracking-tight text-foreground text-left">Scan finished with errors</h2>
      <p className="text-sm text-muted-foreground">
        Added <strong>{report.added.toLocaleString()}</strong> item{report.added === 1 ? '' : 's'} ·{' '}
        <strong>{summary?.total.toLocaleString()}</strong> file{summary?.total === 1 ? '' : 's'} failed.
        The full list is recorded on the server.
      </p>

      {byClass.length > 0 && (
        <div className="bg-secondary/40 border border-border p-3 rounded-lg space-y-1.5 text-left">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">By reason</div>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {byClass.map(([key, value]) => (
              <li key={key}>
                <strong>{value.toLocaleString()}</strong> &middot; {ingestFailureLabel(key)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {samples.length > 0 && (
        <div className="bg-secondary/40 border border-border p-3 rounded-lg space-y-1.5 text-left">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            First {Math.min(summary?.sample.length || 0, 8)} failures
          </div>
          <ul className="text-xs font-mono space-y-2 max-h-48 overflow-y-auto pr-1">
            {samples.map((failure, index) => {
              const name = pathBasename(failure.path);
              return (
                <li
                  key={index}
                  className="border-b border-border/50 pb-1.5 last:border-0 last:pb-0"
                  title={failure.path}
                >
                  <span className="text-primary font-semibold break-words">{name}</span>
                  <div className="text-muted-foreground mt-0.5">
                    [{failure.errorClass}] {failure.message}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex gap-2 justify-between pt-2 border-t border-border">
        <Button variant="outline" className="border-border text-foreground hover:bg-muted" onClick={onClearLog}>
          Clear log
        </Button>
        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

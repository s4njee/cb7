import { spawn } from 'node:child_process';
import type { ServerResponse } from 'node:http';

/**
 * @module
 * Postgres backup via `pg_dump`.
 *
 * Streams a logical SQL backup straight to an HTTP response so the admin UI can
 * offer "Download backup" without staging a file on disk. Requires the
 * `pg_dump` client on the server's PATH (Docker images should install
 * `postgresql-client`). Restore is deliberately *not* a web operation: it
 * mutates the live database the API is connected to, so it stays a host-side
 * `psql -f backup.sql <DATABASE_URL>` while both processes are stopped.
 */

/** pg_dump flags: portable SQL, drop-then-recreate so a restore is idempotent. */
export function pgDumpArgs(connectionString: string): string[] {
  return ['--no-owner', '--clean', '--if-exists', connectionString];
}

/**
 * Stream a `pg_dump` backup to the response as an attachment download.
 * On failure (missing binary, dump error) it writes a JSON 500 when possible,
 * otherwise aborts the download.
 * @param res The raw HTTP response to stream into.
 * @param connectionString A Postgres connection URI (DATABASE_URL).
 */
export function streamPgDump(res: ServerResponse, connectionString: string): void {
  res.setHeader('Content-Type', 'application/sql');
  res.setHeader('Content-Disposition', `attachment; filename="cb8-backup-${new Date().toISOString().slice(0, 10)}.sql"`);

  const child = spawn('pg_dump', pgDumpArgs(connectionString), { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on('error', (err) => {
    // Spawn failed (pg_dump missing): nothing streamed yet, so a 500 is clean.
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: `pg_dump unavailable (${err.message}). Install postgresql-client on the server host.`,
      }));
    } else {
      res.destroy();
    }
  });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`pg_dump failed (exit ${code}): ${stderr}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `pg_dump failed: ${stderr.slice(0, 500)}` }));
      } else {
        res.destroy();
      }
    }
  });

  res.on('close', () => {
    if (!child.killed) {
      try { child.kill('SIGTERM'); } catch {}
    }
  });

  child.stdout.pipe(res);
}

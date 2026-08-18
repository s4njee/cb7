import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';
import * as api from '@/lib/api';
import { BackupSection } from './BackupSection';
import { CacheSection } from './SystemSettingsSections';
import { JobsAndErrorsSection } from './JobsAndErrorsSection';

/**
 * Server-side health and support tools grouped under one settings destination.
 *
 * The reader's About surface makes diagnostics easy to find without exposing
 * desktop-only paths or local-storage controls. On the web, the useful
 * equivalent is the running server, worker, cache and ingest state, plus a
 * small support bundle users can copy when reporting a problem.
 */
export function DiagnosticsSection() {
  const [copied, setCopied] = useState(false);

  const copyDiagnostics = async () => {
    const [version, session, cache] = await Promise.all([
      api.fetchServerVersion().catch(() => ({ version: 'unknown' })),
      api.getSession(),
      api.fetchCacheStats().catch(() => null),
    ]);
    const cacheBytes = cache
      ? cache.imageCache.sizeBytes + cache.upscaleCache.sizeBytes
      : 0;
    const text = [
      'CB8 diagnostics',
      `Version: ${version.version}`,
      `Origin: ${window.location.origin}`,
      `Account: ${session.user?.username ?? 'unknown'}`,
      `Role: ${session.user?.isAdmin ? 'admin' : 'user'}`,
      `Cached media: ${cacheBytes.toLocaleString()} bytes`,
      `User agent: ${navigator.userAgent}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be disabled in an embedded browser. The action
      // remains best-effort and the live diagnostics sections are still useful.
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-secondary/20 p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Support diagnostics</div>
            <p className="mt-1 text-[10px] leading-normal text-muted-foreground">
              Check server health and copy a compact environment summary when asking for help. It contains no password or session token.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => void copyDiagnostics()}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy diagnostics'}
          </Button>
        </div>
      </div>
      <JobsAndErrorsSection />
      <CacheSection />
      <BackupSection />
    </div>
  );
}

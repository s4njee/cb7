import React from 'react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import * as api from '@/lib/api';

/**
 * Download a full SQL backup. Restore stays a host-side operation.
 */
export function BackupSection() {
  return (
    <div className="bg-secondary/20 border border-border p-3.5 rounded-lg space-y-3">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Backup</div>
      <p className="text-[10px] text-muted-foreground leading-normal">
        Download a complete SQL dump of the catalog and settings. To restore, stop the API and worker, then run{' '}
        <code className="font-mono">psql -f backup.sql &quot;$DATABASE_URL&quot;</code> on the server host and start them again.
      </p>
      <div className="flex justify-end">
        <a href={api.backupUrl()}>
          <Button type="button" size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
            <Download className="h-4 w-4 mr-1" /> Download backup
          </Button>
        </a>
      </div>
    </div>
  );
}

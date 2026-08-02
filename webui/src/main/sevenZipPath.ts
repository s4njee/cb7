import { spawnSync } from 'node:child_process';

let cachedPath: string | null = null;
let verified = false;

export function getSevenZipPath(): string {
  if (cachedPath) return cachedPath;
  // Resolved from CB8_SEVENZIP_PATH or the system PATH ('7z'); the server's
  // Docker image installs 7-Zip as a system package.
  cachedPath = process.env.CB8_SEVENZIP_PATH?.trim() || '7z';
  return cachedPath;
}

export function assertSevenZipAvailable(): string {
  const bin = getSevenZipPath();
  if (verified) return bin;

  const result = spawnSync(bin, ['i'], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(
      `7-Zip binary is not available at "${bin}". Install 7-Zip or set CB8_SEVENZIP_PATH to a working 7z/7zz executable.`,
    );
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`7-Zip probe failed at "${bin}"${stderr ? `: ${stderr}` : ''}`);
  }

  verified = true;
  return bin;
}

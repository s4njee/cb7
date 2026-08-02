export function isSidebarPathActive(currentPath: string, targetPath: string): boolean {
  if (targetPath === '/') {
    return currentPath === '/' || currentPath === '';
  }
  return currentPath === targetPath;
}

export function formatFolderRescanMessage(added: number, folderName: string): string {
  if (added > 0) {
    return `Added ${added} item${added === 1 ? '' : 's'} to "${folderName}"`;
  }

  return `No new items found in "${folderName}"`;
}

export const ACCEPTED_EXTS = ['cbz', 'cbr', 'epub', 'pdf', 'mobi'];
export const ACCEPT_ATTR = ACCEPTED_EXTS.map((e) => `.${e}`).join(',');

export function isAccepted(file: File) {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTS.some((e) => name.endsWith(`.${e}`));
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface DroppedItem {
  file: File;
  relPath: string;
}

async function gatherFromDataTransferItem(
  item: FileSystemEntry,
  pathPrefix: string,
  out: DroppedItem[]
): Promise<void> {
  if (item.isFile) {
    const fileEntry = item as FileSystemFileEntry;
    await new Promise<void>((resolve) => {
      fileEntry.file(
        (file) => {
          if (isAccepted(file)) {
            out.push({ file, relPath: pathPrefix + file.name });
          }
          resolve();
        },
        () => resolve()
      );
    });
  } else if (item.isDirectory) {
    const dirEntry = item as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const readAll = (): Promise<void> =>
      new Promise<void>((resolve) => {
        reader.readEntries(
          async (entries) => {
            if (entries.length === 0) return resolve();
            for (const entry of entries) {
              await gatherFromDataTransferItem(entry, pathPrefix + item.name + '/', out);
            }
            resolve(readAll());
          },
          () => resolve()
        );
      });
    await readAll();
  }
}

export async function gatherFromDrop(dt: DataTransfer): Promise<DroppedItem[]> {
  const out: DroppedItem[] = [];
  if (dt.items && dt.items.length > 0 && typeof dt.items[0].webkitGetAsEntry === 'function') {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < dt.items.length; i++) {
      const entry = dt.items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    for (const entry of entries) {
      await gatherFromDataTransferItem(entry, '', out);
    }
  } else {
    for (let i = 0; i < dt.files.length; i++) {
      const file = dt.files[i];
      if (isAccepted(file)) out.push({ file, relPath: file.name });
    }
  }
  return out;
}

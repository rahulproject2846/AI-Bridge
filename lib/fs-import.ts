export type ImportedProject = {
  name: string;
  path: string;
  files: Array<{
    name: string;
    path: string;
    content: string;
  }>;
};

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
]);

export async function pickFolderAndRead(): Promise<ImportedProject | null> {
  // @ts-expect-error showDirectoryPicker not in TS lib in some setups
  if (!window.showDirectoryPicker) return null;
  // @ts-expect-error showDirectoryPicker not in TS lib in some setups
  const dirHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
    mode: "read",
  });
  const projectName = dirHandle.name;
  const files: ImportedProject["files"] = [];
  await readDirectoryRecursive(dirHandle, "", files);
  return {
    name: projectName,
    path: projectName,
    files,
  };
}

async function readDirectoryRecursive(
  dir: FileSystemDirectoryHandle,
  basePath: string,
  out: Array<{ name: string; path: string; content: string }>
) {
  // for-await to iterate directory entries
  // @ts-expect-error File System Access types may be missing in DOM lib
  for await (const [name, handle] of dir.entries()) {
    if (name === ".env" || name.startsWith(".env")) continue;
    const currentPath = basePath ? `${basePath}/${name}` : name;
    if (handle.kind === "directory") {
      if (IGNORED_DIRS.has(name)) continue;
      await readDirectoryRecursive(handle as FileSystemDirectoryHandle, currentPath, out);
    } else if (handle.kind === "file") {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const content = await file.text();
      out.push({
        name,
        path: currentPath,
        content,
      });
    }
  }
}

import Dexie, { Table } from "dexie";
import { sha256Hex } from "./hash";
export type Project = {
  id?: number;
  name: string;
  path: string;
  createdAt: string;
  shareId?: string;
  shareExpiresAt?: string | null;
  sharePassword?: string | null;
};

export type FileRow = {
  id?: number;
  projectId: number;
  name: string;
  path: string;
  content: string;
  lastSync: string;
  hash?: string;
};

class AIBridgeDB extends Dexie {
  projects!: Table<Project, number>;
  files!: Table<FileRow, number>;

  constructor() {
    super("AIBridgeDB");
    this.version(1).stores({
      projects: "++id, name, path, createdAt",
      files: "++id, projectId, name, path, content, lastSync",
    });
    this.version(2)
      .stores({
        projects: "++id, name, path, createdAt",
        files: "++id, projectId, name, path, content, lastSync, hash",
      })
      .upgrade(async (tx) => {
        const filesTable = tx.table<FileRow>("files");
        const rows = await filesTable.toArray();
        for (const row of rows) {
          if (!row.hash) {
            row.hash = await sha256Hex(row.content);
            await filesTable.put(row);
          }
        }
      });
    this.version(3).stores({
      projects: "++id, name, path, createdAt, shareId, shareExpiresAt, sharePassword",
      files: "++id, projectId, name, path, content, lastSync, hash",
    });
  }
}

export const db = new AIBridgeDB();

"use client";
import { Layout, Typography, Button, Empty, Menu, theme, Space, Input, Table, Tag, App, Tooltip, Select, Switch, Badge } from "antd";
import { FolderAddOutlined, DeleteOutlined, CloudSyncOutlined } from "@ant-design/icons";
import { db, type Project, type FileRow } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import { pickFolderAndRead } from "@/lib/fs-import";
import { useEffect, useMemo, useState, Suspense } from "react";
import { sha256Hex } from "@/lib/hash";
import { useRouter, useSearchParams } from "next/navigation";
import { useThemeMode } from "@/app/providers";
import { AnimatePresence, motion } from "framer-motion";
import { APP_VERSION } from "@/lib/env";

export default function Home() {
  const projects = useLiveQuery(async () => {
    return db.projects.toArray();
  }, [], [] as Project[]);
  const { Header, Sider, Content } = Layout;
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mode, setMode } = useThemeMode();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [serverContents, setServerContents] = useState<Map<string, string>>(new Map());
  const [syncing, setSyncing] = useState(false);
  const [syncLock, setSyncLock] = useState(false);
  const [projectStats, setProjectStats] = useState<
    Map<
      number,
      {
        totalFiles: number;
        lastSync: string | null;
        hasCloud: boolean;
      }
    >
  >(new Map());
  const [extFilter, setExtFilter] = useState<string[]>([]);
  const [expiryChoice, setExpiryChoice] = useState<"1h" | "1d" | "permanent">("permanent");
  const [privatePassword, setPrivatePassword] = useState<string>("");
  const [mongoOk, setMongoOk] = useState<boolean | null>(null);
  const [autoSync, setAutoSync] = useState<boolean>(false);

  const activeProjectId =
    selectedProjectId ?? (projects && projects.length > 0 ? projects[0].id ?? null : null);

  const files = useLiveQuery(async () => {
    if (!activeProjectId) return [] as FileRow[];
    return db.files.where({ projectId: activeProjectId }).toArray();
  }, [activeProjectId], [] as FileRow[]);

  // Initialize selected project from URL (?project=id)
  useEffect(() => {
    const p = searchParams.get("project");
    if (p) {
      const idNum = Number(p);
      if (!Number.isNaN(idNum)) setSelectedProjectId(idNum);
    }
  }, [searchParams]);

  // Compute per-project stats and cloud status (best-effort)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (alive) setMongoOk(res.ok);
      } catch {
        if (alive) setMongoOk(false);
      }
      if (!projects) return;
      const newStats = new Map<number, { totalFiles: number; lastSync: string | null; hasCloud: boolean }>();
      for (const p of projects) {
        if (!p.id) continue;
        const projectFiles = await db.files.where({ projectId: p.id }).toArray();
        const totalFiles = projectFiles.length;
        const lastSync = projectFiles
          .map((f) => f.lastSync)
          .filter(Boolean)
          .sort()
          .pop() || null;
        let hasCloud = false;
        if (p.shareId) {
          try {
            const res = await fetch(`/api/share?shareId=${encodeURIComponent(p.shareId)}`);
            if (res.ok) {
              const data: { files: { path: string }[] } = await res.json();
              hasCloud = (data.files?.length || 0) > 0;
            }
          } catch {
            hasCloud = false;
          }
        }
        newStats.set(p.id, { totalFiles, lastSync, hasCloud });
      }
      if (alive) setProjectStats(newStats);
    })();
    return () => {
      alive = false;
    };
  }, [projects]);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("autoSync") : null;
    if (saved === "true") setAutoSync(true);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("autoSync", String(autoSync));
  }, [autoSync]);
  // auto-sync effect moved below after activeProject is defined

  const filteredFiles = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    let arr = files ?? [];
    if (extFilter.length) {
      arr = arr.filter((f) => {
        const idx = f.name.lastIndexOf(".");
        const ext = idx >= 0 ? f.name.slice(idx) : "";
        return extFilter.includes(ext);
      });
    }
    if (!q) return arr;
    return arr.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, searchText, extFilter]);
  const activeProject =
    (projects || []).find((p) => p.id === activeProjectId) ?? (projects && projects[0]) ?? null;

  const sanitizeContent = (text: string) => {
    const lf = text.replace(/\r\n?/g, "\n");
    return lf
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n");
  };

  useEffect(() => {
    if (!autoSync) return;
    const id = setInterval(async () => {
      if (syncLock) return; // Prevent auto-sync during manual sync
      if (!activeProjectId || !activeProject) return;
      if (selectedRowKeys.length === 0) return;
      
      setSyncLock(true);
      try {
        const shareId =
        activeProject.shareId ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? (crypto as Crypto).randomUUID()
          : `share_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
      if (!activeProject.shareId) {
        await db.projects.update(activeProjectId, { shareId });
      }
      try {
        const statusRes = await fetch(`/api/share?shareId=${encodeURIComponent(shareId)}`);
        if (statusRes.ok) {
          const data: { files: { path: string; content: string }[] } = await statusRes.json();
          setServerContents(new Map((data.files || []).map((f) => [f.path, f.content])));
        }
      } catch {}
      const ids = (selectedRowKeys as React.Key[]).map((k) => Number(k));
      const dbFiles = await db.files.where("id").anyOf(ids as number[]).toArray();
      const payloadFiles = dbFiles
        .filter((f) => serverContents.get(f.path) !== f.content)
        .map((f) => ({ path: f.path, content: sanitizeContent(f.content) }))
        .filter((f) => f.content.length > 0);
      if (payloadFiles.length) {
        try {
          setSyncing(true);
          const res = await fetch("/api/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shareId,
              projectName: activeProject.name,
              files: payloadFiles,
            }),
          });
          if (res.ok) {
            const statusRes = await fetch(`/api/share?shareId=${encodeURIComponent(shareId)}`);
            if (statusRes.ok) {
              const data: { files: { path: string; content: string }[] } = await statusRes.json();
              setServerContents(new Map((data.files || []).map((f) => [f.path, f.content])));
            }
          }
        } finally {
          setSyncing(false);
        }
      }
    } catch {
      // ignore
    } finally {
      setSyncLock(false);
    }
    }, 30000);
    return () => clearInterval(id);
  }, [autoSync, activeProjectId, activeProject, selectedRowKeys, serverContents]);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (activeProject?.shareId) {
        try {
          const res = await fetch(`/api/share?shareId=${encodeURIComponent(activeProject.shareId)}`);
          if (res.ok) {
            const data: { files: { path: string; content: string }[] } = await res.json();
            const map = new Map((data.files || []).map((f) => [f.path, f.content]));
            if (alive) setServerContents(map);
          } else {
            if (alive) setServerContents(new Map());
          }
        } catch {
          if (alive) setServerContents(new Map());
        }
      } else {
        setServerContents(new Map());
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeProject?.shareId]);

  const onAddFolder = async () => {
    try {
      const imported = await pickFolderAndRead();
      if (!imported) return;

      const createdAt = new Date().toISOString();
      const projectId = await db.projects.add({
        name: imported.name,
        path: imported.path,
        createdAt,
      });

      const files: FileRow[] = await Promise.all(
        imported.files.map(async (f) => ({
          projectId,
          name: f.name,
          path: f.path,
          content: f.content,
          lastSync: "",
          hash: await sha256Hex(f.content),
        }))
      );
      if (files.length) {
        // Bulk put for performance
        await db.files.bulkAdd(files);
      }
      message.success("Folder imported");
    } catch (e) {
      console.error(e);
      message.error("Failed to import folder");
    }
  };

  const onSyncSelected = async () => {
    if (syncLock) return; // Prevent double-clicks
    if (!activeProjectId || !activeProject) return;
    if (selectedRowKeys.length === 0) return;
    
    setSyncLock(true);
    try {
      const ids = (selectedRowKeys as React.Key[]).map((k) => Number(k));
      const shareId =
        activeProject.shareId ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? (crypto as Crypto).randomUUID()
          : `share_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
      if (!activeProject.shareId) {
        await db.projects.update(activeProjectId, { shareId });
      }
      // Ensure latest server snapshot before diffing
      try {
        const statusRes = await fetch(`/api/share?shareId=${encodeURIComponent(shareId)}`);
        if (statusRes.ok) {
          const data: { files: { path: string; content: string }[] } = await statusRes.json();
          setServerContents(new Map((data.files || []).map((f) => [f.path, f.content])));
        }
      } catch {
        // ignore
      }
      const dbFiles = await db.files.where("id").anyOf(ids as number[]).toArray();
      const toUpload = dbFiles.filter((f) => serverContents.get(f.path) !== f.content);
      const unchanged = dbFiles.filter((f) => serverContents.get(f.path) === f.content);
      const payloadFiles = toUpload
        .map((f) => ({ path: f.path, content: sanitizeContent(f.content) }))
        .filter((f) => f.content.length > 0);
      const link = `${window.location.origin}/share/${shareId}`;
      const key = "sync";
      message.loading({ content: "Syncing...", key, duration: 0 });
      setSyncing(true);
      const expiresAt =
        expiryChoice === "permanent"
          ? undefined
          : new Date(Date.now() + (expiryChoice === "1h" ? 3600e3 : 86400e3)).toISOString();
      if (payloadFiles.length || privatePassword || expiresAt) {
          // Size-based batching to avoid Vercel 4.5MB limit
          const TARGET_SIZE = 3.5 * 1024 * 1024; // 3.5MB target per batch
          const batches: typeof payloadFiles[] = [];
          let currentBatch: typeof payloadFiles = [];
          let currentSize = 0;
          
          for (const file of payloadFiles) {
            const fileSize = new TextEncoder().encode(JSON.stringify({
              shareId,
              projectName: activeProject.name,
              files: [file],
              expiresAt,
              password: privatePassword || undefined,
            })).length;
            
            if (currentSize + fileSize > TARGET_SIZE && currentBatch.length > 0) {
              batches.push(currentBatch);
              currentBatch = [file];
              currentSize = fileSize;
            } else {
              currentBatch.push(file);
              currentSize += fileSize;
            }
          }
          
          if (currentBatch.length > 0) {
            batches.push(currentBatch);
          }
          
          for (const batch of batches) {
            const res = await fetch("/api/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                shareId,
                projectName: activeProject.name,
                files: batch,
                expiresAt,
                password: privatePassword || undefined,
              }),
            });
            if (!res.ok) throw new Error(`Batch sync failed: ${res.statusText}`);
            // Small delay between batches to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      const now = new Date().toISOString();
      const unchangedIds = unchanged.map((f) => f.id as number);
      const uploadedIds = toUpload.map((f) => f.id as number);
      await db.transaction('rw', db.files, async () => {
        if (unchangedIds.length) {
          await db.files.where("id").anyOf(unchangedIds).modify({ lastSync: now });
        }
        if (uploadedIds.length) {
          await db.files.where("id").anyOf(uploadedIds).modify({ lastSync: now });
        }
      });
      try {
        const statusRes = await fetch(`/api/share?shareId=${encodeURIComponent(shareId)}`);
        if (statusRes.ok) {
          const data: { files: { path: string; content: string }[] } = await statusRes.json();
          setServerContents(new Map((data.files || []).map((f) => [f.path, f.content])));
        }
      } catch {
        // ignore
      }
      setSelectedRowKeys([]);
      message.success({
        key,
        duration: 3,
        content: (
          <Space>
            Synced. Share link ready.
            <Button
              size="small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  message.success("Link copied");
                } catch {
                  message.error("Copy failed");
                }
              }}
            >
              Copy Link
            </Button>
          </Space>
        ),
      });
    } catch {
      message.error({ key: "sync", content: "Sync failed" });
    } finally {
      setSyncing(false);
      setSyncLock(false);
    }
  };

  return (
    <Suspense fallback={null}>
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        width={260}
        style={{
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div
          style={{
            padding: 16,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Typography.Title level={5} style={{ margin: 0 }}>
            Projects
          </Typography.Title>
        </div>
        <Menu
          mode="inline"
          items={(projects || []).map((p) => {
            const stats = p.id ? projectStats.get(p.id) : undefined;
            return {
              key: String(p.id),
              label: (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>{p.name}</span>
                    {stats?.hasCloud ? (
                      <CloudSyncOutlined style={{ color: token.colorSuccess }} />
                    ) : (
                      <CloudSyncOutlined style={{ color: token.colorTextQuaternary }} />
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                    {stats ? `${stats.totalFiles} files` : "…"} {stats?.lastSync ? `• Last sync ${new Date(stats.lastSync).toLocaleString()}` : ""}
                  </div>
                </div>
              ),
            };
          })}
          selectedKeys={activeProjectId ? [String(activeProjectId)] : []}
          onSelect={({ key }) => {
            setSelectedProjectId(Number(key));
            setSelectedRowKeys([]);
            const sp = new URLSearchParams(Array.from(searchParams.entries()));
            sp.set("project", String(key));
            router.replace(`/?${sp.toString()}`);
          }}
          style={{ borderInlineEnd: "none" }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingInline: 16,
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Space size={8}>
            <Typography.Title
              level={4}
              style={{ margin: 0, letterSpacing: 0.3 }}
            >
              AI-Bridge
            </Typography.Title>
          </Space>
          <Space>
            <Space>
              <span>Theme</span>
              <Switch checked={mode === "dark"} onChange={(c) => setMode(c ? "dark" : "light")} />
            </Space>
            {autoSync && <Badge status="processing" text="Syncing in background..." />}
            <Button
              onClick={async () => {
                const keyPurge = "purge";
                message.loading({ key: keyPurge, content: "Purging expired shares...", duration: 0 });
                try {
                  const res = await fetch("/api/cron/purge-expired", { method: "POST" });
                  if (!res.ok) throw new Error("Failed");
                  const data: { ok: boolean; deleted?: number } = await res.json();
                  message.success({ key: keyPurge, content: `Purged ${data.deleted ?? 0} expired shares` });
                } catch {
                  message.error({ key: keyPurge, content: "Purge failed" });
                }
              }}
            >
              Purge Expired
            </Button>
            <Button type="primary" icon={<FolderAddOutlined />} onClick={onAddFolder}>
              Add New Folder
            </Button>
          </Space>
        </Header>
        <Content
          style={{
            padding: 24,
            background: token.colorBgLayout,
            height: "100%",
          }}
        >
          {(projects?.length ?? 0) === 0 ? (
            <div
              style={{
                height: "calc(100vh - 64px - 24px*2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: token.colorBgContainer,
                borderRadius: token.borderRadiusLG,
                border: `1px dashed ${token.colorBorderSecondary}`,
              }}
            >
              <Empty description="No projects yet" />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeProjectId ?? "none"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                style={{
                  background: token.colorBgContainer,
                  borderRadius: token.borderRadiusLG,
                  padding: 16,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
              <Space
                style={{
                  width: "100%",
                  marginBottom: 12,
                  justifyContent: "space-between",
                  display: "flex",
                }}
              >
                <Space>
                  <Space>
                    <span>Auto Sync</span>
                    <Switch checked={autoSync} onChange={setAutoSync} />
                  </Space>
                  <Button
                    type="default"
                    icon={<CloudSyncOutlined />}
                    onClick={async () => {
                      if (syncLock || syncing) return;
                      if (!activeProjectId || !activeProject) return;
                      setSyncLock(true);
                      const shareId =
                        activeProject.shareId ??
                        (typeof crypto !== "undefined" && "randomUUID" in crypto
                          ? (crypto as Crypto).randomUUID()
                          : `share_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
                      if (!activeProject.shareId) {
                        await db.projects.update(activeProjectId, { shareId });
                      }
                      // Ensure latest server snapshot
                      try {
                        const statusRes = await fetch(
                          `/api/share?shareId=${encodeURIComponent(shareId)}`
                        );
                        if (statusRes.ok) {
                          const data: { files: { path: string; content: string }[] } =
                            await statusRes.json();
                          setServerContents(
                            new Map((data.files || []).map((f) => [f.path, f.content]))
                          );
                        } else {
                          setServerContents(new Map());
                        }
                      } catch {
                        setServerContents(new Map());
                      }
                      const allFiles = await db.files.where({ projectId: activeProjectId }).toArray();
                      const payloadFiles = allFiles
                        .filter((f) => serverContents.get(f.path) !== f.content)
                        .map((f) => ({ path: f.path, content: sanitizeContent(f.content) }))
                        .filter((f) => f.content.length > 0);
                      const keyAll = "sync-all";
                      message.loading({ content: "Syncing all files...", key: keyAll, duration: 0 });
                      try {
                        setSyncing(true);
                        const expiresAt =
                          expiryChoice === "permanent"
                            ? undefined
                            : new Date(Date.now() + (expiryChoice === "1h" ? 3600e3 : 86400e3)).toISOString();
                        if (payloadFiles.length || privatePassword || expiresAt) {
                          const res = await fetch("/api/sync", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              shareId,
                              projectName: activeProject.name,
                              files: payloadFiles,
                              expiresAt,
                              password: privatePassword || undefined,
                            }),
                          });
                          if (!res.ok) throw new Error("Sync failed");
                        }
                        const statusRes = await fetch(
                          `/api/share?shareId=${encodeURIComponent(shareId)}`
                        );
                        if (statusRes.ok) {
                          const data: { files: { path: string; content: string }[] } =
                            await statusRes.json();
                          setServerContents(
                            new Map((data.files || []).map((f) => [f.path, f.content]))
                          );
                        }
                        message.success({ key: keyAll, content: "All files synced" });
                      } catch {
                        message.error({ key: keyAll, content: "Sync failed" });
                      } finally {
                        setSyncing(false);
                        setSyncLock(false);
                      }
                    }}
                  >
                    Sync Entire Folder
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!activeProject) return;
                      const newName = window.prompt("New project name:", activeProject.name);
                      if (!newName || !newName.trim()) return;
                      await db.projects.update(activeProject.id as number, { name: newName.trim() });
                      if (activeProject.shareId) {
                        try {
                          await fetch("/api/sync/project", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ shareId: activeProject.shareId, projectName: newName.trim() }),
                          });
                        } catch {
                          // ignore server rename failure
                        }
                      }
                      message.success("Project renamed");
                    }}
                  >
                    Rename Project
                  </Button>
                  <Button
                    danger
                    onClick={async () => {
                      if (!activeProject) return;
                      const confirm = window.confirm("Delete this project locally and on server?");
                      if (!confirm) return;
                      if (activeProject.shareId) {
                        try {
                          await fetch("/api/sync/project", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ shareId: activeProject.shareId }),
                          });
                        } catch {
                          // ignore server delete failure
                        }
                      }
                      const pid = activeProject.id as number;
                      await db.files.where({ projectId: pid }).delete();
                      await db.projects.delete(pid);
                      setSelectedRowKeys([]);
                      message.success("Project deleted");
                    }}
                  >
                    Delete Project
                  </Button>
                  <Button
                    type="primary"
                    onClick={onSyncSelected}
                    disabled={selectedRowKeys.length === 0 || !activeProject}
                    loading={syncing}
                  >
                    Sync Selected
                  </Button>
                </Space>
                <Space>
                  <Select
                    value={expiryChoice}
                    onChange={(v) => setExpiryChoice(v)}
                    options={[
                      { label: "Expires in 1 hour", value: "1h" },
                      { label: "Expires in 1 day", value: "1d" },
                      { label: "Permanent", value: "permanent" },
                    ]}
                    style={{ width: 180 }}
                  />
                  <Input.Password
                    placeholder="Private link password (optional)"
                    value={privatePassword}
                    onChange={(e) => setPrivatePassword(e.target.value)}
                    style={{ width: 240 }}
                  />
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="Filter by extension"
                    style={{ minWidth: 220 }}
                    value={extFilter}
                    onChange={(vals) => setExtFilter(vals)}
                    options={Array.from(
                      new Set((files || []).map((f) => {
                        const i = f.name.lastIndexOf(".");
                        return i >= 0 ? f.name.slice(i) : "";
                      }).filter(Boolean))
                    ).sort().map((ext) => ({ label: ext, value: ext }))}
                  />
                  <Input
                    placeholder="Search files"
                    allowClear
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    style={{ width: 320 }}
                  />
                </Space>
              </Space>
              <div style={{ marginBottom: 12 }}>
                <Button
                  type="primary"
                  size="large"
                  style={{ width: "100%" }}
                  onClick={async () => {
                    if (!activeProject) {
                      message.info("No active project");
                      return;
                    }
                    try {
                      const projectFiles = await db.files.where({ projectId: activeProject.id as number }).toArray();
                      const filtered = projectFiles.filter((f) => !/\.(png|svg|ico)$/i.test(f.path));
                      const sorted = [...filtered].sort((a, b) => a.path.localeCompare(b.path));
                      type Node = { name: string; children: Map<string, Node>; isFile?: boolean };
                      const root: Node = { name: "", children: new Map() };
                      for (const f of sorted) {
                        const parts = f.path.split("/").filter(Boolean);
                        let cur = root;
                        for (let i = 0; i < parts.length; i++) {
                          const part = parts[i]!;
                          if (!cur.children.has(part)) cur.children.set(part, { name: part, children: new Map() });
                          const child = cur.children.get(part)!;
                          if (i === parts.length - 1) child.isFile = true;
                          cur = child;
                        }
                      }
                      const lines: string[] = [];
                      const walk = (node: Node, prefix: string) => {
                        const entries = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
                        entries.forEach((child, idx) => {
                          const isLast = idx === entries.length - 1;
                          const connector = isLast ? "└── " : "├── ";
                          lines.push(prefix + connector + child.name + (child.isFile ? "" : "/"));
                          if (child.children.size > 0) {
                            const nextPrefix = prefix + (isLast ? "    " : "│   ");
                            walk(child, nextPrefix);
                          }
                        });
                      };
                      walk(root, "");
                      const treeText = lines.join("\n");
                      const parts: string[] = [];
                      parts.push(`# Project: ${activeProject.name}`);
                      parts.push("");
                      parts.push("## File Structure");
                      parts.push("");
                      parts.push(treeText || "(no files)");
                      parts.push("");
                      const extToFence = (path: string) => {
                        const lower = path.toLowerCase();
                        const map: Record<string, string> = {
                          ".ts": "typescript",
                          ".tsx": "tsx",
                          ".js": "javascript",
                          ".jsx": "jsx",
                          ".json": "json",
                          ".css": "css",
                          ".scss": "scss",
                          ".md": "markdown",
                          ".py": "python",
                          ".go": "go",
                          ".rs": "rust",
                          ".java": "java",
                          ".kt": "kotlin",
                          ".swift": "swift",
                          ".rb": "ruby",
                          ".php": "php",
                          ".sh": "bash",
                          ".yml": "yaml",
                          ".yaml": "yaml",
                          ".toml": "toml",
                          ".xml": "xml",
                          ".sql": "sql",
                          ".c": "c",
                          ".cpp": "cpp",
                          ".h": "c",
                          ".hpp": "cpp",
                        };
                        const idx = lower.lastIndexOf(".");
                        return idx >= 0 ? map[lower.slice(idx)] || "" : "";
                      };
                      for (const f of sorted) {
                        parts.push("code");
                        parts.push("Code");
                        parts.push(`### File: ${f.path}`);
                        parts.push("```" + extToFence(f.path));
                        parts.push(f.content);
                        parts.push("```");
                        parts.push("");
                      }
                      const text = parts.join("\n");
                      await navigator.clipboard.writeText(text);
                      message.success("Context copied to clipboard");
                    } catch {
                      message.error("Copy failed");
                    }
                  }}
                >
                  Copy Context to Clipboard
                </Button>
              </div>
              <Table<FileRow>
                rowKey="id"
                size="middle"
                dataSource={filteredFiles}
                columns={[
                  {
                    title: "File Name",
                    dataIndex: "name",
                    key: "name",
                    render: (_, row) => {
                      const q = searchText.trim();
                      const name = row.name;
                      let node: React.ReactNode = name;
                      if (q) {
                        const idx = name.toLowerCase().indexOf(q.toLowerCase());
                        if (idx >= 0) {
                          const before = name.slice(0, idx);
                          const match = name.slice(idx, idx + q.length);
                          const after = name.slice(idx + q.length);
                          node = (
                            <>
                              {before}
                              <mark>{match}</mark>
                              {after}
                            </>
                          );
                        }
                      }
                      const preview = (row.content || "").split("\n").slice(0, 5).join("\n");
                      return (
                        <Tooltip
                          title={
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap", maxWidth: 500 }}>
                              {preview}
                            </pre>
                          }
                        >
                          <span style={{ fontFamily: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" }}>{node}</span>
                        </Tooltip>
                      );
                    },
                    sorter: (a, b) => a.name.localeCompare(b.name),
                  },
                  { title: "Path", dataIndex: "path", key: "path", sorter: (a, b) => a.path.localeCompare(b.path), render: (text: string) => <span style={{ fontFamily: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" }}>{text}</span> },
                  {
                    title: "Size",
                    key: "size",
                    render: (_, row) => (row.content ? row.content.length : 0),
                    sorter: (a, b) => (a.content.length - b.content.length),
                  },
                  {
                    title: "Status",
                    key: "status",
                    render: (_, row) => {
                      const server = serverContents.get(row.path);
                      if (!server) return <Tag color="default">Local Only</Tag>;
                      if (server === row.content) return <Tag color="green">Synced</Tag>;
                      return <Tag color="orange">Modified</Tag>;
                    },
                    sorter: (a, b) => {
                      const statusRank = (row: FileRow) => {
                        const server = serverContents.get(row.path);
                        if (!server) return 0;
                        if (server === row.content) return 2;
                        return 1;
                      };
                      return statusRank(a) - statusRank(b);
                    },
                  },
                  {
                    title: "Action",
                    key: "action",
                    render: (_, row) => {
                      const server = serverContents.get(row.path);
                      if (server && server === row.content && activeProject?.shareId) {
                        return (
                          <Tooltip title="Delete from server">
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={async () => {
                                const keyDel = `del-${row.id}`;
                                message.loading({ content: "Deleting...", key: keyDel, duration: 0 });
                                try {
                                  const sid = activeProject.shareId as string;
                                  const res = await fetch("/api/sync/delete", {
                                    method: "DELETE",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      shareId: sid,
                                      filePath: row.path,
                                    }),
                                  });
                                  if (!res.ok) throw new Error("Delete failed");
                                  const statusRes = await fetch(
                                    `/api/share?shareId=${encodeURIComponent(sid)}`
                                  );
                                  if (statusRes.ok) {
                                    const data: { files: { path: string; content: string }[] } =
                                      await statusRes.json();
                                    setServerContents(
                                      new Map((data.files || []).map((f) => [f.path, f.content]))
                                    );
                                  }
                                  message.success({ key: keyDel, content: "Deleted from server" });
                                } catch {
                                  message.error({ key: keyDel, content: "Delete failed" });
                                }
                              }}
                            />
                          </Tooltip>
                        );
                      }
                      return null;
                    },
                  },
                ]}
                rowSelection={{
                  selectedRowKeys,
                  onChange: setSelectedRowKeys,
                }}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                locale={{ emptyText: <Empty description="No files" /> }}
              />
              </motion.div>
              <Space style={{ marginTop: 12 }}>
                <Button
                  danger
                  disabled={selectedRowKeys.length === 0 || !activeProject?.shareId}
                  onClick={async () => {
                    if (!activeProject?.shareId) return;
                    const ids = (selectedRowKeys as React.Key[]).map((k) => Number(k));
                    const dbFiles = await db.files.where("id").anyOf(ids as number[]).toArray();
                    const paths = dbFiles.map((f) => f.path);
                    const keyDel = "bulk-del";
                    message.loading({ key: keyDel, content: "Deleting selected from server...", duration: 0 });
                    try {
                      const res = await fetch("/api/sync/bulk-delete", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ shareId: activeProject.shareId, filePaths: paths }),
                      });
                      if (!res.ok) throw new Error("Failed");
                      const statusRes = await fetch(`/api/share?shareId=${encodeURIComponent(activeProject.shareId)}`);
                      if (statusRes.ok) {
                        const data: { files: { path: string; content: string }[] } = await statusRes.json();
                        setServerContents(new Map((data.files || []).map((f) => [f.path, f.content])));
                      }
                      message.success({ key: keyDel, content: "Deleted selected files" });
                    } catch {
                      message.error({ key: keyDel, content: "Bulk delete failed" });
                    }
                  }}
                >
                  Bulk Delete (Server)
                </Button>
                <Button
                  onClick={async () => {
                    const JSZip = (await import("jszip")).default;
                    const zip = new JSZip();
                    const ids = (selectedRowKeys as React.Key[]).map((k) => Number(k));
                    const dbFiles = await db.files.where("id").anyOf(ids as number[]).toArray();
                    for (const f of dbFiles) {
                      zip.file(f.path, f.content);
                    }
                    const blob = await zip.generateAsync({ type: "blob" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `${activeProject?.name || "files"}.zip`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  }}
                  disabled={selectedRowKeys.length === 0}
                >
                  Bulk Download ZIP
                </Button>
                <Button
                  onClick={async () => {
                    if (!activeProject?.shareId) {
                      message.info("No share exists for this project");
                      return;
                    }
                    const keyReset = "reset";
                    message.loading({ key: keyReset, content: "Resetting server files...", duration: 0 });
                    try {
                      const res = await fetch("/api/sync/reset", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ shareId: activeProject.shareId }),
                      });
                      if (!res.ok) throw new Error("Reset failed");
                      const statusRes = await fetch(`/api/share?shareId=${encodeURIComponent(activeProject.shareId)}`);
                      if (statusRes.ok) {
                        const data: { files: { path: string; content: string }[] } = await statusRes.json();
                        setServerContents(new Map((data.files || []).map((f) => [f.path, f.content])));
                      } else {
                        setServerContents(new Map());
                      }
                      message.success({ key: keyReset, content: "Server files cleared" });
                    } catch {
                      message.error({ key: keyReset, content: "Reset failed" });
                    }
                  }}
                >
                  Reset Project (Server)
                </Button>
              </Space>
            </AnimatePresence>
          )}
        </Content>
        <footer
          style={{
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingInline: 16,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            fontSize: 12,
          }}
        >
          <span>
            Status: <strong>{mongoOk === null ? "Checking MongoDB..." : mongoOk ? "Connected to MongoDB" : "MongoDB Unavailable"}</strong>
          </span>
          <span>
            Dexie Storage: {(files?.reduce((acc, f) => acc + (f.content?.length || 0), 0) || 0).toLocaleString()} bytes
          </span>
          <span>Version {APP_VERSION}</span>
        </footer>
      </Layout>
    </Layout>
    </Suspense>
  );
}

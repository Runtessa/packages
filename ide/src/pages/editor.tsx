import "../lib/monaco";
import { useCallback, useEffect, useMemo, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import FileExplorer, { ExplorerNode } from "../components/FileExplorer";
import { useSessionToken } from "../lib/client/session";

type EditorLanguage =
  | "javascript"
  | "jsx"
  | "css"
  | "html"
  | "typescript"
  | "json"
  | "markdown"
  | "plaintext";

type ActiveFile = {
  id: string;
  name: string;
  language: EditorLanguage;
  meta: NodeMeta | null;
};

type NodeMeta =
  | {
      kind: "module";
      backendId: string;
      method: string;
      routePath: string;
    }
  | {
      kind: "ui";
      backendId: string;
      name: string;
      version: string;
      dependencies: string[];
    };

type ModuleDto = {
  id: string;
  routePath: string;
  method: string;
  code: string;
};

type UIPackageDto = {
  id: string;
  name: string;
  version: string;
  codeBlob: string;
  dependencies: string[];
};

const LANGUAGE_OPTIONS: { value: EditorLanguage; label: string }[] = [
  { value: "javascript", label: "JavaScript" },
  { value: "jsx", label: "JSX" },
  { value: "css", label: "CSS" },
  { value: "html", label: "HTML" },
  { value: "typescript", label: "TypeScript" },
  { value: "json", label: "JSON" },
  { value: "markdown", label: "Markdown" },
  { value: "plaintext", label: "Plain Text" },
];

const CONTENT_STORAGE_KEY = "editor-file-contents";

const detectLanguage = (fileName: string): EditorLanguage => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".js")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return "plaintext";
};

const formatModuleLabel = (mod: ModuleDto) =>
  `[${mod.method}] ${mod.routePath}`;

const formatUiLabel = (pkg: UIPackageDto) => `${pkg.name}@${pkg.version}`;

export default function EditorPage() {
  const { token } = useSessionToken();
  const [fileContents, setFileContents] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    const stored = localStorage.getItem(CONTENT_STORAGE_KEY);
    if (!stored) return {};
    try {
      return JSON.parse(stored) as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [activeFile, setActiveFile] = useState<ActiveFile | null>(null);
  const [openFiles, setOpenFiles] = useState<ActiveFile[]>([]);
  const [treeData, setTreeData] = useState<ExplorerNode | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [saveError, setSaveError] = useState<string>("");

  const apiFetch = useCallback(
    async (
      url: string,
      options: { method?: string; body?: unknown } = {}
    ) => {
      const res = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Session ${token}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }
      return data;
    },
    [token]
  );

  const buildTree = useCallback(
    (modules: ModuleDto[], uiPackages: UIPackageDto[]): ExplorerNode => ({
      id: "root",
      name: "PROJECT",
      type: "folder",
      children: [
        {
          id: "modules-root",
          name: "Modules",
          type: "folder",
          children: modules.map((mod) => ({
            id: `module-${mod.id}`,
            name: formatModuleLabel(mod),
            type: "file",
            meta: {
              kind: "module",
              backendId: mod.id,
              method: mod.method,
              routePath: mod.routePath,
            },
            content: mod.code,
          })),
        },
        {
          id: "ui-root",
          name: "UI Entities",
          type: "folder",
          children: uiPackages.map((pkg) => ({
            id: `ui-${pkg.id}`,
            name: formatUiLabel(pkg),
            type: "file",
            meta: {
              kind: "ui",
              backendId: pkg.id,
              name: pkg.name,
              version: pkg.version,
              dependencies: pkg.dependencies ?? [],
            },
            content: pkg.codeBlob,
          })),
        },
      ],
    }),
    []
  );

  const loadTree = useCallback(async () => {
    setLoadingTree(true);
    setTreeError("");
    try {
      const [modules, uiPackages] = await Promise.all([
        apiFetch("/api/modules"),
        apiFetch("/api/ui-entities"),
      ]);
      setTreeData(buildTree(modules as ModuleDto[], uiPackages as UIPackageDto[]));
    } catch (err) {
      setTreeError((err as Error).message || "Failed to load explorer");
    } finally {
      setLoadingTree(false);
    }
  }, [apiFetch, buildTree]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(CONTENT_STORAGE_KEY, JSON.stringify(fileContents));
  }, [fileContents]);

  const handleOpenFile = (file: ExplorerNode) => {
    if (file.type !== "file") return;
    const language = detectLanguage(file.name);
    const meta = (file.meta as NodeMeta | undefined) ?? null;
    const initialContent =
      fileContents[file.id] !== undefined
        ? fileContents[file.id]
        : file.content ?? "";

    setFileContents((prev) => {
      if (prev[file.id] !== undefined) return prev;
      return { ...prev, [file.id]: initialContent };
    });

    setOpenFiles((prev) => {
      const existing = prev.find((f) => f.id === file.id);
      if (existing) {
        return prev.map((f) =>
          f.id === file.id ? { ...f, name: file.name, language, meta } : f
        );
      }
      return [...prev, { id: file.id, name: file.name, language, meta }];
    });

    setActiveFile({ id: file.id, name: file.name, language, meta });
  };

  const handleEditorChange = (value?: string) => {
    if (!activeFile) return;
    setFileContents((prev) => ({
      ...prev,
      [activeFile.id]: value ?? "",
    }));
  };

  const handleLanguageChange = (language: EditorLanguage) => {
    if (!activeFile) return;
    setActiveFile({ ...activeFile, language });
    setOpenFiles((prev) =>
      prev.map((f) => (f.id === activeFile.id ? { ...f, language } : f))
    );
  };

  const handleSave = async () => {
    if (!activeFile || !activeFile.meta) return;
    const content = fileContents[activeFile.id] ?? "";
    setSaving(true);
    setSaveStatus("");
    setSaveError("");
    try {
      if (activeFile.meta.kind === "module") {
        await apiFetch(`/api/modules/${activeFile.meta.backendId}`, {
          method: "PUT",
          body: {
            routePath: activeFile.meta.routePath,
            method: activeFile.meta.method,
            code: content,
          },
        });
      } else {
        await apiFetch(`/api/ui-entities/${activeFile.meta.backendId}`, {
          method: "PUT",
          body: {
            name: activeFile.meta.name,
            version: activeFile.meta.version,
            codeBlob: content,
            dependencies: activeFile.meta.dependencies ?? [],
          },
        });
      }
      setSaveStatus("Saved");
      loadTree();
    } catch (err) {
      setSaveError((err as Error).message || "Save failed");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(""), 2000);
    }
  };

  const activeContent = activeFile ? fileContents[activeFile.id] ?? "" : "";

  const monacoLanguage = useMemo(() => {
    if (!activeFile) return "plaintext";
    return activeFile.language === "jsx" ? "javascript" : activeFile.language;
  }, [activeFile]);

  return (
    <div className="flex h-screen bg-[#1e1e1e] text-gray-100">
      <div className="relative w-80 border-r border-[#2a2d2e]">
        {treeError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-sm text-red-300">
            <p>{treeError}</p>
            <button
              className="rounded bg-[#094771] px-3 py-1 text-white hover:bg-[#0b5b96]"
              onClick={loadTree}
            >
              Retry
            </button>
          </div>
        ) : !treeData || loadingTree ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Loading explorer...
          </div>
        ) : (
          <FileExplorer
            key={treeData.id}
            onOpenFile={handleOpenFile}
            initialTree={treeData}
            readOnly
          />
        )}
      </div>

      <main className="flex flex-1 flex-col min-w-0">
        <div className="flex items-center gap-2 border-b border-[#2a2d2e] bg-[#252526] px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {openFiles.map((file) => (
              <button
                key={file.id}
                onClick={() => setActiveFile(file)}
                className={`rounded px-3 py-1 text-sm ${
                  activeFile?.id === file.id
                    ? "bg-[#094771] text-white"
                    : "text-gray-200 hover:bg-[#2a2d2e]"
                }`}
              >
                {file.name}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3 text-xs text-gray-300">
            {activeFile?.meta?.kind === "module" && (
              <div className="flex items-center gap-2">
                <span className="rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1 text-[11px] uppercase tracking-wide">
                  {activeFile.meta.method}
                </span>
                <span className="text-gray-200">{activeFile.meta.routePath}</span>
              </div>
            )}
            {activeFile?.meta?.kind === "ui" && (
              <div className="flex items-center gap-2">
                <span className="rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1 text-[11px] uppercase tracking-wide">
                  UI Entity
                </span>
                <span className="text-gray-200">
                  {activeFile.meta.name}@{activeFile.meta.version}
                </span>
              </div>
            )}

            {activeFile && (
              <>
                <span>Language</span>
                <select
                  value={
                    LANGUAGE_OPTIONS.some(
                      (option) => option.value === activeFile.language
                    )
                      ? activeFile.language
                      : "javascript"
                  }
                  onChange={(e) =>
                    handleLanguageChange(e.target.value as EditorLanguage)
                  }
                  className="rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1 text-sm text-gray-200 focus:border-sky-500 focus:outline-none"
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  className="rounded bg-[#0b5b96] px-3 py-1 text-white hover:bg-[#0f72be] disabled:opacity-60"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  className="rounded border border-[#3c3c3c] px-3 py-1 text-gray-200 hover:bg-[#2a2d2e]"
                  onClick={loadTree}
                  disabled={loadingTree}
                >
                  Refresh
                </button>
              </>
            )}
          </div>
        </div>

        {(saveStatus || saveError) && (
          <div className="flex items-center gap-3 border-b border-[#2a2d2e] bg-[#1f1f1f] px-3 py-2 text-xs">
            {saveStatus && <span className="text-green-300">{saveStatus}</span>}
            {saveError && <span className="text-red-300">{saveError}</span>}
          </div>
        )}

        <div className="flex flex-1 min-h-0 bg-[#1e1e1e]">
          {activeFile ? (
            <MonacoEditor
              height="100%"
              language={monacoLanguage}
              theme="vs-dark"
              value={activeContent}
              onChange={handleEditorChange}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
              Select a module or UI entity from the explorer to start editing.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

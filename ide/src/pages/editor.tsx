import "../lib/monaco";
import { useEffect, useMemo, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import FileExplorer, { ExplorerNode } from "../components/FileExplorer";

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

export default function EditorPage() {
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(CONTENT_STORAGE_KEY, JSON.stringify(fileContents));
  }, [fileContents]);

  const handleOpenFile = (file: ExplorerNode) => {
    if (file.type !== "file") return;
    const language = detectLanguage(file.name);

    setFileContents((prev) => {
      if (prev[file.id] !== undefined) return prev;
      return { ...prev, [file.id]: `// ${file.name}` };
    });

    setOpenFiles((prev) => {
      const existing = prev.find((f) => f.id === file.id);
      if (existing) {
        return prev.map((f) =>
          f.id === file.id ? { ...f, name: file.name, language } : f
        );
      }
      return [...prev, { id: file.id, name: file.name, language }];
    });

    setActiveFile({ id: file.id, name: file.name, language });
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

  const activeContent = activeFile ? fileContents[activeFile.id] ?? "" : "";

  const monacoLanguage = useMemo(() => {
    if (!activeFile) return "plaintext";
    return activeFile.language === "jsx" ? "javascript" : activeFile.language;
  }, [activeFile]);

  return (
    <div className="flex h-screen bg-[#1e1e1e] text-gray-100">
      <FileExplorer onOpenFile={handleOpenFile} />

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

          {activeFile && (
            <div className="ml-auto flex items-center gap-2 text-xs text-gray-300">
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
            </div>
          )}
        </div>

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
              Select or create a file in the explorer to start editing.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

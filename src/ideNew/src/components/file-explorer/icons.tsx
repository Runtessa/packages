import React from "react";
import {
  MdCode,
  MdDataObject,
  MdDescription,
  MdFolder,
  MdFolderOpen,
  MdHtml,
  MdInsertDriveFile,
  MdStorage,
  MdTerminal,
} from "react-icons/md";

export const Chevron = ({ open }: { open: boolean }) => (
  <svg className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 12 12" aria-hidden>
    <path d={open ? "M2 9l4-6 4 6z" : "M3 2l6 4-6 4z"} fill="currentColor" />
  </svg>
);

export const FolderIcon = ({ open }: { open: boolean }) =>
  open ? (
    <MdFolderOpen className="h-4 w-4 text-yellow-400" aria-hidden />
  ) : (
    <MdFolder className="h-4 w-4 text-yellow-400" aria-hidden />
  );

const FILE_ICON_BY_EXT: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  js: { icon: MdCode, color: "text-yellow-300" },
  jsx: { icon: MdCode, color: "text-yellow-300" },
  ts: { icon: MdCode, color: "text-blue-300" },
  tsx: { icon: MdCode, color: "text-blue-300" },
  json: { icon: MdDataObject, color: "text-emerald-300" },
  md: { icon: MdDescription, color: "text-slate-300" },
  html: { icon: MdHtml, color: "text-orange-300" },
  css: { icon: MdDescription, color: "text-violet-300" },
  scss: { icon: MdDescription, color: "text-pink-300" },
  env: { icon: MdTerminal, color: "text-lime-300" },
  sql: { icon: MdStorage, color: "text-teal-300" },
  yml: { icon: MdDescription, color: "text-amber-300" },
  yaml: { icon: MdDescription, color: "text-amber-300" },
};

const FILE_ICON_BY_NAME: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  dockerfile: { icon: MdTerminal, color: "text-sky-300" },
  makefile: { icon: MdTerminal, color: "text-amber-300" },
};

export const FileTypeIcon = ({ name }: { name?: string }) => {
  const lower = (name ?? "").toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  const def = FILE_ICON_BY_NAME[lower] || FILE_ICON_BY_EXT[ext];
  const Icon = def?.icon ?? MdInsertDriveFile;
  const color = def?.color ?? (lower.startsWith(".env") ? "text-lime-300" : "text-blue-300");
  return <Icon className={`h-4 w-4 ${color}`} aria-hidden />;
};

export const NewFileIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 2v5h5l-5-5z"
    />
    <path fill="currentColor" d="M11 12h2v3h3v2h-3v3h-2v-3H8v-2h3v-3z" />
  </svg>
);

export const NewFolderIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
    <path fill="currentColor" d="M3 6h6l2 2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3z" />
    <path fill="currentColor" d="M11 12h2v3h3v2h-3v3h-2v-3H8v-2h3v-3z" />
  </svg>
);

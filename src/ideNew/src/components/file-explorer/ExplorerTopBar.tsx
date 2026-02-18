import React from "react";
import { NewFileIcon, NewFolderIcon } from "./icons";

type ExplorerTopBarProps = {
  readOnly: boolean;
  onCreateNode: (type: "file" | "folder") => void;
};

const ExplorerTopBar = ({ readOnly, onCreateNode }: ExplorerTopBarProps) => {
  return (
    <div className="flex h-[34px] items-center justify-between border-b border-[#2a2d2e] px-3 text-[11px] uppercase text-gray-400">
      <span>Project</span>
      {!readOnly && (
        <div className="flex items-center gap-1 text-gray-400">
          <button
            type="button"
            className="rounded p-1 hover:bg-[#2a2d2e] hover:text-gray-200"
            onClick={(e) => {
              e.stopPropagation();
              onCreateNode("file");
            }}
            aria-label="New file"
            title="New file"
          >
            <NewFileIcon />
          </button>
          <button
            type="button"
            className="rounded p-1 hover:bg-[#2a2d2e] hover:text-gray-200"
            onClick={(e) => {
              e.stopPropagation();
              onCreateNode("folder");
            }}
            aria-label="New folder"
            title="New folder"
          >
            <NewFolderIcon />
          </button>
        </div>
      )}
    </div>
  );
};

export default ExplorerTopBar;

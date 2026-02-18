import { useCallback } from "react";
import type { ExplorerNode } from "./types";

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
};

const useImportClipboard = ({ success, error }: ToastApi, treeName: string) => {
  const copyToClipboard = useCallback(
    async (value: string) => {
      if (!value) return;
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
          success("Import address copied");
          return;
        }
      } catch {
        // fallback below
      }
      try {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (ok) {
          success("Import address copied");
        } else {
          error("Failed to copy import address");
        }
      } catch {
        error("Failed to copy import address");
      }
    },
    [error, success]
  );

  const resolveImportAddress = useCallback(
    (node: ExplorerNode) => {
      const meta = (node.meta ?? {}) as Record<string, unknown>;
      if (meta.kind === "ui" && typeof meta.name === "string") {
        return meta.name;
      }
      if (meta.kind === "shared") {
        return treeName && treeName !== "PROJECT" ? treeName : null;
      }
      return null;
    },
    [treeName]
  );

  return {
    copyToClipboard,
    resolveImportAddress,
  };
};

export default useImportClipboard;

import type { ExplorerNode } from "./types";

export const STORAGE_TREE_KEY = "vscode-file-explorer-tree";
export const STORAGE_EXPANDED_KEY = "vscode-file-explorer-expanded";

export const initialData: ExplorerNode = {
  id: "root",
  name: "PROJECT",
  type: "folder",
  children: [
    {
      id: "src-folder",
      name: "src",
      type: "folder",
      children: [
        {
          id: "components-folder",
          name: "components",
          type: "folder",
          children: [
            { id: "button-file", name: "Button.jsx", type: "file" },
            { id: "card-file", name: "Card.jsx", type: "file" },
            {
              id: "hooks-folder",
              name: "hooks",
              type: "folder",
              children: [
                { id: "useAuth-file", name: "useAuth.js", type: "file" },
                { id: "useTheme-file", name: "useTheme.js", type: "file" },
              ],
            },
          ],
        },
        { id: "app-file", name: "App.jsx", type: "file" },
        { id: "main-file", name: "main.jsx", type: "file" },
        { id: "styles-file", name: "global.css", type: "file" },
      ],
    },
    {
      id: "config-folder",
      name: "config",
      type: "folder",
      children: [
        { id: "tsconfig-file", name: "tsconfig.json", type: "file" },
        { id: "package-file", name: "package.json", type: "file" },
      ],
    },
    {
      id: "public-folder",
      name: "public",
      type: "folder",
      children: [
        { id: "index-html-file", name: "index.html", type: "file" },
        { id: "favicon-file", name: "favicon.ico", type: "file" },
      ],
    },
    { id: "readme-file", name: "README.md", type: "file" },
  ],
};

export const makeId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

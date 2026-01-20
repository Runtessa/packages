import "../../lib/monaco";
import { Editor, Monaco } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import { editor } from "monaco-editor";

export default function CodeEditor({
  theme,
  showTree,
  file,
  onChange,
  onValidate,
}: {
  theme: "light" | "dark";
  showTree: boolean;
  file: any;
  onChange: any;
  onValidate: any;
}) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const models = useRef<Record<string, editor.ITextModel>>({});

  function handleEditorDidMount(
    editor: editor.IStandaloneCodeEditor,
    _monaco: Monaco
  ) {
    editorRef.current = editor;
    monacoRef.current = _monaco;
  }
  useEffect(() => {
    if (editorRef.current) editorRef.current.layout();
  }, [showTree]);

  useEffect(() => {
    const resizeListener = () => {
      if (editorRef.current) editorRef.current.layout();
    };

    window.addEventListener("resize", resizeListener);

    return () => window.removeEventListener("resize", resizeListener);
  }, []);

  useEffect(() => {
    if (editorRef.current && monacoRef.current && file) {
      if (models.current[file.path] === undefined) {
        models.current[file.path] = monacoRef.current.editor.createModel(
          file.value ?? "",
          "javascript"
        );
      }
      editorRef.current.setModel(models.current[file.path]);
    }
  }, [file]);

  return (
    <>
      <Editor
        height="95%"
        theme={theme == "light" ? theme : "vs-dark"}
        onMount={handleEditorDidMount}
        onChange={onChange}
        onValidate={onValidate}
      />
    </>
  );
}

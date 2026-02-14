import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

const postCallback = async (sessionId: string, callbackData: Record<string, unknown>) => {
  const response = await fetch("/api/assistant/auth/callback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      callbackData,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data?.error || response.statusText || "Callback failed"));
    throw error;
  }
  return data;
};

export default function CodexCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Processing callback...");
  const [details, setDetails] = useState("");

  const sessionId = useMemo(() => {
    const value = router.query.sessionId;
    if (Array.isArray(value)) return value[0] || "";
    return String(value || "");
  }, [router.query.sessionId]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!sessionId) {
      setStatus("Missing sessionId");
      setDetails("No login session id was provided in callback URL.");
      return;
    }
    const callbackData: Record<string, unknown> = {};
    Object.entries(router.query).forEach(([key, value]) => {
      if (key === "sessionId") return;
      callbackData[key] = Array.isArray(value) ? value[0] : value;
    });

    postCallback(sessionId, callbackData)
      .then(() => {
        setStatus("Callback delivered");
        setDetails("You can close this tab and return to the IDE.");
      })
      .catch((error) => {
        setStatus("Callback failed");
        setDetails(String(error?.message || error));
      });
  }, [router.isReady, router.query, sessionId]);

  return (
    <div className="min-h-screen bg-[#1e1e1e] text-gray-200 flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded border border-[#2a2d2e] bg-[#252526] p-5">
        <h1 className="text-lg font-semibold">{status}</h1>
        <p className="mt-2 text-sm text-gray-300">{details}</p>
        <p className="mt-4 text-xs text-gray-500">Session: {sessionId || "n/a"}</p>
      </div>
    </div>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataCard } from "../components/ui/DataCard";
import { FormLayout } from "../components/ui/FormLayout";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { useSessionToken } from "../lib/client/session";

type User = { email: string; role: string };

export default function EditorPage() {
  const { token, setToken, ready } = useSessionToken();
  const { success } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!ready || !token) return;
      try {
        const res = await fetch("/api/profile", {
          headers: { Authorization: `Session ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load profile");
        setUser(data.user);
        setForm((prev) => ({ ...prev, email: data.user.email }));
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes("unauthorized")) {
          setToken("");
          window.location.replace("/login");
        }
      }
    };
    load();
  }, [token, ready, setToken, window.location]);


  return (
    <div className="space-y-6">
      
    </div>
  );
}

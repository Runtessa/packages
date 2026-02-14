import { useRouter } from "next/router";
import { useEffect } from "react";
import { useSessionToken } from "@/lib/client/session";

type AuthGuardProps = {
  children: React.ReactNode;
};

export const AuthGuard = ({ children }: AuthGuardProps) => {
  const router = useRouter();
  const { token, ready } = useSessionToken();

  useEffect(() => {
    if (ready && !token) {
      router.replace("/login");
    }
  }, [ready, token, router]);

  if (!ready) {
    // Optionally return a loading spinner here
    return null;
  }

  if (!token) {
    return null;
  }

  return <>{children}</>;
};

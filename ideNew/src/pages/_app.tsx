import type { AppProps } from "next/app";
import "../styles/globals.css";
import AppShell from "@/layouts/AppShell";
import { AuthGuard } from "@/components/AuthGuard";
import { ToastProvider } from "@/components/ui/Toast";
import { useRouter } from "next/router";

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const hideShell = router.pathname === "/login";

  return (
    <ToastProvider>
      {hideShell ? (
        <Component {...pageProps} />
      ) : (
        <AuthGuard>
          <AppShell>
            <Component {...pageProps} />
          </AppShell>
        </AuthGuard>
      )}
    </ToastProvider>
  );
}

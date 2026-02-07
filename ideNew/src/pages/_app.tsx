import type { AppProps } from "next/app";
import "../styles/globals.css";
import "@/lib/monaco";
import AppShell from "@/layouts/AppShell";
import { AuthGuard } from "@/components/AuthGuard";
import { ToastProvider } from "@/components/ui/Toast";
import { useRouter } from "next/router";
import Head from "next/head";

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const isLogin = router.pathname === "/login";
  const isEditor = router.pathname === "/editor";
  const hideShell = isLogin || isEditor;

  return (
    <ToastProvider>
      <Head>
        <title>ADA Idp Control Panel</title>
      </Head>
      {isLogin ? (
        <Component {...pageProps} />
      ) : (
        <AuthGuard>
          {hideShell ? (
            <Component {...pageProps} />
          ) : (
            <AppShell>
              <Component {...pageProps} />
            </AppShell>
          )}
        </AuthGuard>
      )}
    </ToastProvider>
  );
}

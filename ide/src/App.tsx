import "./styles/globals.css";
import { AppShell } from "./layouts/AppShell";
import { AuthGuard } from "./components/AuthGuard";
import { ToastProvider } from "./components/ui/Toast";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import DashboardPage from "./pages/dashboard";
import Login from "./pages/login";
import DocsPage from "./pages/docs";
import ProfilePage from "./pages/profile";
import AdminSettingsPage from "./pages/admin/settings";
import AdminUsersPage from "./pages/admin/users";
import EditorPage from "./pages/editor";

export const App = () => {
  // const hideShell = router.pathname === "/login";

  return (
    <ToastProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="/dashboard" element={<Page name="/" />} />
          <Route path="/docs" element={<Page name="/docs" />} />
          <Route path="/profile" element={<Page name="/profile" />} />
          <Route
            path="/admin/settings"
            element={<Page name="admin/settings" />}
          />
          <Route path="/admin/users" element={<Page name="admin/users" />} />
          <Route path="*" element={<Page name="" />} />
        </Routes>
      </Router>
    </ToastProvider>
  );
};

const Page = ({ name }: { name: string }) => {
  switch (name) {
    case "/":
      return (
        <AuthGuard>
          <AppShell>
            <DashboardPage />
          </AppShell>
        </AuthGuard>
      );
    case "/docs":
      return (
        <AuthGuard>
          <AppShell>
            <DocsPage />
          </AppShell>
        </AuthGuard>
      );
    case "/profile":
      return (
        <AuthGuard>
          <AppShell>
            <ProfilePage />
          </AppShell>
        </AuthGuard>
      );
    case "/admin/settings":
      return (
        <AuthGuard>
          <AppShell>
            <AdminSettingsPage />
          </AppShell>
        </AuthGuard>
      );
    case "/admin/users":
      return (
        <AuthGuard>
          <AppShell>
            <AdminUsersPage />
          </AppShell>
        </AuthGuard>
      );
    default:
      return (
        <AuthGuard>
          <AppShell>
            <></>
          </AppShell>
        </AuthGuard>
      );
  }
};

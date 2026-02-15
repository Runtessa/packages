import { ReactNode, useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MainContent } from './MainContent';

type AdminShellProps = {
  children: ReactNode;
};

export const AdminShell = ({ children }: AdminShellProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="h-screen bg-bgApp text-textPrimary" dir="ltr">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex h-full flex-col overflow-hidden lg:pl-72">
        <div className="flex flex-1 flex-col overflow-y-auto">
          <TopBar onMenuToggle={() => setSidebarOpen((prev) => !prev)} />
          <div className="flex-1">
            <MainContent>{children}</MainContent>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminShell;

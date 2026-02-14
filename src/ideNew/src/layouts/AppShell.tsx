import { ReactNode, useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { MainContent } from '@/components/layout/MainContent';

type AppShellProps = {
  children: ReactNode;
};

export const AppShell = ({ children }: AppShellProps) => {
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

export default AppShell;

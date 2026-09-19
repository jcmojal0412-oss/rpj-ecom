'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/login' || pathname.startsWith('/book') || pathname.startsWith('/attendance-kiosk') || pathname === '/pos') {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-auto pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  );
}

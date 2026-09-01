'use client';

import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';

// Landing spot for a staff account with no module assigned at all — every
// other permission denial in the app sends the user back to the first
// module they actually have (see landingPathFor in middleware.ts); this is
// the true last resort when that list comes up empty.
export default function NoAccessClient() {
  const router = useRouter();

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <div className="card max-w-sm text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
          <ShieldAlert className="text-amber-500" size={24} />
        </div>
        <div>
          <p className="text-base font-semibold text-gray-900">No modules assigned yet</p>
          <p className="text-sm text-gray-500 mt-1.5">
            Your account isn&apos;t assigned to any part of the system yet. Ask your administrator to grant access to at least one module.
          </p>
        </div>
        <button onClick={logout} className="btn-secondary w-full justify-center">Sign Out</button>
      </div>
    </div>
  );
}

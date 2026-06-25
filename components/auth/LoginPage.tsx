'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Eye, EyeOff, ArrowLeft, ChevronRight } from 'lucide-react';
import { AVATAR_HEX } from '@/lib/auth-helpers';

interface StaffUser {
  id: number;
  name: string;
  username: string;
  avatar_color: string;
}

type View = 'main' | 'staff';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning.';
  if (h < 17) return 'Good afternoon.';
  return 'Good evening.';
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

export default function LoginPage() {
  const router = useRouter();
  const [view, setView]     = useState<View>('main');
  const [staff, setStaff]   = useState<StaffUser[]>([]);
  const [selected, setSelected] = useState<StaffUser | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const passRef    = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/auth/staff').then(r => r.json()).then(d => Array.isArray(d) ? setStaff(d) : null).catch(() => {});
  }, []);

  useEffect(() => {
    if (view === 'staff') setTimeout(() => passRef.current?.focus(), 100);
  }, [view]);

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Invalid credentials'); return; }
      router.push('/');
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  const selectStaff = (s: StaffUser) => {
    setSelected(s);
    setUsername(s.username);
    setPassword('');
    setError('');
    setView('staff');
  };

  const goBack = () => {
    setView('main');
    setSelected(null);
    setUsername('');
    setPassword('');
    setError('');
    setTimeout(() => usernameRef.current?.focus(), 100);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #dce8f5 0%, #e8f2fb 50%, #d4e4f5 100%)' }}>

      {/* Ambient orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, #bfdbfe, transparent)' }} />
        <div className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(circle, #c7d2fe, transparent)' }} />
        <div className="absolute top-1/2 left-1/4 w-64 h-64 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #bae6fd, transparent)' }} />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-[400px]"
        style={{ filter: 'drop-shadow(0 40px 60px rgba(30,80,150,0.18))' }}>
        <div className="bg-white rounded-[2.5rem] overflow-hidden">

          {/* Logo section */}
          <div className="flex flex-col items-center pt-10 pb-6 px-10"
            style={{ background: 'linear-gradient(180deg, #f8f9ff 0%, #ffffff 100%)' }}>
            <div className="mb-5">
              <Image src="/logo.png" alt="RPJ Corp" width={120} height={100} className="object-contain" priority />
            </div>

            {/* Back button */}
            {view === 'staff' && (
              <button onClick={goBack}
                className="absolute top-8 left-8 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors font-medium">
                <ArrowLeft size={13} /> Back
              </button>
            )}

            <p className="text-[10px] font-bold tracking-[0.2em] text-gray-400 uppercase mb-1">
              RPJ Corp. Workspace
            </p>

            {view === 'staff' && selected ? (
              <div className="text-center">
                <div className="w-14 h-14 rounded-full mx-auto mb-2 flex items-center justify-center text-white text-lg font-bold shadow-lg"
                  style={{ backgroundColor: AVATAR_HEX[selected.avatar_color] ?? '#3b82f6' }}>
                  {initials(selected.name)}
                </div>
                <h1 className="text-xl font-semibold text-gray-900">
                  Hi, {selected.name.split(' ')[0]}.
                </h1>
                <p className="text-sm text-gray-400 mt-0.5">Enter your password to continue.</p>
              </div>
            ) : (
              <div className="text-center">
                <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
                  {getGreeting()}
                </h1>
                <p className="text-sm text-gray-400 mt-0.5">Sign in to your workspace.</p>
              </div>
            )}
          </div>

          {/* Form section */}
          <div className="px-10 pb-10 space-y-4">

            {/* Username — only in main view */}
            {view === 'main' && (
              <div>
                <label className="text-[10px] font-bold tracking-[0.12em] text-gray-400 uppercase block mb-1.5">
                  Username
                </label>
                <input
                  ref={usernameRef}
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && passRef.current?.focus()}
                  placeholder="Enter username"
                  className="w-full rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-300 transition-all outline-none"
                  style={{
                    background: '#f4f6fb',
                    border: '1.5px solid transparent',
                  }}
                  onFocus={e => (e.target.style.border = '1.5px solid #f97316')}
                  onBlur={e => (e.target.style.border = '1.5px solid transparent')}
                />
              </div>
            )}

            {/* Password */}
            <div>
              <label className="text-[10px] font-bold tracking-[0.12em] text-gray-400 uppercase block mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  ref={passRef}
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  placeholder="••••••••"
                  className="w-full rounded-xl px-4 py-3 pr-11 text-sm text-gray-900 placeholder-gray-300 transition-all outline-none"
                  style={{
                    background: '#f4f6fb',
                    border: '1.5px solid transparent',
                  }}
                  onFocus={e => (e.target.style.border = '1.5px solid #f97316')}
                  onBlur={e => (e.target.style.border = '1.5px solid transparent')}
                />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="text-center text-xs text-red-500 font-medium bg-red-50 rounded-xl py-2.5 px-4">
                {error}
              </div>
            )}

            {/* Sign In button */}
            <button
              onClick={handleLogin}
              disabled={loading || !password || (view === 'main' && !username)}
              className="w-full text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: loading ? '#e8801a' : 'linear-gradient(180deg, #f97316 0%, #ea6d0a 100%)',
                boxShadow: '0 8px 24px rgba(249,115,22,0.35)',
              }}
            >
              {loading ? (
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" className="opacity-75" />
                </svg>
              ) : (
                <> Sign In <ChevronRight size={16} /></>
              )}
            </button>

            {/* Staff Quick Access */}
            {view === 'main' && staff.length > 0 && (
              <div className="pt-3">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-[10px] font-bold tracking-[0.15em] text-gray-300 uppercase whitespace-nowrap">
                    Staff Quick Access
                  </span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>

                <div className="grid grid-cols-4 gap-3">
                  {staff.map(s => (
                    <button
                      key={s.id}
                      onClick={() => selectStaff(s)}
                      className="group flex flex-col items-center gap-1.5"
                    >
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold transition-all duration-200 group-hover:scale-110 group-active:scale-95"
                        style={{
                          backgroundColor: AVATAR_HEX[s.avatar_color] ?? '#3b82f6',
                          boxShadow: `0 4px 12px ${AVATAR_HEX[s.avatar_color] ?? '#3b82f6'}55`,
                        }}
                      >
                        {initials(s.name)}
                      </div>
                      <span className="text-[10px] font-medium text-gray-400 group-hover:text-gray-700 transition-colors leading-tight text-center">
                        {s.name.split(' ')[0]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tagline */}
        <p className="text-center text-[11px] font-medium mt-5 tracking-widest uppercase"
          style={{ color: 'rgba(30,80,150,0.35)' }}>
          E-Commerce · Connected · Limitless
        </p>
      </div>
    </div>
  );
}

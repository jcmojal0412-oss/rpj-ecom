'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Clock, Coffee, Utensils, LogIn, LogOut, Camera, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import SelfieCaptureModal from './SelfieCaptureModal';
import type { EventType, DayState } from '@/lib/attendance';

interface DayStateResp {
  state: DayState;
  coffeeBreaksUsed: number;
  coffeeBreaksRemaining: number;
  lunchTaken: boolean;
  canTimeIn: boolean; canTimeOut: boolean;
  canLunchOut: boolean; canLunchIn: boolean;
  canCoffeeOut: boolean; canCoffeeIn: boolean;
}

interface TodayEvent {
  id: number;
  event_type: EventType;
  event_time: string;
  superseded_by: number | null;
}

interface LookupResp {
  employee_id: number;
  full_name: string;
  employee_code: string;
  dayState: DayStateResp;
  requiresSelfie: Record<string, boolean>;
  settings: { coffee_break_minutes: number; lunch_break_minutes: number };
  events: TodayEvent[];
}

// Screen shows only what's actionable right now — never a full grid of six
// buttons like the logged-in My Attendance page. Filtering this same list
// by dayState[canKey] naturally produces exactly the per-state button sets
// from the spec (only TIME IN before clocking in, etc.) because that's
// exactly what the server-computed dayState already encodes.
const ACTIONS: { type: EventType; label: string; canKey: keyof DayStateResp; icon: typeof Clock }[] = [
  { type: 'TIME_IN', label: 'TIME IN', canKey: 'canTimeIn', icon: LogIn },
  { type: 'COFFEE_OUT', label: 'COFFEE BREAK', canKey: 'canCoffeeOut', icon: Coffee },
  { type: 'LUNCH_OUT', label: 'LUNCH BREAK', canKey: 'canLunchOut', icon: Utensils },
  { type: 'TIME_OUT', label: 'TIME OUT', canKey: 'canTimeOut', icon: LogOut },
  { type: 'COFFEE_IN', label: 'END COFFEE BREAK', canKey: 'canCoffeeIn', icon: Coffee },
  { type: 'LUNCH_IN', label: 'END LUNCH BREAK', canKey: 'canLunchIn', icon: Utensils },
];

const RESET_AFTER_MS = 5000;

function fmtClockTime(d: Date) {
  return d.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
function fmtClockDate(d: Date) {
  return d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtPHTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
}
function fmtMMSS(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

type Screen = 'idle' | 'looking_up' | 'identified' | 'submitting' | 'success' | 'error';

export default function KioskAttendanceClient() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [screen, setScreen] = useState<Screen>('idle');
  const [identifier, setIdentifier] = useState('');
  const [employee, setEmployee] = useState<LookupResp | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [selfieFor, setSelfieFor] = useState<EventType | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ label: string; time: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (screen === 'idle') inputRef.current?.focus();
  }, [screen]);

  const clearResetTimer = () => {
    if (resetTimerRef.current) { clearTimeout(resetTimerRef.current); resetTimerRef.current = null; }
  };
  useEffect(() => clearResetTimer, []);

  const resetToIdle = () => {
    clearResetTimer();
    setScreen('idle');
    setIdentifier('');
    setEmployee(null);
    setErrorMsg('');
    setSelfieFor(null);
    setSuccessInfo(null);
  };

  const lookup = async () => {
    if (!identifier.trim()) return;
    setScreen('looking_up');
    try {
      const res = await fetch('/api/attendance-kiosk/lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Employee not found.');
        setScreen('error');
        return;
      }
      setEmployee(data);
      setScreen('identified');
    } catch {
      setErrorMsg('Something went wrong. Please try again.');
      setScreen('error');
    }
  };

  const submitClock = async (eventType: EventType, photoPath: string | null) => {
    if (!employee) return;
    setSelfieFor(null);
    setScreen('submitting');
    try {
      const res = await fetch('/api/attendance-kiosk/clock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employee.employee_id, event_type: eventType, photo_path: photoPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Could not record attendance.');
        setScreen('error');
        return;
      }
      const action = ACTIONS.find(a => a.type === eventType)!;
      const events: TodayEvent[] = data.events;
      const justRecorded = [...events].reverse().find(e => e.event_type === eventType && !e.superseded_by);
      setSuccessInfo({ label: action.label, time: justRecorded ? fmtPHTime(justRecorded.event_time) : fmtClockTime(new Date()) });
      setScreen('success');
      clearResetTimer();
      resetTimerRef.current = setTimeout(resetToIdle, RESET_AFTER_MS);
    } catch {
      setErrorMsg('Something went wrong. Please try again.');
      setScreen('error');
    }
  };

  const handleAction = (eventType: EventType) => {
    if (!employee) return;
    if (employee.requiresSelfie[eventType]) {
      setSelfieFor(eventType);
    } else {
      submitClock(eventType, null);
    }
  };

  const availableActions = employee ? ACTIONS.filter(a => employee.dayState[a.canKey]) : [];
  const onBreak = employee && (employee.dayState.state === 'on_coffee' || employee.dayState.state === 'on_lunch');
  const activeEvents = employee ? employee.events.filter(e => !e.superseded_by).sort((a, b) => a.event_time.localeCompare(b.event_time)) : [];
  const lastEvent = activeEvents[activeEvents.length - 1];
  const breakStartMs = onBreak && lastEvent ? new Date(lastEvent.event_time).getTime() : null;
  const allowedBreakMinutes = employee?.dayState.state === 'on_coffee' ? employee.settings.coffee_break_minutes : employee?.settings.lunch_break_minutes;
  const elapsedSeconds = breakStartMs != null ? (nowMs - breakStartMs) / 1000 : 0;
  const overBreakLimit = breakStartMs != null && allowedBreakMinutes != null && elapsedSeconds > allowedBreakMinutes * 60;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-blue-50 flex items-center justify-center p-4 py-8">
      <div className="w-full max-w-md">
        {/* Logo + live clock */}
        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center bg-white rounded-2xl shadow-sm px-6 py-4 mb-4">
            <Image src="/logo.png" alt="RPJ Corp" width={140} height={70} className="object-contain" priority />
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums">{fmtClockTime(new Date(nowMs))}</p>
          <p className="text-sm text-gray-500 mt-0.5">{fmtClockDate(new Date(nowMs))}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 space-y-5">
          {screen === 'idle' && (
            <>
              <div className="text-center">
                <p className="text-lg font-bold text-gray-900">Employee Attendance</p>
                <p className="text-sm text-gray-500 mt-1">Enter your Employee ID, Email, or Mobile Number</p>
              </div>
              <input
                ref={inputRef}
                type="text"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') lookup(); }}
                placeholder="e.g. RPJ-0006, you@email.com, 09171234567"
                className="w-full text-center text-lg font-medium rounded-xl border border-gray-200 px-4 py-4 focus:outline-none focus:ring-2 focus:ring-orange-400"
                autoFocus
              />
              <button
                onClick={lookup}
                disabled={!identifier.trim()}
                className="w-full py-5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-xl font-bold transition-colors"
              >
                Continue
              </button>
            </>
          )}

          {screen === 'looking_up' && (
            <div className="py-10 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-orange-500" size={36} />
              <p className="text-sm text-gray-500">Looking up your record...</p>
            </div>
          )}

          {screen === 'error' && (
            <div className="py-4 flex flex-col items-center gap-4 text-center">
              <XCircle className="text-red-400" size={40} />
              <p className="text-sm text-red-600 font-medium">{errorMsg}</p>
              <button onClick={resetToIdle} className="w-full py-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-lg font-bold transition-colors">
                Try Again
              </button>
            </div>
          )}

          {screen === 'identified' && employee && (
            <>
              <div className="text-center border-b border-gray-100 pb-4">
                <p className="text-xl font-bold text-gray-900">{employee.full_name}</p>
                <p className="text-xs text-gray-400 font-mono mt-0.5">{employee.employee_code}</p>
              </div>

              {onBreak && breakStartMs != null && (
                <div className={`rounded-xl p-4 text-center ${overBreakLimit ? 'bg-red-50' : 'bg-orange-50'}`}>
                  <p className={`text-3xl font-bold tabular-nums ${overBreakLimit ? 'text-red-600' : 'text-orange-600'}`}>
                    {fmtMMSS(elapsedSeconds)}
                  </p>
                  <p className={`text-xs mt-1 ${overBreakLimit ? 'text-red-500' : 'text-orange-500'}`}>
                    {overBreakLimit ? 'Over the ' : 'of the '}{allowedBreakMinutes}-minute allowed break
                  </p>
                </div>
              )}

              {availableActions.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <CheckCircle2 className="mx-auto text-green-400" size={36} />
                  <p className="text-sm text-gray-600 font-medium">You have completed today's attendance.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {availableActions.map(({ type, label, icon: Icon }) => (
                    <button
                      key={type}
                      onClick={() => handleAction(type)}
                      className="flex items-center justify-center gap-3 rounded-xl py-5 text-lg font-bold text-white bg-orange-500 hover:bg-orange-600 transition-colors"
                    >
                      <Icon size={24} />
                      {label}
                      {employee.requiresSelfie[type] && <Camera size={16} className="opacity-70" />}
                    </button>
                  ))}
                </div>
              )}

              <button onClick={resetToIdle} className="w-full py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold transition-colors">
                Cancel
              </button>
            </>
          )}

          {screen === 'submitting' && (
            <div className="py-10 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-orange-500" size={36} />
              <p className="text-sm text-gray-500">Recording...</p>
            </div>
          )}

          {screen === 'success' && successInfo && (
            <div className="py-6 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="text-green-500" size={48} />
              <p className="text-xl font-bold text-gray-900">{successInfo.label} Recorded</p>
              <p className="text-3xl font-bold text-orange-500 tabular-nums">{successInfo.time}</p>
              <button onClick={resetToIdle} className="w-full mt-2 py-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-lg font-bold transition-colors">
                Done
              </button>
            </div>
          )}
        </div>
      </div>

      {selfieFor && employee && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm">
            <p className="text-center text-sm font-semibold text-gray-700 mb-3">
              Please take a selfie for {ACTIONS.find(a => a.type === selfieFor)?.label}
            </p>
            <SelfieCaptureModal
              onClose={() => setSelfieFor(null)}
              onCaptured={photoPath => submitClock(selfieFor, photoPath)}
              uploadUrl="/api/attendance-kiosk/upload-photo"
              extraFields={{ employee_id: String(employee.employee_id) }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

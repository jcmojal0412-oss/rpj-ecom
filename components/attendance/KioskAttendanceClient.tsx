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
// exactly what the server-computed dayState already encodes. Every action
// shares one gold/amber CTA color — the restrained corporate palette keeps
// color meaning limited to: gold = call to action, green = success, soft
// red = error/destructive. Purely visual, no behavior tied to color.
const PRIMARY_BTN = 'bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-md shadow-amber-500/30';

const ACTIONS: { type: EventType; label: string; canKey: keyof DayStateResp; icon: typeof Clock }[] = [
  { type: 'TIME_IN', label: 'TIME IN', canKey: 'canTimeIn', icon: LogIn },
  { type: 'COFFEE_OUT', label: 'COFFEE BREAK', canKey: 'canCoffeeOut', icon: Coffee },
  { type: 'LUNCH_OUT', label: 'LUNCH BREAK', canKey: 'canLunchOut', icon: Utensils },
  { type: 'TIME_OUT', label: 'TIME OUT', canKey: 'canTimeOut', icon: LogOut },
  { type: 'COFFEE_IN', label: 'END COFFEE BREAK', canKey: 'canCoffeeIn', icon: Coffee },
  { type: 'LUNCH_IN', label: 'END LUNCH BREAK', canKey: 'canLunchIn', icon: Utensils },
];

const RESET_AFTER_MS = 5000;

function fmtClockDateTime(d: Date) {
  const datePart = d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return `${datePart} ${timePart}`;
}
function fmtClockTime(d: Date) {
  return d.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
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
  // Starts null (not Date.now()) so the server-rendered HTML and the
  // client's first render match exactly — seeding this with Date.now()
  // caused a hydration mismatch, since the server and the browser never
  // render at the exact same millisecond. The real clock only kicks in
  // client-side, after mount, which React never flags.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
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
      setSuccessInfo({
        label: action.label,
        time: justRecorded ? fmtPHTime(justRecorded.event_time) : fmtClockTime(new Date()),
      });
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
  const elapsedSeconds = breakStartMs != null && nowMs != null ? (nowMs - breakStartMs) / 1000 : 0;
  const overBreakLimit = breakStartMs != null && allowedBreakMinutes != null && elapsedSeconds > allowedBreakMinutes * 60;
  const selfieAction = selfieFor ? ACTIONS.find(a => a.type === selfieFor) : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#EEF3F8] via-[#E9F0F6] to-[#EEF3F8] flex flex-col items-center justify-center p-4 py-10">
      <div className="w-full max-w-lg relative">
        {/* Logo, hovering above the card with clear breathing room */}
        <div className="absolute left-1/2 -translate-x-1/2 -top-14 z-10 bg-white rounded-2xl shadow-md ring-1 ring-black/5 px-6 py-4">
          <Image src="/rpj-logo-gold.png" alt="RPJ Corp" width={88} height={70} className="object-contain" priority />
        </div>

        <div className="bg-white rounded-2xl shadow-lg ring-1 ring-black/5 pt-20 px-6 pb-6 sm:px-10 sm:pb-10 space-y-6">
          <div className="text-center">
            <p className="text-2xl font-extrabold text-slate-900 tracking-tight">EMPLOYEE</p>
            <p className="text-sm font-bold text-amber-600 tracking-widest">ATTENDANCE</p>
            <p className="text-slate-500 text-sm mt-2 tabular-nums">{nowMs != null ? fmtClockDateTime(new Date(nowMs)) : ' '}</p>
          </div>

          {screen === 'idle' && (
            <>
              <div className="rounded-xl border border-slate-200 bg-slate-50 h-36 flex flex-col items-center justify-center gap-2">
                <div className="w-10 h-10 rounded-full bg-amber-600 flex items-center justify-center">
                  <Camera className="text-white" size={18} />
                </div>
                <p className="text-xs text-slate-400">Camera</p>
              </div>

              <input
                ref={inputRef}
                type="text"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') lookup(); }}
                placeholder="Employee ID / Email / Mobile Number"
                className="w-full text-center text-base font-medium rounded-xl bg-slate-50 border border-slate-200 px-4 py-4 focus:outline-none focus:ring-2 focus:ring-amber-500"
                autoFocus
              />
              <button
                onClick={lookup}
                disabled={!identifier.trim()}
                className={`w-full py-5 rounded-xl disabled:opacity-40 text-white text-xl font-bold transition-colors ${PRIMARY_BTN}`}
              >
                Continue
              </button>
            </>
          )}

          {screen === 'looking_up' && (
            <div className="py-10 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-amber-600" size={36} />
              <p className="text-sm text-slate-500">Looking up your record...</p>
            </div>
          )}

          {screen === 'error' && (
            <div className="py-4 flex flex-col items-center gap-4 text-center">
              <XCircle className="text-rose-400" size={40} />
              <p className="text-sm text-rose-600 font-medium">{errorMsg}</p>
              <button onClick={resetToIdle} className="w-full py-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-lg font-bold transition-colors">
                Try Again
              </button>
            </div>
          )}

          {screen === 'identified' && employee && (
            <>
              <div className="text-center border-b border-slate-100 pb-4">
                <p className="text-xl font-bold text-slate-900">{employee.full_name}</p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{employee.employee_code}</p>
              </div>

              {onBreak && breakStartMs != null && (
                <div className={`rounded-xl p-4 text-center ${overBreakLimit ? 'bg-rose-50' : 'bg-slate-100'}`}>
                  <p className={`text-3xl font-bold tabular-nums ${overBreakLimit ? 'text-rose-600' : 'text-slate-800'}`}>
                    {fmtMMSS(elapsedSeconds)}
                  </p>
                  <p className={`text-xs mt-1 ${overBreakLimit ? 'text-rose-500' : 'text-slate-500'}`}>
                    {overBreakLimit ? 'Over the ' : 'of the '}{allowedBreakMinutes}-minute allowed break
                  </p>
                </div>
              )}

              {selfieAction ? (
                <div className="space-y-3">
                  <p className="text-center text-sm font-semibold text-slate-700">
                    Please take a selfie for {selfieAction.label}
                  </p>
                  <SelfieCaptureModal
                    onClose={() => setSelfieFor(null)}
                    onCaptured={photoPath => submitClock(selfieFor!, photoPath)}
                    uploadUrl="/api/attendance-kiosk/upload-photo"
                    extraFields={{ employee_id: String(employee.employee_id) }}
                  />
                </div>
              ) : availableActions.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <CheckCircle2 className="mx-auto text-emerald-500" size={36} />
                  <p className="text-sm text-slate-600 font-medium">You have completed today's attendance.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {availableActions.map(({ type, label, icon: Icon }) => (
                    <button
                      key={type}
                      onClick={() => handleAction(type)}
                      className={`flex items-center justify-center gap-3 rounded-xl py-5 text-lg font-bold text-white transition-colors ${PRIMARY_BTN}`}
                    >
                      <Icon size={24} />
                      {label}
                      {employee.requiresSelfie[type] && <Camera size={16} className="opacity-70" />}
                    </button>
                  ))}
                </div>
              )}

              {!selfieAction && (
                <button onClick={resetToIdle} className="w-full py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-semibold transition-colors">
                  Cancel
                </button>
              )}
            </>
          )}

          {screen === 'submitting' && (
            <div className="py-10 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-amber-600" size={36} />
              <p className="text-sm text-slate-500">Recording...</p>
            </div>
          )}

          {screen === 'success' && successInfo && (
            <div className="py-6 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="text-emerald-500" size={48} />
              <p className="text-xl font-bold text-slate-900">{successInfo.label} Recorded</p>
              <p className="text-3xl font-bold tabular-nums text-emerald-600">{successInfo.time}</p>
              <button onClick={resetToIdle} className="w-full mt-2 py-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-lg font-bold transition-colors">
                Done
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="text-stone-400 text-xs mt-8">© {nowMs != null ? new Date(nowMs).getFullYear() : ''} RPJ Corp.</p>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, MessageSquare, ListChecks, Clock, FolderKanban, CalendarClock,
  CheckCircle2, Settings as SettingsIcon, AlertTriangle,
  Mic, Send, Sun, Moon, Check, Bell, Plus, X,
} from 'lucide-react';
import './command-center.css';
import {
  parseMessage, isScheduleQuery, buildScheduleAnswer, isPlanNarration, buildPlanSummary,
  resolveDueDate, summarizeTitle, buildMorningBrief, buildEndOfDayReview,
  CONFIRM_WORDS, CANCEL_WORDS, type ScheduleSnapshot,
} from '@/lib/command-center';

// ============================================================================
// Command Center (Goldie) — Step 2: real backend. The chat/voice UI and its
// "not real AI yet, simple keyword heuristics" parsing (lib/command-center.ts)
// are unchanged from the Step 1 mockup the owner approved — what changed is
// that Confirm now saves to a real database row (app/api/command-center/*)
// instead of only flipping local component state, and every tab reads real
// data instead of hardcoded arrays. Owner-only (see middleware.ts
// '/command-center' + '/api/command-center' -> '_owner').
// ============================================================================

type TabKey = 'dashboard' | 'secretary' | 'tasks' | 'followups' | 'plans' | 'calendar' | 'completed' | 'settings';

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'secretary', label: 'Goldie', icon: MessageSquare },
  { key: 'tasks', label: 'My Tasks', icon: ListChecks },
  { key: 'followups', label: 'Follow-Ups', icon: Clock },
  { key: 'plans', label: 'Plans', icon: FolderKanban },
  { key: 'calendar', label: 'Calendar', icon: CalendarClock },
  { key: 'completed', label: 'Completed', icon: CheckCircle2 },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

type SaveKind = 'task' | 'reminder' | 'followup';

interface PreviewCard {
  id: string;
  type: string;
  rows: [string, string][];
  warn?: string;
  mode: 'confirm' | 'auto';
  listLabel: string;
  status: 'pending' | 'saved' | 'undone';
  saveKind: SaveKind;
  savePayload: Record<string, any>;
  dbId?: number;
}
interface PlanSummary {
  id: string;
  goal: string;
  steps: string[];
  deadline: string;
  deadlineUnsure: boolean;
  status: 'pending' | 'saved' | 'cancelled';
}
// A due task/reminder that's currently "alarming" — Goldie keeps re-speaking
// it on a loop until the owner taps Stop, instead of announcing it once.
interface ActiveAlarm { key: string; type: 'task' | 'reminder'; entityId: number; title: string; }
interface ChatMsg {
  id: string;
  role: 'user' | 'ai';
  text: string;
  previews?: PreviewCard[];
  planSummary?: PlanSummary;
}

let uid = 0;
const nextId = () => `m${Date.now()}_${uid++}`;

const WELCOME_MESSAGE: ChatMsg = {
  id: nextId(), role: 'ai',
  text: "Hi boss, ako si Goldie! Sabihin mo lang o i-type kung anong gusto mong ipagawa, tandaan, o i-plano — check mo yung mga halimbawa sa kanan.",
};

// Converts a ParsedMessage (see lib/command-center.ts) into what actually
// gets saved. Kept in the client (not lib/command-center.ts) because it
// needs "now" (for resolveDueDate) at call time, not as a pure function of
// text alone.
function buildSavePayload(p: ReturnType<typeof parseMessage>, rawText: string): { kind: SaveKind; payload: Record<string, any> } {
  const cleaned = summarizeTitle(rawText);
  const title = cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
  const { isoDate } = resolveDueDate(p.due, new Date());
  const isRecurring = p.type.includes('Recurring');
  const isReminder = p.type.includes('Reminder');
  const isFollowUp = p.type.includes('Follow-Up');

  if (isReminder) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = days.find(d => p.due.toLowerCase().startsWith(d));
    if (isRecurring && dayName) {
      return { kind: 'reminder', payload: { title, recurrence: 'weekly', recurrence_day: dayName, remind_time: p.dueTime } };
    }
    return { kind: 'reminder', payload: { title, recurrence: 'once', remind_date: isoDate, remind_time: p.dueTime } };
  }
  if (isFollowUp) {
    return { kind: 'followup', payload: { title, status_note: 'Waiting', follow_up_date: isoDate } };
  }
  return { kind: 'task', payload: { title, due_date: isoDate, due_time: p.dueTime, priority: p.priority, status: 'To Do', source: 'typed' } };
}

const SAVE_ENDPOINTS: Record<SaveKind, string> = {
  task: '/api/command-center/tasks',
  reminder: '/api/command-center/reminders',
  followup: '/api/command-center/follow-ups',
};

// Browsers ship several TTS voices (locally installed OS voices, plus
// higher-quality "Natural"/"Neural"/"Online" ones on Edge/Chrome) but
// default to whichever is first alphabetically, which is usually the
// flattest-sounding one. No Filipino voice reads Tagalog cleanly on most
// browsers, so spoken replies are English (see speak() call sites below) —
// Goldie still writes in Taglish in the chat, only what she SAYS out loud is
// English. A real natural Filipino voice, consistent across every device,
// needs a paid TTS API — the owner chose to keep this free browser voice
// for V1 instead (see plan doc).
let cachedVoices: SpeechSynthesisVoice[] = [];
function refreshVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  cachedVoices = window.speechSynthesis.getVoices();
}
// Known pleasant-sounding female English voice names across platforms —
// Samantha (Safari/macOS/iOS, the closest thing to "Siri's voice" exposed
// to the web), Zira/Aria/Jenny/Ava/Emma (Windows — Ava and Emma are the
// "Online (Natural)" voices Windows 11 can install for free, noticeably
// less robotic than the older default Zira/David voices — see Settings >
// Time & Language > Speech > Manage voices > Add voices), Google US English
// (Chrome, female by default).
const FEMALE_VOICE_NAMES = /samantha|zira|aria|jenny|ava|emma|susan|female|google us english|karen|moira|tessa/i;
function pickVoice(): SpeechSynthesisVoice | null {
  if (!cachedVoices.length) return null;
  const femaleNatural = cachedVoices.find(v => FEMALE_VOICE_NAMES.test(v.name) && /natural|neural|online/i.test(v.name) && /^en/i.test(v.lang));
  if (femaleNatural) return femaleNatural;
  const female = cachedVoices.find(v => FEMALE_VOICE_NAMES.test(v.name) && /^en/i.test(v.lang));
  if (female) return female;
  const natural = cachedVoices.find(v => /natural|neural|online/i.test(v.name) && /^en/i.test(v.lang));
  if (natural) return natural;
  const branded = cachedVoices.find(v => /Google|Microsoft/i.test(v.name) && /^en/i.test(v.lang));
  if (branded) return branded;
  return cachedVoices.find(v => /^en/i.test(v.lang)) || cachedVoices[0];
}

function speak(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) { utter.voice = voice; utter.lang = voice.lang; } else { utter.lang = 'en-US'; }
    utter.rate = 0.97;
    utter.pitch = 1.0;
    utter.volume = 1;
    window.speechSynthesis.speak(utter);
  } catch { /* speech synthesis unavailable — silent no-op, text reply still shown */ }
}

// Same as speak(), but queues several utterances back-to-back instead of
// replacing one another — used for the repeating alarm loop, where multiple
// due items may be alarming at once. Volume is already maxed at 1 — the Web
// Speech API has no "louder than the device's own volume" setting.
function speakMany(texts: string[]) {
  if (typeof window === 'undefined' || !window.speechSynthesis || texts.length === 0) return;
  try {
    window.speechSynthesis.cancel();
    for (const text of texts) {
      const utter = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) { utter.voice = voice; utter.lang = voice.lang; } else { utter.lang = 'en-US'; }
      utter.rate = 1.0;
      utter.pitch = 1.05;
      utter.volume = 1;
      window.speechSynthesis.speak(utter);
    }
  } catch { /* speech synthesis unavailable */ }
}

export default function CommandCenterClient() {
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  // Goldie's proactive voice reminders — while this page is open, poll for
  // due tasks/reminders every ~60s. Each newly-due item becomes an "active
  // alarm": Goldie speaks it in English right away, then keeps re-speaking
  // it every ~15s — like a real alarm, not a one-off announcement — until
  // the owner taps Stop on it. Only works while the tab is open in the
  // browser (not a true closed-app alarm — see plan doc). Lives at this top
  // level (not inside SecretaryTab) so it keeps running even while viewing
  // other tabs.
  const [goldieMessages, setGoldieMessages] = useState<{ id: string; text: string }[]>([]);
  const [activeAlarms, setActiveAlarms] = useState<ActiveAlarm[]>([]);
  const activeAlarmsRef = useRef<ActiveAlarm[]>([]);
  useEffect(() => { activeAlarmsRef.current = activeAlarms; }, [activeAlarms]);

  const alarmSpeech = (a: ActiveAlarm) =>
    a.type === 'task' ? `Boss, check ${a.title} now.` : `Boss, reminder — ${a.title}.`;

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [{ due }, todayTasks, activeReminders] = await Promise.all([
          fetch('/api/command-center/due-now').then(r => r.json()),
          fetch('/api/command-center/tasks?when=today').then(r => r.json()),
          fetch('/api/command-center/reminders').then(r => r.json()),
        ]);
        if (cancelled) return;

        // Reconcile every cycle: if a task/reminder that's currently alarming
        // got completed, cancelled, or deleted elsewhere in the app (or by
        // anyone with DB access), it stops being "still due" here and the
        // alarm is dropped — otherwise Goldie would keep repeating forever
        // for something that no longer exists, with Stop as the only way out.
        const validTaskIds = new Set(
          todayTasks.filter((t: any) => t.status !== 'Completed' && t.status !== 'Cancelled').map((t: any) => t.id)
        );
        const validReminderIds = new Set(activeReminders.map((r: any) => r.id));
        setActiveAlarms(prev => prev.filter(a =>
          a.type === 'task' ? validTaskIds.has(a.entityId) : validReminderIds.has(a.entityId)
        ));

        if (!due?.length) return;
        const existingKeys = new Set(activeAlarmsRef.current.map(a => a.key));
        const fresh: ActiveAlarm[] = due
          .map((item: any) => ({ key: `${item.type}:${item.id}`, type: item.type, entityId: item.id, title: item.title }))
          .filter((a: ActiveAlarm) => !existingKeys.has(a.key));
        if (!fresh.length) return;
        setActiveAlarms(prev => [...prev, ...fresh]);
        speakMany(fresh.map(alarmSpeech));
        fresh.forEach(a => {
          showToast(`🔔 Goldie Alarm: ${a.title}`);
          setGoldieMessages(prev => [...prev, { id: nextId(), text: alarmSpeech(a) }]);
        });
      } catch { /* offline or not logged in — skip this tick, try again next poll */ }
    };
    const interval = setInterval(poll, 60_000);
    const initial = setTimeout(poll, 5_000); // small delay so it doesn't fire before the page has settled
    return () => { cancelled = true; clearInterval(interval); clearTimeout(initial); };
  }, []);

  // The "won't stop until I turn it off" part — re-speaks every currently
  // active alarm every ~15s. Independent of the 60s due-now poll above,
  // which only ever ADDS new alarms (the server already dedupes by day, so
  // it won't hand back the same item twice).
  useEffect(() => {
    const repeat = setInterval(() => {
      if (activeAlarmsRef.current.length === 0) return;
      speakMany(activeAlarmsRef.current.map(alarmSpeech));
    }, 15_000);
    return () => clearInterval(repeat);
  }, []);

  const stopAlarm = (key: string) => {
    setActiveAlarms(prev => prev.filter(a => a.key !== key));
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    showToast('Alarm stopped');
  };
  const stopAllAlarms = () => {
    setActiveAlarms([]);
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    showToast('All alarms stopped');
  };

  const requestNotificationPermission = () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      showToast('Hindi supported ng browser mo ang notifications.');
      return;
    }
    Notification.requestPermission().then(perm => {
      showToast(perm === 'granted' ? 'Naka-enable na ang Goldie Alerts! 🔔' : 'Hindi na-grant ang notification permission.');
    });
  };

  return (
    <div className="cc-root">
      <div className="cc-preview-pill"><span className="cc-dot" />Command Center — Goldie is live · voice alerts work while this tab stays open</div>

      {activeAlarms.length > 0 && (
        <div className="cc-alarm-banner">
          <Bell size={16} className="cc-alarm-bell" />
          <div className="cc-alarm-list">
            {activeAlarms.map(a => (
              <div key={a.key} className="cc-alarm-item">
                <span>{a.type === 'task' ? 'TASK' : 'REMINDER'} — {a.title}</span>
                <button className="cc-alarm-stop" onClick={() => stopAlarm(a.key)}>Stop</button>
              </div>
            ))}
          </div>
          {activeAlarms.length > 1 && (
            <button className="cc-alarm-stop-all" onClick={stopAllAlarms}>Stop All</button>
          )}
        </div>
      )}

      <div className="cc-tabs">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} className={`cc-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
        <button className="cc-tab" onClick={requestNotificationPermission} title="Enable Goldie Alerts">
          <Bell size={15} /> Alerts
        </button>
      </div>

      {tab === 'dashboard' && <DashboardTab showToast={showToast} />}
      {tab === 'secretary' && <SecretaryTab showToast={showToast} goldieMessages={goldieMessages} />}
      {tab === 'tasks' && <TasksTab showToast={showToast} />}
      {tab === 'followups' && <FollowUpsTab showToast={showToast} />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'completed' && <CompletedTab />}
      {tab === 'settings' && <SettingsTab showToast={showToast} />}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--cc-navy)', color: 'var(--cc-navy-text)', padding: '11px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 500, boxShadow: '0 8px 24px rgba(0,0,0,.25)', zIndex: 50,
        }}>{toast}</div>
      )}
    </div>
  );
}

// ============================================================================
// DASHBOARD
// ============================================================================
const REMINDER_DAY_LABEL: Record<string, string> = {
  sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat',
};

// Reminders don't have a single "due" field the way tasks do — build a
// human-readable schedule label depending on recurrence type, for display
// in the Dashboard panel and anywhere else reminders get listed.
function reminderSchedule(r: { recurrence: string; remind_date: string | null; remind_time: string | null; recurrence_day: string | null }): string {
  const time = r.remind_time ? `, ${r.remind_time}` : '';
  if (r.recurrence === 'daily') return `Daily${time}`;
  if (r.recurrence === 'weekly') return `Every ${REMINDER_DAY_LABEL[r.recurrence_day || ''] || r.recurrence_day || '?'}${time}`;
  if (r.recurrence === 'monthly') return `Monthly, day ${r.recurrence_day || '?'}${time}`;
  return `${r.remind_date || 'No date set'}${time}`;
}

function DashboardTab({ showToast }: { showToast: (m: string) => void }) {
  const [data, setData] = useState<ScheduleSnapshot | null>(null);
  const [overdue, setOverdue] = useState<any[]>([]);
  const [dueToday, setDueToday] = useState<any[]>([]);
  const [followupsWaiting, setFollowupsWaiting] = useState<any[]>([]);
  const [completedToday, setCompletedToday] = useState<any[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadReminders = () => fetch('/api/command-center/reminders').then(r => r.json()).then(setReminders);

  useEffect(() => {
    Promise.all([
      fetch('/api/command-center/dashboard').then(r => r.json()),
      fetch('/api/command-center/tasks?when=overdue').then(r => r.json()),
      fetch('/api/command-center/tasks?when=today').then(r => r.json()),
      fetch('/api/command-center/follow-ups').then(r => r.json()),
      fetch('/api/command-center/tasks?when=completed').then(r => r.json()),
      fetch('/api/command-center/reminders').then(r => r.json()),
    ]).then(([dash, ov, today, fu, done, rem]) => {
      setData(dash);
      setOverdue(ov);
      setDueToday(today);
      setFollowupsWaiting(fu);
      setCompletedToday(done.slice(0, 5));
      setReminders(rem);
      setLoading(false);
    });
  }, []);

  const dismissReminder = async (id: number) => {
    await fetch(`/api/command-center/reminders/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }),
    });
    showToast('Reminder dismissed');
    loadReminders();
  };

  const [brief, setBrief] = useState<{ title: string; text: string; spoken: string } | null>(null);
  const dateLabel = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });

  const generateMorningBrief = () => {
    if (!data) return;
    const result = buildMorningBrief({
      today: data.today, urgent: data.urgent, overdue: data.overdue, followups: data.followups,
      activeReminders: reminders.length, topPriority: data.topPriorities[0], overdueItems: overdue,
    }, dateLabel);
    setBrief({ title: 'Morning Brief', ...result });
    speak(result.spoken);
  };

  const generateEndOfDay = () => {
    if (!data) return;
    const dueTodayNotDone = dueToday.filter((t: any) => t.status !== 'Completed' && t.status !== 'Cancelled');
    const result = buildEndOfDayReview({ completedToday, overdue: data.overdue, overdueItems: overdue, dueTodayNotDone }, dateLabel);
    setBrief({ title: 'End of Day Review', ...result });
    speak(result.spoken);
  };

  if (loading || !data) {
    return <div className="cc-placeholder-screen"><div className="cc-placeholder-inner"><h3>Loading…</h3></div></div>;
  }

  const priorityDot = (priority: string): 'urgent' | 'high' | 'normal' | 'low' =>
    priority === 'Urgent' ? 'urgent' : priority === 'High' ? 'high' : priority === 'Low' ? 'low' : 'normal';

  return (
    <>
      <div className="cc-dash-head">
        <div>
          <h1>Good Morning, Boss</h1>
          <p className="cc-date">{new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="cc-dash-actions">
          <button className="cc-btn cc-btn-outline" onClick={generateMorningBrief}><Sun size={15} /> Generate Morning Brief</button>
          <button className="cc-btn cc-btn-gold" onClick={generateEndOfDay}><Moon size={15} /> End My Day</button>
        </div>
      </div>

      <div className="cc-kpi-row">
        <Kpi cls="cc-kpi-today" icon={<LayoutDashboard size={15} />} value={String(data.today)} label="Today" />
        <Kpi cls="cc-kpi-urgent" icon={<AlertTriangle size={15} />} value={String(data.urgent)} label="Urgent" />
        <Kpi cls="cc-kpi-overdue" icon={<Clock size={15} />} value={String(data.overdue)} label="Overdue" />
        <Kpi cls="cc-kpi-followup" icon={<MessageSquare size={15} />} value={String(data.followups)} label="Follow-Ups" />
        <Kpi cls="cc-kpi-done" icon={<CheckCircle2 size={15} />} value={String(data.completed)} label="Completed" />
        <Kpi cls="cc-kpi-followup" icon={<Bell size={15} />} value={String(reminders.length)} label="Reminders" />
      </div>

      <div className="cc-dash-grid">
        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Top 5 Priorities Today</h3><span className="cc-count">{data.topPriorities.length}</span></div>
          <div className="cc-rowlist">
            {data.topPriorities.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--cc-text-faint)' }}>Walang naka-schedule na priority ngayon.</p>}
            {data.topPriorities.map((p, i) => (
              <Row key={p.title + i} rank={i + 1} title={p.title} sub={p.sub} time={p.time} />
            ))}
          </div>
        </div>

        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Overdue</h3><span className="cc-count">{overdue.length}</span></div>
          <div className="cc-rowlist">
            {overdue.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--cc-text-faint)' }}>Wala kang overdue na task. 🎉</p>}
            {overdue.slice(0, 5).map((t: any) => (
              <Row key={t.id} dot={priorityDot(t.priority)} overdue title={t.title} sub={t.category || ''} time={t.due_date} />
            ))}
          </div>
        </div>

        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Tasks Due Today</h3><span className="cc-count">{dueToday.length}</span></div>
          <div className="cc-rowlist">
            {dueToday.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--cc-text-faint)' }}>Walang due ngayong araw.</p>}
            {dueToday.slice(0, 5).map((t: any) => (
              <Row key={t.id} dot={priorityDot(t.priority)} title={t.title} sub={t.category || ''} time={t.due_time || ''} />
            ))}
          </div>
        </div>

        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Follow-Ups Waiting</h3><span className="cc-count">{followupsWaiting.length}</span></div>
          <div className="cc-rowlist">
            {followupsWaiting.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--cc-text-faint)' }}>Wala kang follow-ups na naghihintay.</p>}
            {followupsWaiting.slice(0, 5).map((f: any) => (
              <Row key={f.id} title={f.title} sub={f.status_note || 'Waiting'} time={f.follow_up_date || ''} />
            ))}
          </div>
        </div>

        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Active Reminders</h3><span className="cc-count">{reminders.length}</span></div>
          <div className="cc-rowlist">
            {reminders.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--cc-text-faint)' }}>Wala kang active na reminders.</p>}
            {reminders.slice(0, 5).map((r: any) => (
              <Row
                key={r.id} title={r.title} sub={reminderSchedule(r)} time=""
                action={<button className="cc-row-dismiss" onClick={() => dismissReminder(r.id)} title="Dismiss reminder"><X size={13} /></button>}
              />
            ))}
          </div>
        </div>

        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Meetings / Calendar</h3><span className="cc-count">{data.meetingsToday.length}</span></div>
          <div className="cc-rowlist">
            <p style={{ fontSize: 12.5, color: 'var(--cc-text-faint)' }}>Walang calendar sync pa — check Calendar tab para sa upcoming dates.</p>
          </div>
        </div>

        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Completed Today</h3><span className="cc-count">{completedToday.length}</span></div>
          <div className="cc-rowlist">
            {completedToday.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--cc-text-faint)' }}>Wala pang tapos ngayong araw.</p>}
            {completedToday.map((t: any) => (
              <Row key={t.id} done title={t.title} sub={t.category || ''} time={t.completed_at ? t.completed_at.slice(11, 16) : ''} />
            ))}
          </div>
        </div>
      </div>

      {brief && (
        <div className="cc-modal-backdrop" onClick={() => setBrief(null)}>
          <div className="cc-card cc-modal" onClick={e => e.stopPropagation()}>
            <div className="cc-modal-head">
              <h3>{brief.title}</h3>
              <button className="cc-row-dismiss" onClick={() => setBrief(null)} title="Close"><X size={15} /></button>
            </div>
            <div className="cc-modal-body">{brief.text}</div>
            <div className="cc-modal-actions">
              <button className="cc-btn cc-btn-outline cc-btn-sm" onClick={() => speak(brief.spoken)}>🔊 Paki-basa ulit</button>
              <button className="cc-btn cc-btn-gold cc-btn-sm" onClick={() => setBrief(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ cls, icon, value, label }: { cls: string; icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className={`cc-card cc-kpi-card ${cls}`}>
      <div className="cc-kpi-top"><div className="cc-kpi-icon">{icon}</div></div>
      <div className="cc-kpi-value cc-num">{value}</div>
      <div className="cc-kpi-label">{label}</div>
    </div>
  );
}

function Row({ rank, dot, title, sub, time, done, overdue, action }: {
  rank?: number; dot?: 'urgent' | 'high' | 'normal' | 'low'; title: string; sub: string; time: string; done?: boolean; overdue?: boolean; action?: React.ReactNode;
}) {
  return (
    <div className={`cc-item-row ${done ? 'done' : ''} ${overdue ? 'overdue' : ''}`}>
      {rank && <span className="cc-item-rank">{rank}</span>}
      {dot && <span className={`cc-pdot ${dot}`} />}
      <div className="cc-item-title"><strong>{title}</strong><span className="cc-item-sub">{sub}</span></div>
      <span className="cc-item-time cc-num">{time}</span>
      {action}
    </div>
  );
}

// ============================================================================
// GOLDIE (AI Secretary)
// ============================================================================
function SecretaryTab({ showToast, goldieMessages }: { showToast: (m: string) => void; goldieMessages: { id: string; text: string }[] }) {
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognizerRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGoldieCount = useRef(0);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages]);

  // Proactive reminders announced while on another tab still land here as
  // plain AI bubbles once the owner switches back to Goldie, so there's a
  // written trail, not just an audio blip they might have missed.
  useEffect(() => {
    if (goldieMessages.length <= lastGoldieCount.current) return;
    const fresh = goldieMessages.slice(lastGoldieCount.current);
    lastGoldieCount.current = goldieMessages.length;
    setMessages(prev => [...prev, ...fresh.map(g => ({ id: g.id, role: 'ai' as const, text: g.text }))]);
  }, [goldieMessages]);

  const updatePreview = (msgId: string, previewId: string, patch: Partial<PreviewCard>) => {
    setMessages(prev => prev.map(m =>
      m.id === msgId && m.previews
        ? { ...m, previews: m.previews.map(p => p.id === previewId ? { ...p, ...patch } : p) }
        : m
    ));
  };

  const updatePlanSummary = (msgId: string, patch: Partial<PlanSummary>) => {
    setMessages(prev => prev.map(m =>
      m.id === msgId && m.planSummary ? { ...m, planSummary: { ...m.planSummary, ...patch } } : m
    ));
  };

  // Finds the most recent AI message that still has something waiting on a
  // Confirm tap — either a single preview card or a plan summary — so a
  // spoken "Confirm"/"Cancel" knows what to act on.
  const findPending = () => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'ai') continue;
      if (m.planSummary?.status === 'pending') return { msgId: m.id, kind: 'plan' as const };
      const pendingPreview = m.previews?.find(p => p.mode === 'confirm' && p.status === 'pending');
      if (pendingPreview) return { msgId: m.id, previewId: pendingPreview.id, kind: 'preview' as const };
      break; // only the most recent AI message counts — older resolved ones don't
    }
    return null;
  };

  const confirm = async (msgId: string, previewId: string) => {
    const msg = messages.find(m => m.id === msgId);
    const pc = msg?.previews?.find(p => p.id === previewId);
    if (!pc) return;
    try {
      const res = await fetch(SAVE_ENDPOINTS[pc.saveKind], {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pc.savePayload),
      });
      if (!res.ok) throw new Error('save failed');
      const data = await res.json();
      updatePreview(msgId, previewId, { status: 'saved', dbId: data.id });
      showToast(`Saved to ${pc.listLabel}`);
    } catch {
      showToast('Hindi na-save — subukan ulit.');
    }
  };

  const cancelPreview = (msgId: string, previewId: string) => { updatePreview(msgId, previewId, { status: 'undone' }); showToast('Cancelled'); };
  const editPreview = (msgId: string, previewId: string, taskText: string) => {
    updatePreview(msgId, previewId, { status: 'undone' });
    setInput(taskText);
    showToast('Cancelled — i-edit yung text sa baba tapos i-send ulit');
    textareaRef.current?.focus();
  };
  const undo = async (msgId: string, previewId: string) => {
    const msg = messages.find(m => m.id === msgId);
    const pc = msg?.previews?.find(p => p.id === previewId);
    updatePreview(msgId, previewId, { status: 'undone' });
    showToast('Inalis sa list');
    speak('Okay boss, I removed that.');
    if (pc?.dbId) {
      fetch(`${SAVE_ENDPOINTS[pc.saveKind]}/${pc.dbId}`, { method: 'DELETE' }).catch(() => {});
    }
  };

  const confirmPlan = async (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    const ps = msg?.planSummary;
    if (!ps) return;
    const { isoDate } = resolveDueDate(ps.deadline, new Date());
    const title = ps.goal.length > 60 ? ps.goal.slice(0, 60) + '…' : ps.goal;
    try {
      const res = await fetch('/api/command-center/plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, goal: ps.goal, deadline: isoDate, tasks: ps.steps }),
      });
      if (!res.ok) throw new Error('save failed');
      updatePlanSummary(msgId, { status: 'saved' });
      showToast('Saved as new Plan');
    } catch {
      showToast('Hindi na-save ang plan — subukan ulit.');
    }
  };
  const cancelPlan = (msgId: string) => { updatePlanSummary(msgId, { status: 'cancelled' }); showToast('Cancelled'); };
  const editPlan = (msgId: string, goalText: string) => {
    updatePlanSummary(msgId, { status: 'cancelled' });
    setInput(goalText);
    showToast('Cancelled — i-edit yung text sa baba tapos i-send ulit');
    textareaRef.current?.focus();
  };

  const process = async (text: string, viaVoice: boolean) => {
    const trimmed = text.trim();

    if (viaVoice && (CONFIRM_WORDS.test(trimmed) || CANCEL_WORDS.test(trimmed))) {
      const isConfirm = CONFIRM_WORDS.test(trimmed);
      const pending = findPending();
      setMessages(prev => [...prev, { id: nextId(), role: 'user', text }]);

      setTimeout(async () => {
        if (!pending) {
          showToast(isConfirm ? 'Walang naka-pending na i-co-confirm.' : 'Walang naka-pending na i-ca-cancel.');
          speak(isConfirm ? "There's nothing pending to confirm, boss." : "There's nothing pending to cancel, boss.");
          return;
        }
        if (isConfirm) {
          if (pending.kind === 'plan') await confirmPlan(pending.msgId);
          else await confirm(pending.msgId, pending.previewId!);
          speak('Confirmed and saved, boss.');
        } else {
          if (pending.kind === 'plan') cancelPlan(pending.msgId);
          else { updatePreview(pending.msgId, pending.previewId!, { status: 'undone' }); showToast('Cancelled'); }
          speak('Okay boss, cancelled.');
        }
      }, 350);
      return;
    }

    const userMsg: ChatMsg = { id: nextId(), role: 'user', text };
    setMessages(prev => [...prev, userMsg]);

    setTimeout(async () => {
      if (isPlanNarration(text)) {
        const { goal, steps, deadline, deadlineUnsure } = buildPlanSummary(text);
        const aiMsg: ChatMsg = {
          id: nextId(), role: 'ai',
          text: `Narinig ko yung buong plano mo, boss. Eto yung na-summarize ko — i-check mo bago i-save bilang bagong Plan:`,
          planSummary: { id: nextId(), goal, steps, deadline, deadlineUnsure, status: 'pending' },
        };
        setMessages(prev => [...prev, aiMsg]);
        if (viaVoice) {
          speak(deadlineUnsure
            ? `Got it, boss. I've broken that down into ${steps.length} steps, but I'm not sure about the deadline — please set that before I save it.`
            : `Got it, boss. I've broken that down into ${steps.length} steps, due ${deadline}. Please review before I save it as a new plan.`);
        }
        return;
      }

      if (isScheduleQuery(text)) {
        try {
          const snapshot: ScheduleSnapshot = await fetch('/api/command-center/dashboard').then(r => r.json());
          const { text: answer, spoken } = buildScheduleAnswer(snapshot);
          const aiMsg: ChatMsg = { id: nextId(), role: 'ai', text: answer };
          setMessages(prev => [...prev, aiMsg]);
          if (viaVoice) speak(spoken);
        } catch {
          showToast('Hindi ma-check ang schedule mo ngayon — subukan ulit.');
        }
        return;
      }

      const p = parseMessage(text);
      const { kind, payload } = buildSavePayload(p, text);
      const cleanTitle: string = payload.title;
      const rows: [string, string][] = [
        ['Task', cleanTitle.length > 46 ? cleanTitle.slice(0, 46) + '…' : cleanTitle],
        ['Due', p.due],
        ['Priority', p.priority],
      ];

      if (viaVoice && !p.unsure) {
        try {
          const res = await fetch(SAVE_ENDPOINTS[kind], {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
          });
          const data = await res.json();
          const aiMsg: ChatMsg = {
            id: nextId(), role: 'ai', text: 'Naitala ko na, boss — diretso ko nang idinagdag:',
            previews: [{ id: nextId(), type: p.type, rows, mode: 'auto', listLabel: p.listLabel, status: 'saved', saveKind: kind, savePayload: payload, dbId: data.id }],
          };
          setMessages(prev => [...prev, aiMsg]);
          speak(`Added to your ${p.listLabel}, boss. ${rows[0][1]}, due ${p.due}.`);
        } catch {
          showToast('Hindi na-save — subukan ulit.');
          speak('Sorry boss, may problema sa pag-save.');
        }
      } else {
        const aiMsg: ChatMsg = {
          id: nextId(), role: 'ai',
          text: p.unsure ? 'Naintindihan ko, boss — pero paki-confirm muna itong detail bago ko i-save:' : 'Narito ang na-detect ko, paki-check bago ma-save:',
          previews: [{ id: nextId(), type: p.type, rows, warn: p.unsure ? 'Hindi sigurado ang exact date/time — paki-confirm o i-edit muna.' : undefined, mode: 'confirm', listLabel: p.listLabel, status: 'pending', saveKind: kind, savePayload: payload }],
        };
        setMessages(prev => [...prev, aiMsg]);
        if (viaVoice) speak("I'm not totally sure about the date, boss. Please confirm before I save it.");
      }
    }, 450);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    process(text, false);
  };

  const toggleMic = () => {
    const Ctor: any = typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    if (!Ctor) { showToast("Voice command needs Chrome/Edge — this browser doesn't support it."); return; }

    const clearSilenceTimer = () => {
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    };

    if (listening) { clearSilenceTimer(); recognizerRef.current?.stop(); return; }

    try {
      const recognizer = new Ctor();
      recognizerRef.current = recognizer;
      recognizer.lang = 'fil-PH';
      recognizer.interimResults = true;
      // continuous:true so a pause while you're still thinking doesn't cut
      // the recording immediately. But continuous mode never stops on its
      // own — without a manual tap it would just keep recording forever and
      // nothing would ever get sent. So: auto-stop after ~3.5s of silence
      // (reset on every new bit of speech), with tap-to-stop still working
      // for "I'm done now."
      recognizer.continuous = true;

      let finalTranscript = '';
      recognizer.onstart = () => setListening(true);
      recognizer.onresult = (e: any) => {
        const transcript = Array.from(e.results as any).map((r: any) => r[0].transcript).join(' ');
        finalTranscript = transcript;
        setInput(transcript);
        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(() => recognizer.stop(), 3500);
      };
      recognizer.onerror = (e: any) => {
        showToast(e.error === 'not-allowed'
          ? 'Mic access blocked — check your browser mic permission for this site.'
          : 'Voice command error: ' + e.error);
      };
      recognizer.onend = () => {
        clearSilenceTimer();
        setListening(false);
        if (finalTranscript.trim()) {
          setInput('');
          process(finalTranscript.trim(), true);
        }
      };
      recognizer.start();
    } catch {
      showToast('Mic access blocked — check your browser mic permission for this site.');
    }
  };

  return (
    <div className="cc-secretary-wrap">
      <div className="cc-card cc-chat-card">
        <div className="cc-chat-head">
          <span className="cc-dotlive" />
          <div><h3>Ask Goldie</h3><p>Nag-uunawa ng Taglish · Bawat gawa ay may confirmation bago ma-save</p></div>
        </div>

        <div className="cc-chat-body" ref={bodyRef}>
          {messages.map(m => (
            <div key={m.id} className={`cc-bubble-row ${m.role === 'user' ? 'user' : 'ai'}`}>
              <div className="cc-bubble-avatar">{m.role === 'user' ? 'JC' : 'G'}</div>
              <div>
                <div className="cc-bubble">{m.text}</div>
                {m.previews?.map(pc => (
                  <div key={pc.id} className={`cc-preview-card ${pc.mode === 'auto' ? 'auto-saved' : ''} ${pc.status === 'saved' && pc.mode !== 'auto' ? 'saved' : ''} ${pc.status === 'undone' ? 'undone' : ''}`}>
                    <div className="cc-pc-type">{pc.type}{pc.mode === 'auto' && <span className="cc-voice-badge">🎙 Voice</span>}</div>
                    {pc.rows.map(([k, v]) => (
                      <div className="cc-pc-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
                    ))}
                    {pc.warn && <div className="cc-pc-warn"><AlertTriangle size={13} /><span>{pc.warn}</span></div>}

                    {pc.mode === 'confirm' && pc.status === 'pending' && (
                      <div className="cc-pc-actions">
                        <button className="cc-pc-btn cancel" onClick={() => cancelPreview(m.id, pc.id)}>Cancel</button>
                        <button className="cc-pc-btn" onClick={() => editPreview(m.id, pc.id, pc.rows[0][1])}>Edit</button>
                        <button className="cc-pc-btn confirm" onClick={() => confirm(m.id, pc.id)}>Confirm</button>
                      </div>
                    )}
                    {pc.mode === 'confirm' && pc.status === 'saved' && (
                      <div className="cc-pc-saved"><Check size={15} />Saved to {pc.listLabel}</div>
                    )}
                    {pc.mode === 'auto' && pc.status === 'saved' && (
                      <div className="cc-pc-saved">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Check size={15} />Added to {pc.listLabel}</span>
                        <button className="cc-undo-link" onClick={() => undo(m.id, pc.id)}>Undo</button>
                      </div>
                    )}
                    {pc.status === 'undone' && (
                      <div className="cc-pc-saved" style={{ color: 'var(--cc-text-faint)' }}>Removed from {pc.listLabel}</div>
                    )}
                  </div>
                ))}

                {m.planSummary && (
                  <div className={`cc-preview-card ${m.planSummary.status === 'saved' ? 'saved' : ''} ${m.planSummary.status === 'cancelled' ? 'undone' : ''}`} style={{ maxWidth: 380 }}>
                    <div className="cc-pc-type">📋 Plan Summary</div>
                    <div className="cc-pc-row"><span className="k">Goal</span><span className="v">{m.planSummary.goal}</span></div>
                    <div className="cc-pc-row"><span className="k">Deadline</span><span className="v">{m.planSummary.deadline}</span></div>
                    {m.planSummary.deadlineUnsure && (
                      <div className="cc-pc-warn"><AlertTriangle size={13} /><span>Hindi sigurado ang deadline — paki-confirm o i-edit muna.</span></div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      <div className="k" style={{ fontSize: 11.5, marginBottom: 4 }}>Suggested Steps</div>
                      <div className="cc-checklist">
                        {m.planSummary.steps.map((s, i) => (
                          <div className="cc-check-row" key={i}><div className="cc-check-box" style={{ fontSize: 10 }}>{i + 1}</div><span>{s}</span></div>
                        ))}
                      </div>
                    </div>
                    {m.planSummary.status === 'pending' && (
                      <div className="cc-pc-actions">
                        <button className="cc-pc-btn cancel" onClick={() => cancelPlan(m.id)}>Cancel</button>
                        <button className="cc-pc-btn" onClick={() => editPlan(m.id, m.planSummary!.goal)}>Edit</button>
                        <button className="cc-pc-btn confirm" onClick={() => confirmPlan(m.id)}>Save as New Plan</button>
                      </div>
                    )}
                    {m.planSummary.status === 'saved' && (
                      <div className="cc-pc-saved"><Check size={15} />Saved as new Plan</div>
                    )}
                    {m.planSummary.status === 'cancelled' && (
                      <div className="cc-pc-saved" style={{ color: 'var(--cc-text-faint)' }}>Cancelled</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {listening && <div className="cc-mic-status show"><span className="cc-live-dot" />Nakikinig pa... pindutin ulit ang mic kapag tapos ka na</div>}
        <div className="cc-chat-input-bar">
          <button className={`cc-mic-btn ${listening ? 'listening' : ''}`} onClick={toggleMic} title="Voice command"><Mic size={17} /></button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ano ang gusto mong ipagawa, tandaan, o i-plano?"
            rows={1}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <button className="cc-send-btn" onClick={handleSend}><Send size={17} /></button>
        </div>
      </div>

      <div className="cc-quick-rail">
        <div className="cc-card">
          <h4>Try saying...</h4>
          <div className="cc-chip-list">
            <button className="cc-chip" onClick={() => setInput('Remind me tomorrow 10AM tawagan supplier.')}>&quot;Remind me tomorrow 10AM tawagan supplier.&quot;</button>
            <button className="cc-chip" onClick={() => setInput('Follow up J&T after 3 days.')}>&quot;Follow up J&amp;T after 3 days.&quot;</button>
            <button className="cc-chip" onClick={() => setInput('High priority ito.')}>&quot;High priority ito.&quot;</button>
            <button className="cc-chip" onClick={() => setInput('Ano schedule ko today?')}>&quot;Ano schedule ko today?&quot;</button>
            <button className="cc-chip" onClick={() => setInput('Gusto kong ilunch yung Solid Suki Card sa August 30. Kailangan muna tapusin yung design, tapos i-print, tapos i-train yung staff, tapos i-announce sa customers.')}>&quot;Gusto kong ilunch yung Solid Suki Card sa August 30. Kailangan muna tapusin yung design, tapos i-print...&quot; (plan narration)</button>
          </div>
        </div>
        <div className="cc-card">
          <h4>Goldie detects</h4>
          <div className="cc-legend-row"><span className="cc-pdot normal" />Task</div>
          <div className="cc-legend-row"><span className="cc-pdot high" />Reminder</div>
          <div className="cc-legend-row"><span className="cc-pdot urgent" />Follow-up</div>
          <div className="cc-legend-row"><span className="cc-pdot low" />Plan / Idea / Meeting</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MY TASKS
// ============================================================================
const STATUS_CLASS: Record<string, string> = { 'To Do': 'cc-status-todo', 'In Progress': 'cc-status-progress', 'Waiting': 'cc-status-waiting', 'Completed': 'cc-status-done' };
const PRIORITY_DOT: Record<string, 'urgent' | 'high' | 'normal' | 'low'> = { Urgent: 'urgent', High: 'high', Normal: 'normal', Low: 'low' };
const FILTER_TO_WHEN: Record<string, string> = { Today: 'today', Tomorrow: 'tomorrow', 'This Week': 'week', Overdue: 'overdue', Completed: 'completed' };

function TasksTab({ showToast }: { showToast: (m: string) => void }) {
  const [filter, setFilter] = useState('Today');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  // Daily/weekly/monthly reminders live in a separate table (cc_reminders,
  // not cc_tasks) since they don't have a single due date — but a reminder
  // created from this tab's "New Task" modal (Repeat: Daily) should still be
  // visible here, not only on the Dashboard, or it looks like it vanished.
  const [reminders, setReminders] = useState<any[]>([]);

  const load = () => {
    setLoading(true);
    fetch(`/api/command-center/tasks?when=${FILTER_TO_WHEN[filter]}`)
      .then(r => r.json())
      .then(d => { setRows(d); setLoading(false); });
  };
  const loadReminders = () => fetch('/api/command-center/reminders').then(r => r.json()).then(setReminders);
  useEffect(load, [filter]);
  useEffect(() => { loadReminders(); }, []);

  const dismissReminder = async (id: number) => {
    await fetch(`/api/command-center/reminders/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }),
    });
    showToast('Reminder dismissed');
    loadReminders();
  };

  return (
    <>
      <div className="cc-page-head">
        <h1>My Tasks</h1>
        <button className="cc-btn cc-btn-gold cc-btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> New Task</button>
      </div>
      <div className="cc-filter-row">
        {['Today', 'Tomorrow', 'This Week', 'Overdue', 'Completed'].map(f => (
          <button key={f} className={`cc-filter-pill ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      {reminders.length > 0 && (
        <div className="cc-card cc-panel" style={{ marginBottom: 14 }}>
          <div className="cc-panel-head"><h3>Daily &amp; Recurring Reminders</h3><span className="cc-count">{reminders.length}</span></div>
          <div className="cc-rowlist">
            {reminders.map((r: any) => (
              <Row
                key={r.id} title={r.title} sub={reminderSchedule(r)} time=""
                action={<button className="cc-row-dismiss" onClick={() => dismissReminder(r.id)} title="Dismiss reminder"><X size={13} /></button>}
              />
            ))}
          </div>
        </div>
      )}
      <div className="cc-priority-key">
        <div className="cc-legend-row"><span className="cc-pdot urgent" />Urgent</div>
        <div className="cc-legend-row"><span className="cc-pdot high" />High</div>
        <div className="cc-legend-row"><span className="cc-pdot normal" />Normal</div>
        <div className="cc-legend-row"><span className="cc-pdot low" />Low</div>
      </div>
      <div className="cc-table-wrap">
        <div className="cc-table-scroll">
          <table className="cc-task-table">
            <thead><tr><th>Task</th><th>Business / Project</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--cc-text-faint)', padding: '20px 0' }}>Walang task dito.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="cc-task-title-cell">
                      <span className={`cc-pdot ${PRIORITY_DOT[r.priority] || 'normal'}`} />
                      <div><strong>{r.title}</strong>{r.description && <div style={{ fontSize: 11.5, color: 'var(--cc-text-faint)', marginTop: 2 }}>{r.description}</div>}</div>
                    </div>
                  </td>
                  <td>{r.category && <span className="cc-tag">{r.category}</span>}</td>
                  <td className="cc-num">{r.due_date || ''}{r.due_time ? `, ${r.due_time}` : ''}</td>
                  <td><span className={`cc-status-badge ${STATUS_CLASS[r.status] || 'cc-status-todo'}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && <NewTaskModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); loadReminders(); }} showToast={showToast} />}
    </>
  );
}

function NewTaskModal({ onClose, onCreated, showToast }: { onClose: () => void; onCreated: () => void; showToast: (m: string) => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState('Normal');
  // 'none' = one-time task (cc_tasks, shown in this table). 'daily' = a
  // recurring cc_reminders row instead — Goldie speaks it every day at
  // remind_time via the due-now poller, so it lives in Dashboard's Active
  // Reminders panel rather than here.
  const [repeat, setRepeat] = useState<'none' | 'daily'>('none');
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const isDaily = repeat === 'daily';

  useEffect(() => { fetch('/api/command-center/categories').then(r => r.json()).then(setCategories); }, []);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (isDaily) {
        await fetch('/api/command-center/reminders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), category: category || null, remind_time: dueTime || null, recurrence: 'daily' }),
        });
        showToast('Naka-set na — i-aanunsyo ito ni Goldie araw-araw.');
      } else {
        await fetch('/api/command-center/tasks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), category: category || null, due_date: dueDate || null, due_time: dueTime || null, priority, status: 'To Do', source: 'typed' }),
        });
      }
      onCreated();
    } catch {
      setSaving(false); // network failure — let the owner retry instead of leaving Save stuck disabled
    }
  };

  return (
    <div className="cc-modal-backdrop" onClick={onClose}>
      <div className="cc-card cc-modal" onClick={e => e.stopPropagation()}>
        <div className="cc-modal-head"><h3>{isDaily ? 'New Daily Reminder' : 'New Task'}</h3><button className="cc-row-dismiss" onClick={onClose} title="Close"><X size={15} /></button></div>
        <div className="cc-form-row">
          <label className="cc-form-label">{isDaily ? 'Reminder' : 'Task'}</label>
          <input className="cc-form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Hal. Check FB ads" autoFocus onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
        </div>
        <div className="cc-form-row">
          <label className="cc-form-label">Repeat</label>
          <select className="cc-form-select" value={repeat} onChange={e => setRepeat(e.target.value as 'none' | 'daily')}>
            <option value="none">One-time task</option>
            <option value="daily">Daily reminder</option>
          </select>
        </div>
        <div className="cc-form-row-pair">
          {!isDaily && (
            <div className="cc-form-row">
              <label className="cc-form-label">Due Date</label>
              <input type="date" className="cc-form-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          )}
          <div className="cc-form-row">
            <label className="cc-form-label">{isDaily ? 'Remind Time' : 'Due Time'}</label>
            <input type="time" className="cc-form-input" value={dueTime} onChange={e => setDueTime(e.target.value)} />
          </div>
        </div>
        <div className="cc-form-row-pair">
          {!isDaily && (
            <div className="cc-form-row">
              <label className="cc-form-label">Priority</label>
              <select className="cc-form-select" value={priority} onChange={e => setPriority(e.target.value)}>
                <option>Normal</option><option>Low</option><option>High</option><option>Urgent</option>
              </select>
            </div>
          )}
          <div className="cc-form-row">
            <label className="cc-form-label">Business / Project</label>
            <input className="cc-form-input" list="cc-category-list" value={category} onChange={e => setCategory(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <datalist id="cc-category-list">{categories.map(c => <option key={c.id} value={c.name} />)}</datalist>
        <div className="cc-modal-actions">
          <button className="cc-btn cc-btn-outline cc-btn-sm" onClick={onClose}>Cancel</button>
          <button className="cc-btn cc-btn-gold cc-btn-sm" onClick={submit} disabled={!title.trim() || saving}>{saving ? 'Saving…' : isDaily ? 'Save Reminder' : 'Save Task'}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPLETED (full history)
// ============================================================================
function CompletedTab() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    fetch('/api/command-center/tasks?when=completed').then(r => r.json()).then(setRows);
  }, []);
  return (
    <>
      <div className="cc-page-head"><h1>Completed</h1></div>
      <div className="cc-table-wrap">
        <div className="cc-table-scroll">
          <table className="cc-task-table">
            <thead><tr><th>Task</th><th>Business / Project</th><th>Completed</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--cc-text-faint)', padding: '20px 0' }}>Wala pang natatapos.</td></tr>}
              {rows.map((r: any) => (
                <tr key={r.id}>
                  <td><div className="cc-task-title-cell"><span className="cc-pdot low" /><strong>{r.title}</strong></div></td>
                  <td>{r.category && <span className="cc-tag">{r.category}</span>}</td>
                  <td className="cc-num">{r.completed_at ? r.completed_at.slice(0, 16).replace('T', ' ') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// FOLLOW-UPS
// ============================================================================
function FollowUpsTab({ showToast }: { showToast: (m: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = () => fetch('/api/command-center/follow-ups').then(r => r.json()).then(d => { setItems(d); setLoading(false); });
  useEffect(() => { load(); }, []);

  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const overdueCount = items.filter(it => it.follow_up_date && it.follow_up_date < today).length;

  const markFollowedUp = async (id: number) => {
    await fetch(`/api/command-center/follow-ups/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }),
    });
    showToast('Marked as followed up');
    load();
  };

  return (
    <>
      <div className="cc-page-head">
        <h1>Waiting / Follow-Ups</h1>
        <button className="cc-btn cc-btn-gold cc-btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> New Follow-Up</button>
      </div>
      {overdueCount > 0 && (
        <div className="cc-overdue-banner"><AlertTriangle size={16} />{overdueCount} follow-up{overdueCount > 1 ? 's are' : ' is'} overdue and needs your attention</div>
      )}
      <div className="cc-followup-grid">
        {!loading && items.length === 0 && (
          <div className="cc-card" style={{ padding: 20, textAlign: 'center', color: 'var(--cc-text-faint)' }}>Wala kang follow-ups ngayon.</div>
        )}
        {items.map((it) => {
          const isOverdue = it.follow_up_date && it.follow_up_date < today;
          return (
            <div key={it.id} className={`cc-card cc-followup-card ${isOverdue ? 'is-overdue' : ''}`}>
              <div className="cc-fu-main">
                <div className="cc-fu-icon"><Clock size={16} /></div>
                <div><p className="cc-fu-title">{it.title}</p><p className="cc-fu-status">{it.status_note || 'Waiting'}</p></div>
              </div>
              <div className="cc-fu-meta">
                {it.category && <span className="cc-tag">{it.category}</span>}
                <div className="cc-fu-date"><div className="lbl">Follow-up</div><div className="val">{it.follow_up_date || '—'}{isOverdue ? ' · Overdue' : ''}</div></div>
                <button className="cc-btn cc-btn-outline cc-btn-sm" onClick={() => markFollowedUp(it.id)}>Mark Followed Up</button>
              </div>
            </div>
          );
        })}
      </div>

      {showNew && <NewFollowUpModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
    </>
  );
}

function NewFollowUpModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [category, setCategory] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetch('/api/command-center/categories').then(r => r.json()).then(setCategories); }, []);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/command-center/follow-ups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), status_note: statusNote || null, category: category || null, follow_up_date: followUpDate || null }),
      });
      onCreated();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="cc-modal-backdrop" onClick={onClose}>
      <div className="cc-card cc-modal" onClick={e => e.stopPropagation()}>
        <div className="cc-modal-head"><h3>New Follow-Up</h3><button className="cc-row-dismiss" onClick={onClose} title="Close"><X size={15} /></button></div>
        <div className="cc-form-row">
          <label className="cc-form-label">Ano ang hinihintay</label>
          <input className="cc-form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Hal. Follow up J&T courier" autoFocus onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
        </div>
        <div className="cc-form-row">
          <label className="cc-form-label">Status Note</label>
          <input className="cc-form-input" value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder="Hal. Waiting for response" />
        </div>
        <div className="cc-form-row-pair">
          <div className="cc-form-row">
            <label className="cc-form-label">Follow-up Date</label>
            <input type="date" className="cc-form-input" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} />
          </div>
          <div className="cc-form-row">
            <label className="cc-form-label">Business / Project</label>
            <input className="cc-form-input" list="cc-category-list" value={category} onChange={e => setCategory(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <datalist id="cc-category-list">{categories.map(c => <option key={c.id} value={c.name} />)}</datalist>
        <div className="cc-modal-actions">
          <button className="cc-btn cc-btn-outline cc-btn-sm" onClick={onClose}>Cancel</button>
          <button className="cc-btn cc-btn-gold cc-btn-sm" onClick={submit} disabled={!title.trim() || saving}>{saving ? 'Saving…' : 'Save Follow-Up'}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PLANS
// ============================================================================
function PlansTab() {
  const [plans, setPlans] = useState<any[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [showNew, setShowNew] = useState(false);

  const loadPlans = () => fetch('/api/command-center/plans').then(r => r.json()).then((d: any[]) => {
    setPlans(d);
    if (d.length && selected === null) setSelected(d[0].id);
  });
  useEffect(() => { loadPlans(); }, []);

  useEffect(() => {
    if (selected === null) return;
    fetch(`/api/command-center/plans/${selected}`).then(r => r.json()).then(setDetail);
  }, [selected]);

  const toggleStep = async (taskId: number, done: boolean) => {
    if (selected === null) return;
    await fetch(`/api/command-center/plans/${selected}/tasks/${taskId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done }),
    });
    const updated = await fetch(`/api/command-center/plans/${selected}`).then(r => r.json());
    setDetail(updated);
    loadPlans();
  };

  return (
    <>
      <div className="cc-page-head">
        <h1>Plans / Projects</h1>
        <button className="cc-btn cc-btn-gold cc-btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> New Plan</button>
      </div>

      {plans.length === 0 && (
        <div className="cc-card" style={{ padding: 24, textAlign: 'center', color: 'var(--cc-text-faint)', marginBottom: 20 }}>
          Wala ka pang Plans. Sabihin mo lang kay Goldie ang isang plano nang malaman (hal. "Gusto kong ilunch ang X sa [date]...") at i-summarize niya bilang bagong Plan.
        </div>
      )}

      <div className="cc-plans-grid">
        {plans.map(p => (
          <div key={p.id} className={`cc-card cc-plan-card ${selected === p.id ? 'selected' : ''}`} onClick={() => setSelected(p.id)}>
            {p.category && <span className="cc-tag">{p.category}</span>}
            <h4>{p.title}</h4>
            <p className="cc-plan-goal">{p.goal}</p>
            <div className="cc-progress-track"><div className="cc-progress-fill" style={{ width: `${p.progress}%` }} /></div>
            <div className="cc-plan-foot"><span>{p.task_done} / {p.task_total} tasks done</span><strong className="cc-num">{p.deadline ? `Due ${p.deadline}` : 'No deadline set'}</strong></div>
          </div>
        ))}
      </div>

      {detail && (
        <div className="cc-card cc-plan-detail">
          <div className="cc-plan-detail-head">
            <div>
              {detail.category && <span className="cc-tag" style={{ marginBottom: 8 }}>{detail.category}</span>}
              <h2>{detail.title}</h2>
              <div className="cc-plan-detail-meta">
                <div><div className="lbl">Goal</div><div className="val">{detail.goal}</div></div>
                <div><div className="lbl">Deadline</div><div className="val cc-num">{detail.deadline || 'Not set'}</div></div>
                <div><div className="lbl">Progress</div><div className="val cc-num">{detail.progress}%</div></div>
              </div>
            </div>
            <span className="cc-ai-suggest-tag">✨ Goldie-suggested breakdown</span>
          </div>
          <div className="cc-progress-track" style={{ marginBottom: 6 }}><div className="cc-progress-fill" style={{ width: `${detail.progress}%` }} /></div>

          <div className="cc-plan-body-grid">
            <div>
              <div className="cc-panel-head"><h3>Tasks</h3><span className="cc-count">{detail.tasks.filter((t: any) => t.done).length} / {detail.tasks.length} done</span></div>
              <div className="cc-checklist">
                {detail.tasks.map((t: any) => (
                  <div key={t.id} className={`cc-check-row ${t.done ? 'done' : ''}`} style={{ cursor: 'pointer' }} onClick={() => toggleStep(t.id, !t.done)}>
                    <div className="cc-check-box">{t.done ? <Check size={11} /> : null}</div>
                    <span>{t.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="cc-panel-head"><h3>Notes &amp; Decisions</h3></div>
              <div className="cc-notes-block">
                {detail.notes || 'Wala pang notes para sa plan na ito.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <NewPlanModal
          onClose={() => setShowNew(false)}
          onCreated={(newId: number) => { setShowNew(false); setSelected(newId); loadPlans(); }}
        />
      )}
    </>
  );
}

function NewPlanModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [category, setCategory] = useState('');
  const [deadline, setDeadline] = useState('');
  const [notes, setNotes] = useState('');
  const [steps, setSteps] = useState<string[]>(['']);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetch('/api/command-center/categories').then(r => r.json()).then(setCategories); }, []);

  const updateStep = (i: number, value: string) => setSteps(prev => prev.map((s, idx) => idx === i ? value : s));
  const removeStep = (i: number) => setSteps(prev => prev.filter((_, idx) => idx !== i));
  const addStep = () => setSteps(prev => [...prev, '']);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/command-center/plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(), goal: goal.trim() || null, category: category || null,
          deadline: deadline || null, notes: notes.trim() || null,
          tasks: steps.map(s => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      onCreated(data.id);
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="cc-modal-backdrop" onClick={onClose}>
      <div className="cc-card cc-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="cc-modal-head"><h3>New Plan</h3><button className="cc-row-dismiss" onClick={onClose} title="Close"><X size={15} /></button></div>
        <div className="cc-form-row">
          <label className="cc-form-label">Plan Title</label>
          <input className="cc-form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Hal. Solid Suki Card Launch" autoFocus />
        </div>
        <div className="cc-form-row">
          <label className="cc-form-label">Goal</label>
          <input className="cc-form-input" value={goal} onChange={e => setGoal(e.target.value)} placeholder="Ano ang gusto mong makamit" />
        </div>
        <div className="cc-form-row-pair">
          <div className="cc-form-row">
            <label className="cc-form-label">Deadline</label>
            <input type="date" className="cc-form-input" value={deadline} onChange={e => setDeadline(e.target.value)} />
          </div>
          <div className="cc-form-row">
            <label className="cc-form-label">Business / Project</label>
            <input className="cc-form-input" list="cc-category-list" value={category} onChange={e => setCategory(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <datalist id="cc-category-list">{categories.map(c => <option key={c.id} value={c.name} />)}</datalist>
        <div className="cc-form-row">
          <label className="cc-form-label">Steps</label>
          <div className="cc-form-steps">
            {steps.map((s, i) => (
              <div className="cc-form-step-row" key={i}>
                <input className="cc-form-input" value={s} onChange={e => updateStep(i, e.target.value)} placeholder={`Step ${i + 1}`} />
                {steps.length > 1 && <button className="cc-form-step-remove" onClick={() => removeStep(i)} title="Remove step"><X size={13} /></button>}
              </div>
            ))}
            <button className="cc-form-add-step" onClick={addStep}>+ Add another step</button>
          </div>
        </div>
        <div className="cc-form-row">
          <label className="cc-form-label">Notes</label>
          <textarea className="cc-form-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
        </div>
        <div className="cc-modal-actions">
          <button className="cc-btn cc-btn-outline cc-btn-sm" onClick={onClose}>Cancel</button>
          <button className="cc-btn cc-btn-gold cc-btn-sm" onClick={submit} disabled={!title.trim() || saving}>{saving ? 'Saving…' : 'Save Plan'}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CALENDAR (simple upcoming-dates list — no full grid widget in V1)
// ============================================================================
function CalendarTab() {
  const [items, setItems] = useState<{ date: string; label: string; kind: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/command-center/tasks').then(r => r.json()),
      fetch('/api/command-center/follow-ups').then(r => r.json()),
      fetch('/api/command-center/plans').then(r => r.json()),
      fetch('/api/command-center/reminders').then(r => r.json()),
    ]).then(([tasks, followups, plans, reminders]) => {
      const rows: { date: string; label: string; kind: string }[] = [];
      tasks.forEach((t: any) => { if (t.due_date) rows.push({ date: t.due_date, label: t.title, kind: 'Task' }); });
      followups.forEach((f: any) => { if (f.follow_up_date) rows.push({ date: f.follow_up_date, label: f.title, kind: 'Follow-Up' }); });
      plans.forEach((p: any) => { if (p.deadline) rows.push({ date: p.deadline, label: p.title, kind: 'Plan Deadline' }); });
      // Only one-time reminders have a single date to place on the calendar —
      // daily/weekly/monthly ones repeat and are listed on the Dashboard instead.
      reminders.forEach((r: any) => { if (r.recurrence === 'once' && r.remind_date) rows.push({ date: r.remind_date, label: r.title, kind: 'Reminder' }); });
      rows.sort((a, b) => a.date.localeCompare(b.date));
      setItems(rows);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="cc-placeholder-screen"><div className="cc-placeholder-inner"><h3>Loading…</h3></div></div>;

  const grouped = items.reduce<Record<string, typeof items>>((acc, it) => {
    (acc[it.date] ||= []).push(it);
    return acc;
  }, {});

  return (
    <>
      <div className="cc-page-head"><h1>Calendar</h1></div>
      {Object.keys(grouped).length === 0 && (
        <div className="cc-card" style={{ padding: 24, textAlign: 'center', color: 'var(--cc-text-faint)' }}>Walang naka-schedule na dates.</div>
      )}
      <div className="cc-card cc-panel">
        <div className="cc-rowlist">
          {Object.entries(grouped).map(([date, rows]) => (
            <div key={date} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cc-text-faint)', textTransform: 'uppercase', letterSpacing: .3, padding: '6px 6px 2px 6px' }}>{date}</div>
              {rows.map((r, i) => (
                <Row key={i} title={r.label} sub={r.kind} time="" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ============================================================================
// SETTINGS (category / tag manager)
// ============================================================================
function SettingsTab({ showToast }: { showToast: (m: string) => void }) {
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [newName, setNewName] = useState('');

  const load = () => fetch('/api/command-center/categories').then(r => r.json()).then(setCategories);
  useEffect(() => { load(); }, []);

  const addCategory = async () => {
    const name = newName.trim();
    if (!name) return;
    const res = await fetch('/api/command-center/categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (res.ok) { setNewName(''); load(); }
    else { const d = await res.json(); showToast(d.error || 'Hindi na-add.'); }
  };

  const deleteCategory = async (id: number) => {
    await fetch(`/api/command-center/categories/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <>
      <div className="cc-page-head"><h1>Settings</h1></div>
      <div className="cc-card" style={{ padding: 20, maxWidth: 480 }}>
        <h3 style={{ marginBottom: 4 }}>Business / Project Tags</h3>
        <p style={{ fontSize: 12.5, color: 'var(--cc-text-muted)', marginBottom: 14 }}>Ito ang mga tag na magagamit para i-categorize ang tasks, reminders, follow-ups, at plans.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {categories.map(c => (
            <span key={c.id} className="cc-tag" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px' }}>
              {c.name}
              <button onClick={() => deleteCategory(c.id)} style={{ display: 'flex', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cc-text-faint)' }}><X size={12} /></button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text" value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCategory(); }}
            placeholder="Bagong tag..."
            style={{ flex: 1, border: '1px solid var(--cc-border)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}
          />
          <button className="cc-btn cc-btn-gold cc-btn-sm" onClick={addCategory}><Plus size={14} /> Add</button>
        </div>
      </div>
    </>
  );
}

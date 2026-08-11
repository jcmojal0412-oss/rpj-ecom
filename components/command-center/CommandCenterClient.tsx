'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, MessageSquare, ListChecks, Clock, FolderKanban, CalendarClock,
  CheckCircle2, Settings as SettingsIcon, AlertTriangle,
  Mic, Send, Sun, Moon, Check,
} from 'lucide-react';
import './command-center.css';

// ============================================================================
// Command Center — STEP 1 UI mockup ported into the real app so voice-command
// testing works on a real top-level page (the browser blocks mic permission
// inside the sandboxed Artifact preview). No database yet — everything here
// is still demo/local state, same as the artifact. Owner-only (see
// middleware.ts '/command-center' -> '_owner' and Sidebar.tsx's owner-only
// block). Real backend (tasks/reminders/follow-ups/plans tables, real AI
// parsing) comes only after the design itself is approved.
// ============================================================================

type TabKey = 'dashboard' | 'secretary' | 'tasks' | 'followups' | 'plans' | 'calendar' | 'completed' | 'settings';

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'secretary', label: 'AI Secretary', icon: MessageSquare },
  { key: 'tasks', label: 'My Tasks', icon: ListChecks },
  { key: 'followups', label: 'Follow-Ups', icon: Clock },
  { key: 'plans', label: 'Plans', icon: FolderKanban },
  { key: 'calendar', label: 'Calendar', icon: CalendarClock },
  { key: 'completed', label: 'Completed', icon: CheckCircle2 },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

interface PreviewCard {
  id: string;
  type: string;
  rows: [string, string][];
  warn?: string;
  mode: 'confirm' | 'auto';
  listLabel: string;
  status: 'pending' | 'saved' | 'undone';
}
interface ChatMsg {
  id: string;
  role: 'user' | 'ai';
  text: string;
  previews?: PreviewCard[];
}

let uid = 0;
const nextId = () => `m${Date.now()}_${uid++}`;

const SEED_MESSAGES: ChatMsg[] = [
  { id: nextId(), role: 'user', text: 'Every Thursday may Bodega ni Suki Flash Sale. Remind me Wednesday to check the tarp and Thursday morning to check the team.' },
  {
    id: nextId(), role: 'ai', text: 'Got it, boss! Gagawa ako ng dalawang recurring reminders para dyan:',
    previews: [
      { id: nextId(), type: '🔁 Recurring Reminder', rows: [['Task', 'Check the tarp'], ['Recurs', 'Every Wednesday'], ['Category', 'Bodega ni Suki']], mode: 'confirm', listLabel: 'Reminders', status: 'pending' },
      { id: nextId(), type: '🔁 Recurring Reminder', rows: [['Task', 'Check the team'], ['Recurs', 'Every Thursday, morning'], ['Category', 'Bodega ni Suki']], mode: 'confirm', listLabel: 'Reminders', status: 'pending' },
    ],
  },
  { id: nextId(), role: 'user', text: 'Follow up J&T after 3 days.' },
  {
    id: nextId(), role: 'ai', text: "Noted. I'll set a follow-up 3 days from today:",
    previews: [
      { id: nextId(), type: '📞 Follow-Up', rows: [['Item', 'J&T Complaint'], ['Follow-up on', 'August 14, 2026'], ['Priority', 'Normal'], ['Category', 'Operations']], mode: 'confirm', listLabel: 'Follow-Ups', status: 'pending' },
    ],
  },
  { id: nextId(), role: 'user', text: 'Need matapos Solid Suki Card this week.' },
  {
    id: nextId(), role: 'ai', text: 'Sige boss — pero hindi ako sigurado sa specific na araw. Paki-confirm bago ko i-save:',
    previews: [
      { id: nextId(), type: '✅ Task', rows: [['Task', 'Finish Solid Suki Card'], ['Due', 'This week'], ['Priority', 'High'], ['Category', 'Bodega ni Suki']], warn: 'Hindi sigurado ang exact date — "this week" pa lang. Pili ng specific date bago i-confirm.', mode: 'confirm', listLabel: 'Task List', status: 'pending' },
    ],
  },
];

// Single source of truth for "today" so the Dashboard tab and the AI
// Secretary's "what's my schedule today" answer never disagree. Still demo
// data (no DB yet) — once the real backend exists this becomes a live query
// instead of a constant.
const TODAY_SNAPSHOT = {
  today: 6, urgent: 2, overdue: 3, followups: 3, completed: 4,
  topPriorities: [
    { title: 'Approve marketing creative for Flash Sale', sub: 'Bodega ni Suki', time: '2:00 PM' },
    { title: 'Follow up supplier for quotation', sub: 'SEDO', time: '10:00 AM' },
    { title: 'Review Bodega Thursday Sale prep', sub: 'Bodega ni Suki', time: '4:00 PM' },
    { title: 'Check tarp for Thursday sale', sub: 'Bodega ni Suki', time: 'Tomorrow' },
    { title: 'Reply to financing application update', sub: 'Finance', time: 'EOD' },
  ],
  meetingsToday: [{ title: 'SEDO Partners check-in call', time: '11:00 AM' }],
};

// Very simple keyword heuristic — same "not real AI yet" caveat as
// parseMessage() below. Distinguishes "what's my schedule today" (a
// question, answer from existing data) from "remind me to check the
// schedule" (a command, should create something).
function isScheduleQuery(msg: string) {
  const lower = msg.toLowerCase();
  const questionCue = /\?|^(ano|what|how many|magkano|ilan|paano)\b/.test(lower);
  const topicCue = /(schedule|task|priorit|meeting|today|ngayon|agenda)/.test(lower);
  const commandCue = /remind|paalala|follow.?up|sundan|add|move|done|finish|matapos/.test(lower);
  return questionCue && topicCue && !commandCue;
}

function buildScheduleAnswer() {
  const s = TODAY_SNAPSHOT;
  const top = s.topPriorities[0];
  const meeting = s.meetingsToday[0];
  const text = `Ngayong araw, boss: ${s.today} tasks, ${s.urgent} urgent, ${s.overdue} overdue, ${s.followups} follow-ups na naghihintay. Pinaka-priority: "${top.title}" (${top.sub}) — ${top.time}.` +
    (meeting ? ` May meeting ka rin: ${meeting.title}, ${meeting.time}.` : '');
  const spoken = `You have ${s.today} tasks today, boss — ${s.urgent} urgent, ${s.overdue} overdue. Top priority: ${top.title}, at ${top.time}.` +
    (meeting ? ` You also have a meeting: ${meeting.title}, at ${meeting.time}.` : '');
  return { text, spoken };
}

function parseMessage(msg: string) {
  const lower = msg.toLowerCase();
  let type = '✅ Task', priority = 'Normal', due: string, unsure = false;

  if (/paalala|remind/.test(lower)) type = '⏰ Reminder';
  if (/follow.?up|sundan/.test(lower)) type = '📞 Follow-Up';
  if (/every|kada|linggo-linggo|araw-araw/.test(lower)) type = '🔁 Recurring ' + type.split(' ').slice(1).join(' ');
  if (/urgent|high priority/.test(lower)) priority = 'High';
  if (/asap|ngayon din/.test(lower)) priority = 'Urgent';

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const found = days.find(d => lower.includes(d));
  if (lower.includes('tomorrow') || lower.includes('bukas')) due = 'Tomorrow';
  else if (lower.includes('today') || lower.includes('ngayon')) due = 'Today';
  else if (found) due = found[0].toUpperCase() + found.slice(1);
  else if (lower.includes('this week')) { due = 'This week'; unsure = true; }
  else { due = 'Not specified'; unsure = true; }

  const timeMatch = lower.match(/(\d{1,2})\s?(am|pm)/);
  if (timeMatch) due += ', ' + timeMatch[0].toUpperCase();

  const listLabel = type.includes('Reminder') ? 'Reminders' : type.includes('Follow-Up') ? 'Follow-Ups' : 'Task List';
  return { type, priority, due, unsure, listLabel };
}

// Browsers ship several TTS voices (locally installed OS voices, plus
// higher-quality "Natural"/"Neural"/"Online" ones on Edge/Chrome) but
// default to whichever is first alphabetically, which is usually the
// flattest-sounding one. No Filipino voice reads Tagalog cleanly on most
// browsers, so spoken replies are English (see speak() call sites below) —
// the AI still writes in Taglish in the chat, only what it SAYS out loud is
// English. Picking a better voice here is free — a real natural Filipino
// voice, consistent across every device, needs a paid TTS API wired in on
// the backend later, not this client-only mockup.
let cachedVoices: SpeechSynthesisVoice[] = [];
function refreshVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  cachedVoices = window.speechSynthesis.getVoices();
}
// Known pleasant-sounding female English voice names across platforms —
// Samantha (Safari/macOS/iOS, the closest thing to "Siri's voice" exposed
// to the web), Zira/Aria/Jenny (Windows/Edge), Google US English (Chrome,
// female by default).
const FEMALE_VOICE_NAMES = /samantha|zira|aria|jenny|susan|female|google us english|karen|moira|tessa/i;
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
    utter.rate = 1.0;
    utter.pitch = 1.05;
    window.speechSynthesis.speak(utter);
  } catch { /* speech synthesis unavailable — silent no-op, text reply still shown */ }
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

  return (
    <div className="cc-root">
      <div className="cc-preview-pill"><span className="cc-dot" />UI Mockup — Step 1 · no live data yet, testing voice on the real page</div>

      <div className="cc-tabs">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} className={`cc-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'dashboard' && <DashboardTab showToast={showToast} />}
      {tab === 'secretary' && <SecretaryTab showToast={showToast} />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'followups' && <FollowUpsTab showToast={showToast} />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'calendar' && <Placeholder icon={CalendarClock} title="Calendar view" desc="Meetings and due dates from Tasks, Reminders and Follow-Ups will appear here in one monthly view once the backend is built." />}
      {tab === 'completed' && <Placeholder icon={CheckCircle2} title="Completed history" desc={'A full, filterable log of everything you’ve finished — same list style as "Completed Today" on the Dashboard, extended to any date range.'} />}
      {tab === 'settings' && <Placeholder icon={SettingsIcon} title="Settings" desc="Manage your Business / Project tags (Bodega ni Suki, SEDO, RPJ, Personal, Marketing, Finance, Operations) and notification preferences here." />}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)',
          background: '#221F1A', color: '#F3F1EA', padding: '11px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 500, boxShadow: '0 8px 24px rgba(0,0,0,.25)', zIndex: 50,
        }}>{toast}</div>
      )}
    </div>
  );
}

function Placeholder({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="cc-placeholder-screen">
      <div className="cc-placeholder-inner">
        <div className="cc-ph-icon"><Icon size={22} /></div>
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
    </div>
  );
}

// ============================================================================
// DASHBOARD
// ============================================================================
function DashboardTab({ showToast }: { showToast: (m: string) => void }) {
  return (
    <>
      <div className="cc-dash-head">
        <div>
          <h1>Good Morning, Boss</h1>
          <p className="cc-date">{new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="cc-dash-actions">
          <button className="cc-btn cc-btn-outline" onClick={() => showToast('Morning Brief generated (mockup)')}><Sun size={15} /> Generate Morning Brief</button>
          <button className="cc-btn cc-btn-gold" onClick={() => showToast('End of Day review opened (mockup)')}><Moon size={15} /> End My Day</button>
        </div>
      </div>

      <div className="cc-kpi-row">
        <Kpi cls="cc-kpi-today" icon={<LayoutDashboard size={15} />} value={String(TODAY_SNAPSHOT.today)} label="Today" />
        <Kpi cls="cc-kpi-urgent" icon={<AlertTriangle size={15} />} value={String(TODAY_SNAPSHOT.urgent)} label="Urgent" />
        <Kpi cls="cc-kpi-overdue" icon={<Clock size={15} />} value={String(TODAY_SNAPSHOT.overdue)} label="Overdue" />
        <Kpi cls="cc-kpi-followup" icon={<MessageSquare size={15} />} value={String(TODAY_SNAPSHOT.followups)} label="Follow-Ups" />
        <Kpi cls="cc-kpi-done" icon={<CheckCircle2 size={15} />} value={String(TODAY_SNAPSHOT.completed)} label="Completed" />
      </div>

      <div className="cc-attn-box">
        <div className="cc-attn-head"><AlertTriangle size={17} /><h3>CEO Attention Needed</h3><span>2 decisions waiting</span></div>
        <div className="cc-attn-list">
          <div className="cc-attn-item">
            <div><p>Approve ₱10,000 marketing budget for Bodega Flash Sale</p><span className="cc-attn-tag">Bodega ni Suki · Marketing</span></div>
            <a onClick={() => showToast('Decision view (mockup)')}>Decide →</a>
          </div>
          <div className="cc-attn-item">
            <div><p>Choose final loyalty card design — Solid Suki Card</p><span className="cc-attn-tag">Bodega ni Suki · Plans</span></div>
            <a onClick={() => showToast('Decision view (mockup)')}>Decide →</a>
          </div>
        </div>
      </div>

      <div className="cc-dash-grid">
        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Top 5 Priorities Today</h3><span className="cc-count">{TODAY_SNAPSHOT.topPriorities.length}</span></div>
          <div className="cc-rowlist">
            {TODAY_SNAPSHOT.topPriorities.map((p, i) => (
              <Row key={p.title} rank={i + 1} title={p.title} sub={p.sub} time={p.time} />
            ))}
          </div>
        </div>

        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Overdue</h3><span className="cc-count">3</span></div>
          <div className="cc-rowlist">
            <Row dot="urgent" overdue title="Print Solid Suki Card samples" sub="Bodega ni Suki" time="Aug 9" />
            <Row dot="high" overdue title="Review weekly priorities" sub="Personal" time="Aug 10" />
            <Row dot="high" overdue title="Respond to J&T complaint" sub="Operations" time="Aug 9" />
          </div>
        </div>

        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Tasks Due Today</h3><span className="cc-count">6</span></div>
          <div className="cc-rowlist">
            <Row dot="urgent" title="Approve marketing creative" sub="Bodega ni Suki" time="2:00 PM" />
            <Row dot="high" title="Follow up supplier" sub="SEDO" time="10:00 AM" />
            <Row dot="normal" title="Update product catalog draft" sub="RPJ" time="3:30 PM" />
          </div>
        </div>

        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Follow-Ups Waiting</h3><span className="cc-count">3</span></div>
          <div className="cc-rowlist">
            <Row title="J&T Complaint" sub="Waiting for response" time="Aug 14" />
            <Row title="Supplier Quotation" sub="Waiting" time="Tomorrow" />
            <Row title="Financing Application" sub="Waiting for approval" time="Aug 18" />
          </div>
        </div>

        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Meetings / Calendar</h3><span className="cc-count">1</span></div>
          <div className="cc-rowlist">
            <Row title="SEDO Partners check-in call" sub="Video call" time="11:00 AM" />
          </div>
        </div>

        <div className="cc-card cc-panel">
          <div className="cc-panel-head"><h3>Completed Today</h3><span className="cc-count">4</span></div>
          <div className="cc-rowlist">
            <Row done title="Post Bodega Flash Sale teaser" sub="Marketing" time="9:10 AM" />
            <Row done title="Pay Meralco bill" sub="Personal" time="8:45 AM" />
            <Row done title="Confirm SEDO call schedule" sub="SEDO" time="8:20 AM" />
          </div>
        </div>
      </div>
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

function Row({ rank, dot, title, sub, time, done, overdue }: {
  rank?: number; dot?: 'urgent' | 'high' | 'normal' | 'low'; title: string; sub: string; time: string; done?: boolean; overdue?: boolean;
}) {
  return (
    <div className={`cc-item-row ${done ? 'done' : ''} ${overdue ? 'overdue' : ''}`}>
      {rank && <span className="cc-item-rank">{rank}</span>}
      {dot && <span className={`cc-pdot ${dot}`} />}
      <div className="cc-item-title"><strong>{title}</strong><span className="cc-item-sub">{sub}</span></div>
      <span className="cc-item-time cc-num">{time}</span>
    </div>
  );
}

// ============================================================================
// AI SECRETARY
// ============================================================================
function SecretaryTab({ showToast }: { showToast: (m: string) => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>(SEED_MESSAGES);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const recognizerRef = useRef<any>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages]);

  const updatePreview = (msgId: string, previewId: string, status: PreviewCard['status']) => {
    setMessages(prev => prev.map(m =>
      m.id === msgId && m.previews
        ? { ...m, previews: m.previews.map(p => p.id === previewId ? { ...p, status } : p) }
        : m
    ));
  };

  const process = (text: string, viaVoice: boolean) => {
    const userMsg: ChatMsg = { id: nextId(), role: 'user', text };
    setMessages(prev => [...prev, userMsg]);

    setTimeout(() => {
      if (isScheduleQuery(text)) {
        const { text: answer, spoken } = buildScheduleAnswer();
        const aiMsg: ChatMsg = { id: nextId(), role: 'ai', text: answer };
        setMessages(prev => [...prev, aiMsg]);
        if (viaVoice) speak(spoken);
        return;
      }

      const p = parseMessage(text);
      const rows: [string, string][] = [
        ['Task', text.length > 46 ? text.slice(0, 46) + '…' : text],
        ['Due', p.due],
        ['Priority', p.priority],
        ['Category', 'Uncategorized'],
      ];

      if (viaVoice && !p.unsure) {
        const aiMsg: ChatMsg = {
          id: nextId(), role: 'ai', text: 'Naitala ko na, boss — diretso ko nang idinagdag:',
          previews: [{ id: nextId(), type: p.type, rows, mode: 'auto', listLabel: p.listLabel, status: 'saved' }],
        };
        setMessages(prev => [...prev, aiMsg]);
        speak(`Added to your ${p.listLabel}, boss. ${rows[0][1]}, due ${p.due}.`);
      } else {
        const aiMsg: ChatMsg = {
          id: nextId(), role: 'ai',
          text: p.unsure ? 'Naintindihan ko, boss — pero paki-confirm muna itong detail bago ko i-save:' : 'Narito ang na-detect ko, paki-check bago ma-save:',
          previews: [{ id: nextId(), type: p.type, rows, warn: p.unsure ? 'Hindi sigurado ang exact date/time — paki-confirm o i-edit muna.' : undefined, mode: 'confirm', listLabel: p.listLabel, status: 'pending' }],
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

    if (listening) { recognizerRef.current?.stop(); return; }

    try {
      const recognizer = new Ctor();
      recognizerRef.current = recognizer;
      recognizer.lang = 'fil-PH';
      recognizer.interimResults = true;
      recognizer.continuous = false;

      let finalTranscript = '';
      recognizer.onstart = () => setListening(true);
      recognizer.onresult = (e: any) => {
        const transcript = Array.from(e.results as any).map((r: any) => r[0].transcript).join(' ');
        finalTranscript = transcript;
        setInput(transcript);
      };
      recognizer.onerror = (e: any) => {
        showToast(e.error === 'not-allowed'
          ? 'Mic access blocked — check your browser mic permission for this site.'
          : 'Voice command error: ' + e.error);
      };
      recognizer.onend = () => {
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

  const confirm = (msgId: string, previewId: string) => { updatePreview(msgId, previewId, 'saved'); showToast('Saved (mockup preview)'); };
  const dismiss = () => showToast('Edit / Cancel — wired up once backend is approved');
  const undo = (msgId: string, previewId: string) => { updatePreview(msgId, previewId, 'undone'); showToast('Inalis sa list (mockup)'); speak('Okay boss, I removed that.'); };

  return (
    <div className="cc-secretary-wrap">
      <div className="cc-card cc-chat-card">
        <div className="cc-chat-head">
          <span className="cc-dotlive" />
          <div><h3>Ask your AI Secretary</h3><p>Nag-uunawa ng Taglish · Bawat gawa ay may confirmation bago ma-save</p></div>
        </div>

        <div className="cc-chat-body" ref={bodyRef}>
          {messages.map(m => (
            <div key={m.id} className={`cc-bubble-row ${m.role === 'user' ? 'user' : 'ai'}`}>
              <div className="cc-bubble-avatar">{m.role === 'user' ? 'JC' : 'AI'}</div>
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
                        <button className="cc-pc-btn cancel" onClick={dismiss}>Cancel</button>
                        <button className="cc-pc-btn" onClick={dismiss}>Edit</button>
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
              </div>
            </div>
          ))}
        </div>

        {listening && <div className="cc-mic-status show"><span className="cc-live-dot" />Listening... magsalita ka na, boss</div>}
        <div className="cc-chat-input-bar">
          <button className={`cc-mic-btn ${listening ? 'listening' : ''}`} onClick={toggleMic} title="Voice command"><Mic size={17} /></button>
          <textarea
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
            <button className="cc-chip" onClick={() => setInput('Add this to September Marketing Plan.')}>&quot;Add this to September Marketing Plan.&quot;</button>
            <button className="cc-chip" onClick={() => setInput('High priority ito.')}>&quot;High priority ito.&quot;</button>
            <button className="cc-chip" onClick={() => setInput('Move this task to Friday.')}>&quot;Move this task to Friday.&quot;</button>
            <button className="cc-chip" onClick={() => setInput('Done na ito.')}>&quot;Done na ito.&quot;</button>
          </div>
        </div>
        <div className="cc-card">
          <h4>AI detects</h4>
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
const TASK_ROWS: { dot: 'urgent' | 'high' | 'normal' | 'low'; title: string; desc?: string; tag: string; due: string; status: 'To Do' | 'In Progress' | 'Waiting' | 'Completed' }[] = [
  { dot: 'urgent', title: 'Approve marketing creative for Flash Sale', desc: 'Final review before Thursday launch', tag: 'Bodega ni Suki', due: 'Today, 2:00 PM', status: 'In Progress' },
  { dot: 'high', title: 'Follow up supplier for quotation', tag: 'SEDO', due: 'Today, 10:00 AM', status: 'To Do' },
  { dot: 'high', title: 'Check tarp for Thursday sale', tag: 'Bodega ni Suki', due: 'Wed, Aug 12', status: 'To Do' },
  { dot: 'normal', title: 'Review weekly priorities', tag: 'Personal', due: 'Mon, Aug 10', status: 'Waiting' },
  { dot: 'normal', title: 'Finalize Solid Suki Card design', tag: 'Bodega ni Suki', due: 'This Week', status: 'Waiting' },
  { dot: 'low', title: 'Update product catalog', tag: 'RPJ', due: 'Fri, Aug 14', status: 'To Do' },
  { dot: 'low', title: 'Post Bodega Flash Sale teaser', tag: 'Marketing', due: 'Today, 9:10 AM', status: 'Completed' },
];
const STATUS_CLASS: Record<string, string> = { 'To Do': 'cc-status-todo', 'In Progress': 'cc-status-progress', 'Waiting': 'cc-status-waiting', 'Completed': 'cc-status-done' };

function TasksTab() {
  const [filter, setFilter] = useState('Today');
  return (
    <>
      <div className="cc-page-head">
        <h1>My Tasks</h1>
        <button className="cc-btn cc-btn-gold cc-btn-sm">+ New Task</button>
      </div>
      <div className="cc-filter-row">
        {['Today', 'Tomorrow', 'This Week', 'Overdue', 'Completed'].map(f => (
          <button key={f} className={`cc-filter-pill ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
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
              {TASK_ROWS.map((r, i) => (
                <tr key={i}>
                  <td>
                    <div className="cc-task-title-cell">
                      <span className={`cc-pdot ${r.dot}`} />
                      <div><strong>{r.title}</strong>{r.desc && <div style={{ fontSize: 11.5, color: 'var(--cc-text-faint)', marginTop: 2 }}>{r.desc}</div>}</div>
                    </div>
                  </td>
                  <td><span className="cc-tag">{r.tag}</span></td>
                  <td className="cc-num">{r.due}</td>
                  <td><span className={`cc-status-badge ${STATUS_CLASS[r.status]}`}>{r.status}</span></td>
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
  const items = [
    { title: 'Loyalty Card Printer Quotation', status: 'Waiting for reply · SEDO Prints', tag: 'Bodega ni Suki', due: 'Aug 9 · Overdue', overdue: true },
    { title: 'J&T Complaint', status: 'Waiting for response', tag: 'Operations', due: 'Aug 14', overdue: false },
    { title: 'Supplier Quotation', status: 'Waiting', tag: 'SEDO', due: 'Tomorrow', overdue: false },
    { title: 'Financing Application', status: 'Waiting for approval', tag: 'Finance', due: 'Aug 18', overdue: false },
  ];
  return (
    <>
      <div className="cc-page-head">
        <h1>Waiting / Follow-Ups</h1>
        <button className="cc-btn cc-btn-gold cc-btn-sm">+ New Follow-Up</button>
      </div>
      <div className="cc-overdue-banner"><AlertTriangle size={16} />1 follow-up is overdue and needs your attention</div>
      <div className="cc-followup-grid">
        {items.map((it, i) => (
          <div key={i} className={`cc-card cc-followup-card ${it.overdue ? 'is-overdue' : ''}`}>
            <div className="cc-fu-main">
              <div className="cc-fu-icon"><Clock size={16} /></div>
              <div><p className="cc-fu-title">{it.title}</p><p className="cc-fu-status">{it.status}</p></div>
            </div>
            <div className="cc-fu-meta">
              <span className="cc-tag">{it.tag}</span>
              <div className="cc-fu-date"><div className="lbl">Follow-up</div><div className="val">{it.due}</div></div>
              <button className="cc-btn cc-btn-outline cc-btn-sm" onClick={() => showToast('Marked as followed up (mockup)')}>Mark Followed Up</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ============================================================================
// PLANS
// ============================================================================
const PLANS = [
  {
    key: 'solid-suki', tag: 'Bodega ni Suki', title: 'Solid Suki Card Launch', goal: 'Launch Solid Suki Card by August 30',
    progress: 29, done: 2, total: 7, deadline: 'Aug 30',
    tasks: [
      { label: 'Finalize card design', done: true }, { label: 'Print cards', done: true },
      { label: 'Test registration', active: true }, { label: 'Train staff' },
      { label: 'Prepare store materials' }, { label: 'Customer announcement' }, { label: 'Launch' },
    ],
    notes: 'Card printer quote pending from SEDO Prints — awaiting your approval before printing 500 units.',
    notes2: 'Staff training tentatively set for Aug 22, after store materials arrive.',
  },
  { key: 'sept-marketing', tag: 'Bodega ni Suki', title: 'September Marketing', goal: 'Plan and launch September promo campaign', progress: 40, done: 4, total: 10, deadline: 'Sep 30' },
  { key: 'q3-ops', tag: 'RPJ', title: 'Q3 Operations Review', goal: 'Review inventory + purchase order workflow', progress: 70, done: 7, total: 10, deadline: 'Sep 15' },
];

function PlansTab() {
  const [selected, setSelected] = useState('solid-suki');
  const plan = PLANS.find(p => p.key === selected) ?? PLANS[0];
  return (
    <>
      <div className="cc-page-head">
        <h1>Plans / Projects</h1>
        <button className="cc-btn cc-btn-gold cc-btn-sm">+ New Plan</button>
      </div>

      <div className="cc-plans-grid">
        {PLANS.map(p => (
          <div key={p.key} className={`cc-card cc-plan-card ${selected === p.key ? 'selected' : ''}`} onClick={() => setSelected(p.key)}>
            <span className="cc-tag">{p.tag}</span>
            <h4>{p.title}</h4>
            <p className="cc-plan-goal">{p.goal}</p>
            <div className="cc-progress-track"><div className="cc-progress-fill" style={{ width: `${p.progress}%` }} /></div>
            <div className="cc-plan-foot"><span>{p.done} / {p.total} tasks done</span><strong className="cc-num">Due {p.deadline}</strong></div>
          </div>
        ))}
      </div>

      {plan.tasks && (
        <div className="cc-card cc-plan-detail">
          <div className="cc-plan-detail-head">
            <div>
              <span className="cc-tag" style={{ marginBottom: 8 }}>{plan.tag}</span>
              <h2>{plan.title}</h2>
              <div className="cc-plan-detail-meta">
                <div><div className="lbl">Goal</div><div className="val">{plan.goal}</div></div>
                <div><div className="lbl">Deadline</div><div className="val cc-num">{plan.deadline}, 2026</div></div>
                <div><div className="lbl">Progress</div><div className="val cc-num">{plan.progress}%</div></div>
              </div>
            </div>
            <span className="cc-ai-suggest-tag">✨ AI-suggested breakdown</span>
          </div>
          <div className="cc-progress-track" style={{ marginBottom: 6 }}><div className="cc-progress-fill" style={{ width: `${plan.progress}%` }} /></div>

          <div className="cc-plan-body-grid">
            <div>
              <div className="cc-panel-head"><h3>Tasks</h3><span className="cc-count">{plan.done} / {plan.total} done</span></div>
              <div className="cc-checklist">
                {plan.tasks.map((t, i) => (
                  <div key={i} className={`cc-check-row ${t.done ? 'done' : ''} ${(t as any).active ? 'active-step' : ''}`}>
                    <div className="cc-check-box">{t.done && <Check size={11} />}</div>
                    <span>{t.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="cc-panel-head"><h3>Notes &amp; Decisions</h3></div>
              <div className="cc-notes-block">
                <strong>Important decision:</strong> {plan.notes}
                <br /><br />
                <strong>Note:</strong> {plan.notes2}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

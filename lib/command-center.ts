// Command Center (Goldie) — pure parsing/summarizing logic, no DB/network
// access. Moved out of CommandCenterClient.tsx so the exact same "not real
// AI yet, simple keyword heuristics" logic that was reviewed and approved
// in the Step 1 mockup keeps working unchanged in the real Step 2 app —
// only what happens on Confirm (save to a real row) changed, not how
// messages get understood. See lib/command-center.ts's callers in
// CommandCenterClient.tsx and the API routes under app/api/command-center.

export interface ParsedMessage {
  type: string;
  priority: 'Urgent' | 'High' | 'Normal' | 'Low';
  due: string;
  dueTime: string | null; // 24h "HH:MM", parsed from things like "7:18pm" — null if no time was said
  unsure: boolean;
  listLabel: string;
}

export interface ScheduleSnapshot {
  today: number;
  urgent: number;
  overdue: number;
  followups: number;
  completed: number;
  topPriorities: { title: string; sub: string; time: string }[];
  meetingsToday: { title: string; time: string }[];
}

// A short standalone "Confirm"/"Cancel" said out loud acts on whatever
// preview or plan-summary card is still pending, instead of being parsed as
// a brand-new task titled "confirm".
export const CONFIRM_WORDS = /^(confirm|yes|oo|tama|correct|save|i-?save|sige|go)\.?$/i;
export const CANCEL_WORDS = /^(cancel|no|hindi|huwag)\.?$/i;

// "Narrate a plan, I'll summarize it" — a long, free-flowing message (vs. a
// short one-line command) gets treated as a plan brain-dump instead of a
// single task. Still a simple heuristic, not real understanding: splits on
// connector words/punctuation to fake a "goal + steps" breakdown. Real
// summarization would need a real AI parsing pass — the owner explicitly
// chose to keep this free heuristic instead for V1 (see plan doc).
const PLAN_CONNECTORS = /\b(?:tapos|then|after that|after|saka|dagdag|also|next|kailangan|need|una|first|finally|lastly)\b/gi;

export function isPlanNarration(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const connectorHits = (text.match(PLAN_CONNECTORS) || []).length;
  // A plan narration is a multi-step brain-dump — it needs actual connector
  // words joining separate steps ("tapos", "kailangan", ...), not just raw
  // length. A long-but-single-idea message (e.g. a wordy "remind me at
  // 7:18pm today please" with pleasantries) has zero connectors and should
  // stay a normal Task/Reminder, not get misrouted into Plans.
  return connectorHits >= 2 || (connectorHits >= 1 && words.length > 30);
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function detectDeadline(text: string): { deadline: string; unsure: boolean } {
  const lower = text.toLowerCase();

  const monthMatch = lower.match(new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'));
  if (monthMatch) {
    const month = monthMatch[1].charAt(0).toUpperCase() + monthMatch[1].slice(1);
    return { deadline: `${month} ${monthMatch[2]}`, unsure: false };
  }
  if (lower.includes('tomorrow') || lower.includes('bukas')) return { deadline: 'Tomorrow', unsure: false };

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const foundDay = days.find(d => lower.includes(d));
  if (foundDay) return { deadline: foundDay.charAt(0).toUpperCase() + foundDay.slice(1), unsure: false };

  if (/end of (the )?month/.test(lower)) return { deadline: 'End of the month', unsure: false };
  if (lower.includes('next week')) return { deadline: 'Next week', unsure: true };
  if (lower.includes('this week')) return { deadline: 'This week', unsure: true };

  return { deadline: 'Not specified', unsure: true };
}

export function buildPlanSummary(text: string): { goal: string; steps: string[]; deadline: string; deadlineUnsure: boolean } {
  const segments = text
    .split(new RegExp(`[.,;]|${PLAN_CONNECTORS.source}`, 'gi'))
    .map(s => s.trim())
    .filter(s => s.length > 3)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1));

  const goal = segments[0] || text.trim();
  const steps = segments.slice(1, 8);
  const { deadline, unsure: deadlineUnsure } = detectDeadline(text);
  return {
    goal, deadline, deadlineUnsure,
    steps: steps.length ? steps : ['(Magbigay ng mas maraming detalye para sa mas mahabang breakdown)'],
  };
}

export function parseMessage(msg: string): ParsedMessage {
  const lower = msg.toLowerCase();
  let type = '✅ Task', priority: ParsedMessage['priority'] = 'Normal', due: string, unsure = false;

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

  // Handles both "7pm" / "10 AM" and colon times like "7:18pm" — the old
  // regex ignored the ":18" part entirely and mistakenly read the minutes
  // as the hour (e.g. "7:18 pm" -> "18 PM"). dueTime is stored in 24h
  // "HH:MM" for the actual due_date/remind_date row; `due` keeps the
  // human-readable label shown in the preview card.
  let dueTime: string | null = null;
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s?(am|pm)/);
  if (timeMatch) {
    const minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
    let hour = Number(timeMatch[1]);
    const ampm = timeMatch[3];
    due += `, ${timeMatch[1]}${timeMatch[2] ? ':' + timeMatch[2] : ''}${ampm.toUpperCase()}`;
    if (ampm === 'pm' && hour !== 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    dueTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const listLabel = type.includes('Reminder') ? 'Reminders' : type.includes('Follow-Up') ? 'Follow-Ups' : 'Task List';
  return { type, priority, due, dueTime, unsure, listLabel };
}

// Very simple keyword heuristic — same "not real AI yet" caveat as
// parseMessage() above. Distinguishes "what's my schedule today" (a
// question, answer from existing data) from "remind me to check the
// schedule" (a command, should create something).
export function isScheduleQuery(msg: string): boolean {
  const lower = msg.toLowerCase();
  const questionCue = /\?|^(ano|what|how many|magkano|ilan|paano)\b/.test(lower);
  const topicCue = /(schedule|task|priorit|meeting|today|ngayon|agenda)/.test(lower);
  const commandCue = /remind|paalala|follow.?up|sundan|add|move|done|finish|matapos/.test(lower);
  return questionCue && topicCue && !commandCue;
}

export function buildScheduleAnswer(s: ScheduleSnapshot): { text: string; spoken: string } {
  const top = s.topPriorities[0];
  const meeting = s.meetingsToday[0];
  const text = top
    ? `Ngayong araw, boss: ${s.today} tasks, ${s.urgent} urgent, ${s.overdue} overdue, ${s.followups} follow-ups na naghihintay. Pinaka-priority: "${top.title}" (${top.sub}) — ${top.time}.` +
      (meeting ? ` May meeting ka rin: ${meeting.title}, ${meeting.time}.` : '')
    : `Ngayong araw, boss: ${s.today} tasks, ${s.urgent} urgent, ${s.overdue} overdue, ${s.followups} follow-ups na naghihintay. Walang naka-schedule na top priority ngayon.`;
  const spoken = top
    ? `You have ${s.today} tasks today, boss — ${s.urgent} urgent, ${s.overdue} overdue. Top priority: ${top.title}, at ${top.time}.` +
      (meeting ? ` You also have a meeting: ${meeting.title}, at ${meeting.time}.` : '')
    : `You have ${s.today} tasks today, boss — ${s.urgent} urgent, ${s.overdue} overdue.`;
  return { text, spoken };
}

// Converts the parser's *display* due-date labels ("Tomorrow", "Wednesday",
// "This week", "August 30") into a real YYYY-MM-DD to store. `today` should
// be a PH-local Date (see lib/utils.ts's todayISO() convention used
// elsewhere in this app for the same "what does 'today' mean" question).
export function resolveDueDate(dueLabel: string, today: Date): { isoDate: string | null; unsure: boolean } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const label = dueLabel.split(',')[0].trim().toLowerCase(); // strip any ", 10AM" time suffix

  if (label === 'today') return { isoDate: iso(today), unsure: false };
  if (label === 'tomorrow') {
    const d = new Date(today); d.setDate(d.getDate() + 1);
    return { isoDate: iso(d), unsure: false };
  }

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIdx = days.indexOf(label);
  if (dayIdx !== -1) {
    const d = new Date(today);
    const diff = (dayIdx - d.getDay() + 7) % 7 || 7; // next occurrence, never "today" for a named weekday
    d.setDate(d.getDate() + diff);
    return { isoDate: iso(d), unsure: false };
  }

  const monthMatch = label.match(new RegExp(`^(${MONTHS.join('|')})\\s+(\\d{1,2})$`, 'i'));
  if (monthMatch) {
    const monthIdx = MONTHS.indexOf(monthMatch[1].toLowerCase());
    const day = Number(monthMatch[2]);
    let year = today.getFullYear();
    const candidate = new Date(year, monthIdx, day);
    if (candidate < today) year += 1; // a month/day already past this year means next year
    return { isoDate: iso(new Date(year, monthIdx, day)), unsure: false };
  }

  if (label === 'end of the month') {
    const d = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { isoDate: iso(d), unsure: false };
  }

  // "This week" / "Next week" / "Not specified" — genuinely ambiguous,
  // caller should keep due_date null and leave it to the owner to pin down.
  return { isoDate: null, unsure: true };
}

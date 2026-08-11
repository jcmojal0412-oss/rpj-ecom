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

// Turns a rambling raw message ("Hey Goldie please remind me of FB ads
// itse-check ko i will check later at 7:18pm today remind me okay") into a
// short English-leaning title ("Check FB ads") for the saved title — shown
// in the preview card, My Tasks/Reminders list, and what Goldie's alarm
// speaks. This is filler-stripping + a small Tagalog->English word swap,
// NOT real translation or paraphrasing — a true "professional secretary"
// summary needs real AI understanding, which the owner chose to skip for V1
// to avoid a per-message AI cost (see isPlanNarration's comment above and
// the plan doc). Garbled voice-to-text input still needs the Edit button.
const FILLER_PHRASES: RegExp[] = [
  /\bhey goldie\b/gi, /\bhi goldie\b/gi, /\bgoldie\b/gi,
  /\bremind me (?:to|of|about)\b/gi, /\bremind me\b/gi, /\bpaalala\b/gi,
  /\bplease\b/gi, /\bpaki\b/gi, /\bpakisuyo\b/gi, /\bsana\b/gi,
  /\bi will\b/gi, /\bi'll\b/gi, /\bi am going to\b/gi, /\bi'm going to\b/gi,
  /\bokay\b/gi, /\bok\b/gi, /\bsige\b/gi,
  /\blater\b/gi, /\bmamaya\b/gi, /\bmuna\b/gi, /\bna lang\b/gi, /\bnalang\b/gi,
  /\bnaman\b/gi, /\bpo\b/gi, /\bho\b/gi, /\bko(?:ng)?\b/gi, /\bsi\b/gi, /\bito\b/gi,
];

// Common Taglish task verbs -> English, so the result leans English even
// though it's word-substitution, not translation.
const VERB_TRANSLATIONS: [RegExp, string][] = [
  [/\bitse-?check\b/gi, 'Check'], [/\bi-?check\b/gi, 'Check'], [/\btignan\b/gi, 'Check'], [/\bcheck mo\b/gi, 'Check'],
  [/\bgawin\b/gi, 'Do'], [/\btapusin\b/gi, 'Finish'], [/\bayusin\b/gi, 'Fix'],
  [/\btawagan\b/gi, 'Call'], [/\bsagutin\b/gi, 'Reply to'],
  [/\bi-?post\b/gi, 'Post'], [/\bi-?update\b/gi, 'Update'], [/\bi-?send\b/gi, 'Send'], [/\bipadala\b/gi, 'Send'],
  [/\bbayaran\b/gi, 'Pay'],
];

function stripDateTimeMentions(text: string): string {
  return text
    .replace(new RegExp(`\\b(?:on\\s+)?(${MONTHS.join('|')})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi'), ' ')
    .replace(/\btomorrow\b/gi, ' ').replace(/\bbukas\b/gi, ' ')
    .replace(/\btoday\b/gi, ' ').replace(/\bngayon\b/gi, ' ')
    .replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, ' ')
    .replace(/\bend of (?:the )?month\b/gi, ' ')
    .replace(/\b(?:this|next) week\b/gi, ' ')
    .replace(/\b(?:at|ng|sa)?\s*\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi, ' ');
}

export function summarizeTitle(rawText: string): string {
  let out = stripDateTimeMentions(rawText);
  for (const re of FILLER_PHRASES) out = out.replace(re, ' ');
  for (const [re, replacement] of VERB_TRANSLATIONS) out = out.replace(re, replacement);
  out = out.replace(/\s+/g, ' ').trim().replace(/^[-,.\s]+|[-,.\s]+$/g, '');
  // Collapse immediate repeats left over from stripping (e.g. "check ... check")
  out = out.split(' ').filter((w, i, arr) => i === 0 || w.toLowerCase() !== arr[i - 1].toLowerCase()).join(' ');
  if (out.length < 3) out = rawText.trim(); // heuristic over-stripped everything — fall back to the raw text
  return out.charAt(0).toUpperCase() + out.slice(1);
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

// Morning Brief / End of Day Review — deterministic summaries built from
// data the Dashboard already has in memory (no extra API calls). Same
// "free heuristic, not real AI" approach as the rest of this file: a real
// AI-generated executive summary would read more naturally but costs money
// per generation, which the owner chose to avoid (see plan doc / FB Ads
// module). This just narrates the numbers already on screen.
export function buildMorningBrief(input: {
  today: number; urgent: number; overdue: number; followups: number;
  activeReminders: number;
  topPriority?: { title: string; sub: string; time: string };
  overdueItems: { title: string }[];
}, dateLabel: string): { text: string; spoken: string } {
  const overdueList = input.overdueItems.slice(0, 3).map(t => t.title).join(', ');
  const lines: string[] = [`Magandang umaga, boss! Eto ang Morning Brief mo para sa ${dateLabel}:`];
  lines.push(`• ${input.today} task${input.today === 1 ? '' : 's'} ang due ngayon${input.urgent ? ` (${input.urgent} urgent)` : ''}.`);
  if (input.overdue > 0) lines.push(`• ${input.overdue} overdue na: ${overdueList}${input.overdue > 3 ? ', at iba pa' : ''}.`);
  else lines.push(`• Wala kang overdue na task. 🎉`);
  if (input.topPriority) lines.push(`• Top priority: "${input.topPriority.title}" — ${input.topPriority.time || 'walang oras na naka-set'}.`);
  if (input.followups > 0) lines.push(`• ${input.followups} follow-up${input.followups === 1 ? '' : 's'} na naghihintay.`);
  if (input.activeReminders > 0) lines.push(`• ${input.activeReminders} active na reminder${input.activeReminders === 1 ? '' : 's'}.`);
  lines.push(`Sige boss, andiyan na lahat — good luck sa araw mo!`);

  const spoken = `Good morning boss. You have ${input.today} task${input.today === 1 ? '' : 's'} today` +
    (input.urgent ? `, ${input.urgent} urgent` : '') + `, and ${input.overdue} overdue.` +
    (input.topPriority ? ` Your top priority is ${input.topPriority.title}.` : '') +
    ` Have a great day.`;

  return { text: lines.join('\n'), spoken };
}

export function buildEndOfDayReview(input: {
  completedToday: { title: string }[];
  overdue: number;
  overdueItems: { title: string }[];
  dueTodayNotDone: { title: string }[];
}, dateLabel: string): { text: string; spoken: string } {
  const doneCount = input.completedToday.length;
  const doneList = input.completedToday.slice(0, 5).map(t => t.title).join(', ');
  const notDoneList = input.dueTodayNotDone.slice(0, 3).map(t => t.title).join(', ');

  const lines: string[] = [`Magandang gabi, boss! Eto ang wrap-up mo para sa ${dateLabel}:`];
  if (doneCount > 0) lines.push(`• ${doneCount} task${doneCount === 1 ? '' : 's'} natapos ngayon: ${doneList}${doneCount > 5 ? ', at iba pa' : ''}. Great job!`);
  else lines.push(`• Wala pang natapos na task ngayong araw.`);
  if (input.dueTodayNotDone.length > 0) lines.push(`• ${input.dueTodayNotDone.length} na dapat sana natapos ngayon pero hindi pa: ${notDoneList}${input.dueTodayNotDone.length > 3 ? ', at iba pa' : ''}.`);
  if (input.overdue > 0) lines.push(`• ${input.overdue} pa ring overdue — puwede mong unahin bukas.`);
  else lines.push(`• Walang overdue na task. 🎉`);
  lines.push(`Magpahinga ka na, boss!`);

  const spoken = `Good evening boss. You completed ${doneCount} task${doneCount === 1 ? '' : 's'} today.` +
    (input.dueTodayNotDone.length > 0 ? ` ${input.dueTodayNotDone.length} planned for today are still not done.` : '') +
    (input.overdue > 0 ? ` ${input.overdue} are still overdue.` : '') +
    ` Rest well.`;

  return { text: lines.join('\n'), spoken };
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

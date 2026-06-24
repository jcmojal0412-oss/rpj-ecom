// Server-only auth utilities — only import this in API routes and Server Components
import { cookies } from 'next/headers';
import { decodeSession, SESSION_COOKIE } from './auth-helpers';
import type { SessionUser } from './auth-helpers';

export * from './auth-helpers';

export async function getSession(): Promise<SessionUser | null> {
  const store = cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return decodeSession(token);
}

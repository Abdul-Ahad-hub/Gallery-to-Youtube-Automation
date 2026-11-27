import crypto from 'node:crypto';
import { getEnv } from '../../config/env.js';

export type UserRole = 'user' | 'admin';

export interface AuthUser {
  username: string;
  displayName: string;
  role: UserRole;
}

interface SessionPayload extends AuthUser {
  exp: number;
}

export const SESSION_COOKIE_NAME = 'goalcast_session';
const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

function sha256Buffer(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(sha256Buffer(a), sha256Buffer(b));
}

function getSigningSecret(): string {
  const env = getEnv();
  return (
    env.AUTH_SESSION_SECRET ||
    env.YOUTUBE_CLIENT_SECRET ||
    'goalcast-session-signing-key-2026'
  );
}

function getConfiguredAccounts(): Array<{
  username: string;
  password: string;
  displayName: string;
  role: UserRole;
}> {
  const env = getEnv();
  return [
    {
      username: env.AUTH_PROD_USER || 'abdulahad',
      password: env.AUTH_PROD_PASS || 'GoalCast@2026',
      displayName: 'Abdul Ahad',
      role: 'user',
    },
    {
      username: env.AUTH_ADMIN_USER || 'admin',
      password: env.AUTH_ADMIN_PASS || 'GoalCastAdmin#2026',
      displayName: 'Admin (Test Pipeline)',
      role: 'admin',
    },
  ];
}

export function verifyCredentials(username: string, password: string): AuthUser | null {
  const cleanUser = username.trim().toLowerCase();
  if (!cleanUser || !password) return null;

  for (const account of getConfiguredAccounts()) {
    if (safeEqual(cleanUser, account.username.toLowerCase()) && safeEqual(password, account.password)) {
      return {
        username: account.username,
        displayName: account.displayName,
        role: account.role,
      };
    }
  }
  return null;
}

export function createSessionToken(user: AuthUser): string {
  const payload: SessionPayload = {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('hex');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): AuthUser | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;
  if (!/^[0-9a-f]{64}$/i.test(sig)) return null;

  const expected = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('hex');

  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf-8')
    ) as SessionPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (parsed.role !== 'user' && parsed.role !== 'admin') {
      return null;
    }
    return {
      username: parsed.username,
      displayName: parsed.displayName,
      role: parsed.role,
    };
  } catch {
    return null;
  }
}

export function parseSessionCookie(cookieHeader: string | undefined): AuthUser | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';');
  for (const part of cookies) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE_NAME) {
      const value = decodeURIComponent(part.slice(eq + 1).trim());
      return verifySessionToken(value);
    }
  }
  return null;
}

export function buildSessionSetCookie(token: string, isSecure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SEC}`,
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

export function buildSessionClearCookie(isSecure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

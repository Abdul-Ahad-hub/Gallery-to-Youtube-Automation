import { useState, type FormEvent } from 'react';
import { Clapperboard, Loader2, Lock, User } from 'lucide-react';
import type { AuthUser } from '../core/auth/session';
import { loginUser } from '../services/api';

interface LoginScreenProps {
  onSuccess: (user: AuthUser) => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter both username and password.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await loginUser(username.trim(), password);
      onSuccess(result.user);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Sign in failed. Contact Abdul Ahad for access.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5FA] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_8px_30px_rgba(16,24,40,0.06)] p-7 sm:p-9 space-y-6">
        <div className="flex flex-col items-center text-center space-y-2.5">
          <span className="w-12 h-12 rounded-xl bg-[#E5322D] text-white flex items-center justify-center shadow-[0_6px_18px_rgba(229,50,45,0.28)]">
            <Clapperboard className="w-6 h-6" />
          </span>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#1F2328]">
            GoalCast AI
          </h1>
          <p className="text-xs sm:text-sm text-[#57606A]">
            Automated Football YouTube Shorts Platform
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="px-3.5 py-2.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] leading-snug"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="login-username"
              className="block text-xs font-semibold text-[#1F2328]"
            >
              Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-[#6E7781] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-[#FAFAFC] border border-[#D1D5DB] focus:border-[#E5322D] focus:bg-white rounded-lg text-[#1F2328] placeholder:text-[#9CA3AF] focus:outline-none transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="login-password"
              className="block text-xs font-semibold text-[#1F2328]"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#6E7781] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-[#FAFAFC] border border-[#D1D5DB] focus:border-[#E5322D] focus:bg-white rounded-lg text-[#1F2328] placeholder:text-[#9CA3AF] focus:outline-none transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-[#E5322D] hover:bg-[#C92420] rounded-xl shadow-[0_6px_18px_rgba(229,50,45,0.22)] transition-colors disabled:opacity-60 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Signing in...</span>
              </>
            ) : (
              <span>Sign In</span>
            )}
          </button>
        </form>

        <p className="text-center text-xs text-[#6E7781] pt-2 border-t border-[#ECEEF2]">
          Private automation portal. Contact <span className="font-semibold text-[#1F2328]">Abdul Ahad</span> to request login access.
        </p>
      </div>
    </div>
  );
}

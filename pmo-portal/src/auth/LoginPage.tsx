import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';

const LoginPage: React.FC = () => {
  const { signInWithPassword, signInWithMagicLink } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } = await signInWithPassword(email, password);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    navigate('/', { replace: true });
  };

  const onMagicLink = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } = await signInWithMagicLink(email);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    setNotice('Check your email for a sign-in link.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <form
        onSubmit={onSignIn}
        className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-4"
      >
        <h1 className="text-xl font-semibold text-gray-800 dark:text-white">
          Sign in to PMO Portal
        </h1>
        {error && (
          <div role="alert" className="text-sm text-red-600">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="text-sm text-green-600">
            {notice}
          </div>
        )}
        <div>
          <label htmlFor="email" className="block text-sm text-gray-700 dark:text-gray-300">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-gray-700"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm text-gray-700 dark:text-gray-300">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-gray-700"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-primary-600 text-white rounded py-2 disabled:opacity-50"
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={onMagicLink}
          disabled={busy || !email}
          className="w-full border rounded py-2 text-gray-700 dark:text-gray-200 disabled:opacity-50"
        >
          Send magic link
        </button>
      </form>
    </div>
  );
};

export default LoginPage;

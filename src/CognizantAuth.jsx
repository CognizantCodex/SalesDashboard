import React, { useEffect, useMemo, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3001';
const LOGIN_URL = import.meta.env.VITE_COGNIZANT_LOGIN_URL || `${API_BASE_URL}/api/auth/login`;
const LOGOUT_URL = import.meta.env.VITE_COGNIZANT_LOGOUT_URL || `${API_BASE_URL}/api/auth/logout`;

function buildUrl(baseUrl, params = {}) {
  const url = new URL(baseUrl, window.location.origin);

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

async function loadSession() {
  const response = await fetch(`${API_BASE_URL}/api/auth/session`, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (response.status === 401) {
    return { authenticated: false };
  }

  if (!response.ok) {
    throw new Error('Unable to verify your Cognizant session.');
  }

  return response.json();
}

export default function CognizantAuth({ children }) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    loadSession()
      .then((nextSession) => {
        if (isMounted) {
          setSession(nextSession);
          setError('');
        }
      })
      .catch((sessionError) => {
        if (isMounted) {
          setSession({ authenticated: false });
          setError(sessionError.message);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const loginUrl = useMemo(
    () => buildUrl(LOGIN_URL, { returnTo: window.location.href }),
    []
  );

  const logoutUrl = useMemo(
    () => buildUrl(LOGOUT_URL, { returnTo: window.location.origin }),
    []
  );

  if (!session) {
    return (
      <main className="auth-shell" aria-live="polite">
        <section className="auth-card">
          <p className="auth-kicker">Cognizant SSO</p>
          <h1>Checking access</h1>
          <p>We are verifying your Cognizant session before loading the dashboard.</p>
        </section>
      </main>
    );
  }

  if (!session.authenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="auth-kicker">Cognizant SSO</p>
          <h1>Sign in with Cognizant</h1>
          <p>Use your Cognizant identity to access the SLS Dashboard.</p>
          {error ? <p className="auth-error">{error}</p> : null}
          <a className="auth-button" href={loginUrl}>
            Continue with Cognizant
          </a>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="auth-user-bar">
        <span>
          Signed in as <strong>{session.user?.name || session.user?.email}</strong>
        </span>
        <a href={logoutUrl}>Sign out</a>
      </div>
      {children}
    </>
  );
}

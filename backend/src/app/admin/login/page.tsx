'use client';

import { useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/admin/orders';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      window.location.href = from;
    } else {
      setError('Mật khẩu không đúng');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F6F2EA',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Open Sans, sans-serif',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        padding: '40px 36px',
        width: 360,
        boxShadow: '0 4px 24px rgba(124,95,64,0.10)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🌸</div>
        <h1 style={{ color: '#7C5F40', fontSize: 22, fontWeight: 700, marginBottom: 4 }}>By Quinny</h1>
        <p style={{ color: '#999', fontSize: 14, marginBottom: 28 }}>Quản lý Admin</p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="Nhập mật khẩu"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 8,
              border: '1.5px solid #E8DDD0',
              fontSize: 15,
              marginBottom: 12,
              outline: 'none',
              boxSizing: 'border-box',
              background: '#FDFAF7',
            }}
          />
          {error && (
            <p style={{ color: '#e53e3e', fontSize: 13, marginBottom: 12 }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              background: '#7C5F40',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '13px 0',
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}

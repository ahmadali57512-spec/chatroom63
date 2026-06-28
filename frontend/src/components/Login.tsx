import React, { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';

interface Props {
  socket: Socket;
  onLogin: (username: string) => void;
}

const Login: React.FC<Props> = ({ socket, onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    socket.emit('login', { username, password });
  };

  socket.once('login_success', (data) => {
    setLoading(false);
    onLogin(data.username);
  });

  socket.once('login_failed', (data) => {
    setLoading(false);
    setError(data.message);
  });

  useEffect(() => {
    return () => {
      socket.off('login_success');
      socket.off('login_failed');
    };
  }, [socket]);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      flexDirection: 'column',
      background: '#0a0a0f',
      padding: '20px',
      fontFamily: 'Courier New, monospace'
    }}>
      <div style={{
        border: '1px solid #00ff41',
        padding: isMobile ? '30px 20px' : '40px',
        borderRadius: '8px',
        maxWidth: '400px',
        width: '100%',
        background: 'rgba(0,0,0,0.8)',
        boxShadow: '0 0 40px rgba(0,255,65,0.1)'
      }}>
        <h1 style={{
          textAlign: 'center',
          fontSize: isMobile ? '1.8rem' : '2.5rem',
          fontWeight: 'normal',
          letterSpacing: '4px',
          marginBottom: '4px',
          animation: 'glitch 1.5s infinite',
          color: '#00ff41'
        }}>CHATROOM63</h1>
        <p style={{ textAlign: 'center', color: '#00ff41', opacity: 0.7, marginBottom: '20px', fontSize: isMobile ? '12px' : '14px' }}>
          🔐 Encrypted · Secure · Real-time
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#00ff41', opacity: 0.8, marginBottom: '4px' }}>
              USERNAME
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                background: '#111',
                border: '1px solid #00ff41',
                color: '#00ff41',
                fontFamily: 'Courier New, monospace',
                fontSize: isMobile ? '14px' : '16px',
                borderRadius: '4px',
                outline: 'none',
                WebkitAppearance: 'none'
              }}
              placeholder="Enter username"
              required
              autoComplete="username"
            />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#00ff41', opacity: 0.8, marginBottom: '4px' }}>
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                background: '#111',
                border: '1px solid #00ff41',
                color: '#00ff41',
                fontFamily: 'Courier New, monospace',
                fontSize: isMobile ? '14px' : '16px',
                borderRadius: '4px',
                outline: 'none',
                WebkitAppearance: 'none'
              }}
              placeholder="Enter password"
              required
              autoComplete="current-password"
            />
          </div>
          {error && (
            <div style={{ color: '#ff0040', marginBottom: '12px', textAlign: 'center', fontSize: '14px' }}>
              ⚠ {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              background: '#00ff41',
              color: '#0a0a0f',
              border: 'none',
              borderRadius: '4px',
              fontSize: isMobile ? '16px' : '18px',
              fontWeight: 'bold',
              fontFamily: 'Courier New, monospace',
              cursor: 'pointer',
              transition: 'all 0.3s',
              letterSpacing: '2px',
              opacity: loading ? 0.6 : 1,
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            {loading ? 'DECRYPTING...' : '⚡ ENTER CHAT'}
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '11px', color: '#00ff41', opacity: 0.5 }}>
          Users: saad, daniyal, abdullah, farhan · Password: password123
        </div>
      </div>
    </div>
  );
};

export default Login;
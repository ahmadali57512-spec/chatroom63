import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import ChatRoom from './components/ChatRoom';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true
    });
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const handleLogin = (user: string) => {
    setUsername(user);
  };

  if (!socket) return <div className="loading">Connecting to server...</div>;

  return (
    <div style={{ height: '100vh', position: 'relative' }}>
      <div className="scanline"></div>
      {!username ? (
        <Login socket={socket} onLogin={handleLogin} />
      ) : (
        <ChatRoom socket={socket} username={username} />
      )}
    </div>
  );
}

export default App;
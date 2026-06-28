import React, { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { getSharedKey, encryptMessage, decryptMessage, bufferToBase64, base64ToBuffer } from './CryptoUtils';
import { FaPhone, FaPhoneSlash, FaCheck, FaCheckDouble, FaUsers, FaMicrophone, FaMicrophoneSlash } from 'react-icons/fa';

interface Message {
  id: string;
  from: string;
  to: string; // 'group' for group messages, or username for private
  text: string;
  timestamp: number;
  delivered: boolean;
  read: boolean;
  isGroup?: boolean;
}

interface OnlineUser {
  socketId: string;
  username: string;
}

interface Props {
  socket: Socket;
  username: string;
}

const ChatRoom: React.FC<Props> = ({ socket, username }) => {
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [isGroupChat, setIsGroupChat] = useState(false);
  const [inputText, setInputText] = useState('');
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [caller, setCaller] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showCallUI, setShowCallUI] = useState(false);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showSidebar, setShowSidebar] = useState(true);

  // Handle window resize for mobile
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768) {
        setShowSidebar(false);
      } else {
        setShowSidebar(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load encryption key
  useEffect(() => {
    getSharedKey().then(setKey);
  }, []);

  // Socket event listeners
  useEffect(() => {
    // Online users
    socket.on('users_online', (users: OnlineUser[]) => {
      setOnlineUsers(users.filter(u => u.username !== username));
    });

    // New message (private)
    socket.on('new_message', async (data: { from: string; encryptedMessage: string; iv: string; timestamp: number }) => {
      if (!key) return;
      try {
        const ivBytes = new Uint8Array(base64ToBuffer(data.iv));
        const encryptedBytes = base64ToBuffer(data.encryptedMessage);
        const decrypted = await decryptMessage(encryptedBytes, ivBytes, key);
        const msg: Message = {
          id: Date.now().toString() + Math.random(),
          from: data.from,
          to: username,
          text: decrypted,
          timestamp: data.timestamp,
          delivered: true,
          read: false,
          isGroup: false
        };
        setMessages(prev => [...prev, msg]);
        setTimeout(() => {
          socket.emit('message_read', { from: data.from, messageId: msg.id });
          setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read: true } : m));
        }, 1000);
      } catch (e) {
        console.error('Decryption failed', e);
      }
    });

    // Group message
    socket.on('new_group_message', async (data: { from: string; encryptedMessage: string; iv: string; timestamp: number }) => {
      if (!key) return;
      try {
        const ivBytes = new Uint8Array(base64ToBuffer(data.iv));
        const encryptedBytes = base64ToBuffer(data.encryptedMessage);
        const decrypted = await decryptMessage(encryptedBytes, ivBytes, key);
        const msg: Message = {
          id: Date.now().toString() + Math.random(),
          from: data.from,
          to: 'group',
          text: decrypted,
          timestamp: data.timestamp,
          delivered: true,
          read: false,
          isGroup: true
        };
        setMessages(prev => [...prev, msg]);
      } catch (e) {
        console.error('Decryption failed', e);
      }
    });

    // Message delivered receipt
    socket.on('message_delivered', ({ to, timestamp }) => {
      setMessages(prev => prev.map(m =>
        m.to === to && m.timestamp === timestamp ? { ...m, delivered: true } : m
      ));
    });

    // Message read receipt
    socket.on('message_read_receipt', ({ from, messageId }) => {
      setMessages(prev => prev.map(m =>
        m.from === from && m.id === messageId ? { ...m, read: true } : m
      ));
    });

    // Incoming call
    socket.on('incoming_call', async ({ from, offer }) => {
      setCaller(from);
      setShowCallUI(true);
      // Auto-accept for better UX, or use confirm
      if (window.confirm(`📞 ${from} is calling you. Accept?`)) {
        await startCall(from, offer);
      } else {
        socket.emit('end_call', { to: from });
        setShowCallUI(false);
      }
    });

    // Call answered
    socket.on('call_answered', ({ from, answer }) => {
      if (peerConnection.current) {
        peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
      }
      setIsInCall(true);
      setShowCallUI(true);
    });

    // ICE candidate
    socket.on('ice_candidate', ({ from, candidate }) => {
      if (peerConnection.current) {
        peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    // Call ended
    socket.on('call_ended', ({ from }) => {
      endCall();
      setShowCallUI(false);
    });

    // Kicked
    socket.on('kicked', ({ message }) => {
      alert(message);
      window.location.reload();
    });

    return () => {
      socket.off('users_online');
      socket.off('new_message');
      socket.off('new_group_message');
      socket.off('message_delivered');
      socket.off('message_read_receipt');
      socket.off('incoming_call');
      socket.off('call_answered');
      socket.off('ice_candidate');
      socket.off('call_ended');
      socket.off('kicked');
    };
  }, [socket, key, username]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send private message
  const sendMessage = async () => {
    if (!selectedUser || !inputText.trim() || !key) return;
    try {
      const { encrypted, iv } = await encryptMessage(inputText, key);
      const encryptedBase64 = bufferToBase64(encrypted);
      const ivBase64 = bufferToBase64(iv.buffer);
      
      if (isGroupChat) {
        socket.emit('group_message', {
          encryptedMessage: encryptedBase64,
          iv: ivBase64
        });
      } else {
        socket.emit('private_message', {
          to: selectedUser,
          encryptedMessage: encryptedBase64,
          iv: ivBase64
        });
      }
      
      const newMsg: Message = {
        id: Date.now().toString() + Math.random(),
        from: username,
        to: isGroupChat ? 'group' : selectedUser,
        text: inputText,
        timestamp: Date.now(),
        delivered: false,
        read: false,
        isGroup: isGroupChat
      };
      setMessages(prev => [...prev, newMsg]);
      setInputText('');
    } catch (e) {
      console.error('Encryption error', e);
    }
  };

  // ---- WebRTC Call Functions ----
  const startCall = async (to: string, offer?: RTCSessionDescriptionInit) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });
      peerConnection.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice_candidate', { to, candidate: event.candidate });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionstate === 'disconnected' || pc.connectionstate === 'failed') {
          endCall();
          setShowCallUI(false);
        }
      };

      if (offer) {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer_call', { to, answer });
        setIsInCall(true);
        setShowCallUI(true);
      } else {
        const offerDesc = await pc.createOffer();
        await pc.setLocalDescription(offerDesc);
        socket.emit('call_user', { to, offer: offerDesc });
        setIsInCall(true);
        setShowCallUI(true);
      }
    } catch (e) {
      console.error('Call start error:', e);
      alert('Unable to start call. Please check microphone permissions.');
    }
  };

  const endCall = () => {
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    setRemoteStream(null);
    setIsInCall(false);
    setCaller(null);
    setIsCalling(false);
    setShowCallUI(false);
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const initiateCall = async (to: string) => {
    setIsCalling(true);
    await startCall(to);
  };

  const toggleGroupChat = () => {
    setIsGroupChat(!isGroupChat);
    setSelectedUser(null);
  };

  const selectUser = (user: string) => {
    setSelectedUser(user);
    setIsGroupChat(false);
    if (isMobile) setShowSidebar(false);
  };

  const toggleSidebar = () => {
    setShowSidebar(!showSidebar);
  };

  // Get messages for current chat
  const getCurrentMessages = () => {
    if (isGroupChat) {
      return messages.filter(m => m.isGroup);
    } else if (selectedUser) {
      return messages.filter(m => 
        (m.from === selectedUser && m.to === username) ||
        (m.from === username && m.to === selectedUser)
      );
    }
    return [];
  };

  // ---- UI ----
  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: '#0a0a0f',
      color: '#00ff41',
      fontFamily: 'Courier New, monospace',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Mobile toggle button */}
      {isMobile && (
        <button
          onClick={toggleSidebar}
          style={{
            position: 'fixed',
            top: '10px',
            left: '10px',
            zIndex: 1000,
            background: '#00ff41',
            color: '#0a0a0f',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 12px',
            cursor: 'pointer',
            fontFamily: 'Courier New, monospace',
            fontSize: '12px'
          }}
        >
          {showSidebar ? '✕' : '☰'}
        </button>
      )}

      {/* Sidebar - Online users */}
      <div style={{
        width: isMobile ? (showSidebar ? '100%' : '0') : '280px',
        borderRight: isMobile ? 'none' : '1px solid #00ff41',
        padding: isMobile ? '60px 20px 20px 20px' : '20px',
        overflowY: 'auto',
        background: 'rgba(0,0,0,0.8)',
        display: isMobile ? (showSidebar ? 'flex' : 'none') : 'flex',
        flexDirection: 'column',
        position: isMobile ? 'fixed' : 'relative',
        top: 0,
        left: 0,
        height: '100vh',
        zIndex: 999,
        transition: 'all 0.3s ease'
      }}>
        <div style={{ marginBottom: '20px', borderBottom: '1px solid #00ff41', paddingBottom: '10px' }}>
          <div style={{ fontSize: '12px', opacity: 0.6 }}>👤 LOGGED AS</div>
          <div style={{ fontSize: isMobile ? '16px' : '20px', letterSpacing: '2px' }}>{username}</div>
        </div>

        {/* Group chat button */}
        <button
          onClick={toggleGroupChat}
          style={{
            padding: '10px',
            marginBottom: '10px',
            background: isGroupChat ? 'rgba(0,255,65,0.2)' : 'transparent',
            border: '1px solid #00ff41',
            borderRadius: '4px',
            color: '#00ff41',
            cursor: 'pointer',
            fontFamily: 'Courier New, monospace',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          <FaUsers /> {isGroupChat ? 'GROUP CHAT' : 'START GROUP CHAT'}
        </button>

        <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '10px' }}>
          ONLINE ({onlineUsers.length})
        </div>
        {onlineUsers.map(user => (
          <div
            key={user.socketId}
            onClick={() => selectUser(user.username)}
            style={{
              padding: '10px',
              marginBottom: '6px',
              background: selectedUser === user.username ? 'rgba(0,255,65,0.15)' : 'transparent',
              border: '1px solid ' + (selectedUser === user.username ? '#00ff41' : 'transparent'),
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              transition: 'all 0.2s'
            }}
          >
            <span>🟢 {user.username}</span>
            <button
              onClick={(e) => { e.stopPropagation(); initiateCall(user.username); }}
              style={{
                background: 'none',
                border: 'none',
                color: '#00ffff',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '4px 8px'
              }}
              title="Call"
            >
              <FaPhone />
            </button>
          </div>
        ))}
        {onlineUsers.length === 0 && (
          <div style={{ opacity: 0.4, fontStyle: 'italic' }}>No one else online</div>
        )}
      </div>

      {/* Chat area */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        marginLeft: isMobile ? 0 : 0,
        height: '100vh'
      }}>
        {/* Header */}
        <div style={{
          padding: '15px 20px',
          borderBottom: '1px solid #00ff41',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(0,0,0,0.4)',
          minHeight: '60px'
        }}>
          <div>
            {isGroupChat ? (
              <span style={{ fontSize: '18px' }}>👥 GROUP CHAT</span>
            ) : selectedUser ? (
              <>
                <span style={{ opacity: 0.6 }}>CHAT WITH</span>
                <span style={{ marginLeft: '10px', fontSize: '18px' }}>{selectedUser}</span>
              </>
            ) : (
              <span style={{ opacity: 0.5 }}>Select a user or start group chat</span>
            )}
          </div>
          {isInCall && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ color: '#ff0040' }}>🔴 ON CALL</span>
              <button onClick={endCall} style={{ background: 'none', border: 'none', color: '#ff0040', fontSize: '20px', cursor: 'pointer' }}>
                <FaPhoneSlash />
              </button>
            </div>
          )}
        </div>

        {/* Messages */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '15px',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: '80px'
        }}>
          {getCurrentMessages().map((msg) => {
            const isMine = msg.from === username;
            const sender = isGroupChat ? msg.from : (isMine ? 'YOU' : msg.from);
            return (
              <div
                key={msg.id}
                style={{
                  alignSelf: isMine ? 'flex-end' : 'flex-start',
                  maxWidth: '80%',
                  marginBottom: '8px',
                  padding: '10px 14px',
                  background: isMine ? 'rgba(0,255,65,0.1)' : 'rgba(0,255,255,0.05)',
                  border: '1px solid ' + (isMine ? '#00ff41' : '#00ffff'),
                  borderRadius: '4px',
                  wordBreak: 'break-word'
                }}
              >
                <div style={{ fontSize: '11px', opacity: 0.6, marginBottom: '4px' }}>
                  {isGroupChat && <span style={{ fontWeight: 'bold' }}>{msg.from}: </span>}
                  <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                </div>
                <div>{msg.text}</div>
                <div style={{ fontSize: '10px', opacity: 0.5, marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {isMine && (
                    <>
                      {msg.delivered ? <FaCheckDouble style={{ color: '#00ff41' }} /> : <FaCheck style={{ opacity: 0.4 }} />}
                      {msg.read && <span style={{ color: '#00ff41' }}>✓✓ read</span>}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messageEndRef} />
        </div>

        {/* Input - Fixed at bottom */}
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: isMobile ? 0 : '280px',
          right: 0,
          padding: '12px 15px',
          borderTop: '1px solid #00ff41',
          display: 'flex',
          gap: '10px',
          background: 'rgba(0,0,0,0.9)',
          zIndex: 100
        }}>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder={isGroupChat ? 'Message everyone...' : (selectedUser ? `Message ${selectedUser}...` : 'Select a user first')}
            disabled={!selectedUser && !isGroupChat}
            style={{
              flex: 1,
              padding: '12px',
              background: '#111',
              border: '1px solid #00ff41',
              borderRadius: '4px',
              color: '#00ff41',
              fontFamily: 'Courier New, monospace',
              outline: 'none',
              fontSize: isMobile ? '14px' : '16px',
              minHeight: '44px'
            }}
          />
          <button
            onClick={sendMessage}
            disabled={(!selectedUser && !isGroupChat) || !inputText.trim()}
            style={{
              padding: '12px 20px',
              background: '#00ff41',
              color: '#0a0a0f',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 'bold',
              fontFamily: 'Courier New, monospace',
              cursor: 'pointer',
              transition: 'all 0.3s',
              opacity: (!selectedUser && !isGroupChat) || !inputText.trim() ? 0.5 : 1,
              minHeight: '44px',
              minWidth: '60px'
            }}
          >
            SEND
          </button>
        </div>
      </div>

      {/* Call UI - Floating overlay (doesn't interfere with input) */}
      {showCallUI && (
        <div style={{
          position: 'fixed',
          bottom: '80px',
          right: '20px',
          zIndex: 1000,
          background: 'rgba(0,0,0,0.9)',
          padding: '12px',
          borderRadius: '8px',
          border: '1px solid #00ff41',
          minWidth: '160px',
          boxShadow: '0 0 30px rgba(0,255,65,0.2)'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <div style={{ fontSize: '12px', opacity: 0.7 }}>
              {isInCall ? '🔴 Call in progress' : '📞 Incoming call...'}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {isInCall && (
                <>
                  <button
                    onClick={toggleMute}
                    style={{
                      background: isMuted ? '#ff0040' : 'transparent',
                      border: '1px solid #00ff41',
                      borderRadius: '50%',
                      padding: '10px',
                      color: isMuted ? '#fff' : '#00ff41',
                      cursor: 'pointer',
                      fontSize: '16px',
                      width: '44px',
                      height: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                  </button>
                  <button
                    onClick={endCall}
                    style={{
                      background: '#ff0040',
                      border: 'none',
                      borderRadius: '50%',
                      padding: '10px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '16px',
                      width: '44px',
                      height: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <FaPhoneSlash />
                  </button>
                </>
              )}
              {!isInCall && caller && (
                <>
                  <button
                    onClick={() => startCall(caller)}
                    style={{
                      background: '#00ff41',
                      border: 'none',
                      borderRadius: '50%',
                      padding: '10px',
                      color: '#0a0a0f',
                      cursor: 'pointer',
                      fontSize: '16px',
                      width: '44px',
                      height: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <FaPhone />
                  </button>
                  <button
                    onClick={() => { endCall(); setShowCallUI(false); }}
                    style={{
                      background: '#ff0040',
                      border: 'none',
                      borderRadius: '50%',
                      padding: '10px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '16px',
                      width: '44px',
                      height: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <FaPhoneSlash />
                  </button>
                </>
              )}
            </div>
            {isInCall && (
              <div style={{ fontSize: '10px', opacity: 0.5, marginTop: '4px' }}>
                {remoteStream ? 'Connected' : 'Connecting...'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Video elements (hidden, only for audio) */}
      <video ref={localVideoRef} autoPlay muted style={{ display: 'none' }} />
      <video ref={remoteVideoRef} autoPlay style={{ display: 'none' }} />
    </div>
  );
};

export default ChatRoom;
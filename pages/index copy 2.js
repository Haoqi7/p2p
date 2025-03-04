import { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import { v4 as uuidv4 } from 'uuid';
import download from 'downloadjs';

export default function Home() {
  const [userId, setUserId] = useState('');
  const [inputId, setInputId] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [connections, setConnections] = useState([]);
  const [roomMembers, setRoomMembers] = useState([]);
  const [currentChat, setCurrentChat] = useState({ type: null, name: '' });
  const [pendingFiles, setPendingFiles] = useState([]);
  const [receivedFiles, setReceivedFiles] = useState([]);
  const peerRef = useRef(null);
  const fileInputRef = useRef(null);

  // 初始化用户系统
  useEffect(() => {
    const initializeUser = () => {
      let storedId = localStorage.getItem('peerId');
      if (!storedId || !/^id\d{5}$/.test(storedId)) {
        storedId = `id${Math.floor(10000 + Math.random() * 90000)}`;
        localStorage.setItem('peerId', storedId);
      }
      setUserId(storedId);
      initPeer(storedId);
    };

    const initPeer = (id) => {
      const peer = new Peer(id, {
        host: process.env.NEXT_PUBLIC_PEER_SERVER,
        port: process.env.NEXT_PUBLIC_PEER_PORT,
        path: '/',
        secure: true
      });

      peer.on('connection', (conn) => {
        conn.on('open', () => {
          setupConnection(conn);
          if (conn.metadata?.isDiscovery) {
            conn.send({
              type: 'room-members',
              members: [userId, ...roomMembers]
            });
          }
        });
      });

      peer.on('error', (err) => {
        console.error('PeerJS Error:', err);
      });

      peerRef.current = peer;
    };

    initializeUser();
  }, []);

  // 消息历史处理
  useEffect(() => {
    const savedHistory = localStorage.getItem('chatHistory');
    if (savedHistory) setMessages(JSON.parse(savedHistory));
  }, []);

  useEffect(() => {
    localStorage.setItem('chatHistory', JSON.stringify(messages.slice(-50)));
  }, [messages]);

  // 连接处理逻辑
  const setupConnection = (conn) => {
    setConnections(prev => [...prev, conn]);

    conn.on('data', (data) => {
      switch (data.type) {
        case 'message':
          setMessages(prev => [...prev.slice(-49), data]);
          break;
        case 'file':
          handleFileReceive(data);
          break;
        case 'room-members':
          setRoomMembers(data.members);
          break;
        case 'room-join':
          setRoomMembers(prev => [...new Set([...prev, ...data.members])]);
          break;
      }
    });

    conn.on('close', () => {
      setConnections(prev => prev.filter(c => c !== conn));
    });
  };

  // 文件接收处理
  const handleFileReceive = (data) => {
    const fileId = uuidv4();
    setReceivedFiles(prev => [...prev, {
      id: fileId,
      name: data.fileName,
      size: data.size,
      type: data.fileType,
      data: data.content,
      sender: data.sender
    }]);
  };

  // 连接目标用户或房间
  const handleConnect = () => {
    if (!inputId) return;

    if (/^id\d{5}$/.test(inputId)) {
      const conn = peerRef.current.connect(inputId);
      conn.on('open', () => {
        setCurrentChat({ type: 'private', name: inputId });
        setupConnection(conn);
      });
    } else {
      const roomId = inputId || uuidv4().slice(0, 8);
      const discoveryConn = peerRef.current.connect(roomId, {
        metadata: { isDiscovery: true }
      });
      
      discoveryConn.on('open', () => {
        setCurrentChat({ type: 'room', name: roomId });
        setupConnection(discoveryConn);
        discoveryConn.send({
          type: 'room-join',
          members: connections.map(c => c.peer)
        });
      });
    }
    setInputId('');
  };

  // 发送文本消息
  const sendMessage = () => {
    if (!message.trim()) return;

    const msgObj = {
      type: 'message',
      content: message,
      sender: userId,
      timestamp: new Date().toISOString()
    };

    connections.forEach(conn => {
      if (conn.open) conn.send(msgObj);
    });
    
    setMessages(prev => [...prev.slice(-49), msgObj]);
    setMessage('');
  };

  // 发送待处理文件
  const handleSendPendingFiles = () => {
    if (pendingFiles.length === 0) return;

    pendingFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const fileObj = {
          type: 'file',
          fileName: file.name,
          fileType: file.type,
          content: e.target.result,
          size: file.size,
          sender: userId,
          timestamp: new Date().toISOString()
        };

        connections.forEach(conn => {
          if (conn.open) conn.send(fileObj);
        });
      };
      reader.readAsArrayBuffer(file);
    });

    setPendingFiles([]);
  };

  // 接受文件
  const handleAcceptFile = (fileId) => {
    const file = receivedFiles.find(f => f.id === fileId);
    if (file) {
      const blob = new Blob([file.data], { type: file.type });
      download(blob, file.name);
      setReceivedFiles(prev => prev.filter(f => f.id !== fileId));
    }
  };

  return (
    <div className="container">
      {/* 侧边栏 */}
      <div className="sidebar">
        <img
          src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`}
          alt="avatar"
          className="avatar"
        />
        <div className="user-id">{userId}</div>

        <div className="connect-box">
          <input
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            placeholder="输入ID或房间名"
            onKeyPress={(e) => e.key === 'Enter' && handleConnect()}
          />
          <button className="btn" onClick={handleConnect}>
            {/^id\d{5}$/.test(inputId) ? '连接' : '加入房间'}
          </button>
        </div>

        {roomMembers.length > 0 && (
          <div className="room-section">
            <h3>房间成员 ({roomMembers.length})</h3>
            <ul>
              {roomMembers.map(member => (
                <li key={member}>{member}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 主界面 */}
      <div className="main">
        {/* 聊天状态栏 */}
        <div className="chat-header">
          {currentChat.type ? (
            <div className="chat-status">
              {currentChat.type === 'private' ? (
                <>
                  <span className="status-icon">👤</span>
                  正在与 {currentChat.name} 私聊
                </>
              ) : (
                <>
                  <span className="status-icon">🏠</span>
                  房间: {currentChat.name} ({roomMembers.length}人在线)
                </>
              )}
            </div>
          ) : (
            <div className="chat-status">
              <span className="status-icon">🌐</span>
              未连接聊天会话
            </div>
          )}
        </div>

        {/* 聊天区域 */}
        <div className="chat-area">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.sender === userId ? 'self' : ''}`}>
              <div className="message-header">
                <span className="sender">
                  {msg.sender === userId ? '你' : msg.sender}
                </span>
                <span className="time">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="content">
                {msg.type === 'file' ? (
                  <div className="file-message">
                    📎 文件: {msg.fileName} ({formatFileSize(msg.size)})
                  </div>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 输入区域 */}
        <div className="input-container">
          {/* 文件上传区域 */}
          <div className="file-upload-section">
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                if (e.target.files.length > 0) {
                  setPendingFiles(prev => [
                    ...prev,
                    ...Array.from(e.target.files)
                  ].slice(0, 5));
                }
              }}
              multiple
              style={{ display: 'none' }}
            />
            <button
              className="btn"
              onClick={() => fileInputRef.current.click()}
            >
              📁 选择文件
            </button>
            
            {pendingFiles.length > 0 && (
              <div className="pending-files">
                <div className="file-list">
                  {pendingFiles.map((file, i) => (
                    <div key={i} className="file-item">
                      📎 {file.name} ({formatFileSize(file.size)})
                      <button 
                        className="remove-btn"
                        onClick={() => setPendingFiles(prev => prev.filter((_, index) => index !== i))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="btn primary"
                  onClick={handleSendPendingFiles}
                  disabled={pendingFiles.length === 0}
                >
                  🚀 发送 {pendingFiles.length}个文件
                </button>
              </div>
            )}
          </div>

          {/* 消息输入 */}
          <div className="message-input">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="输入消息..."
            />
            <button className="btn send-btn" onClick={sendMessage}>
              发送消息
            </button>
          </div>
        </div>

        {/* 接收文件区域 */}
        {receivedFiles.length > 0 && (
          <div className="file-receive-section">
            <h4>待接收文件 ({receivedFiles.length})</h4>
            <div className="received-files">
              {receivedFiles.map((file) => (
                <div key={file.id} className="file-item">
                  <div className="file-info">
                    <div className="file-meta">
                      <span className="sender">来自: {file.sender}</span>
                      <span className="file-name">📎 {file.name}</span>
                      <span className="file-size">{formatFileSize(file.size)}</span>
                    </div>
                    <div className="file-actions">
                      <button 
                        className="btn accept-btn"
                        onClick={() => handleAcceptFile(file.id)}
                      >
                        接受
                      </button>
                      <button
                        className="btn reject-btn"
                        onClick={() => setReceivedFiles(prev => prev.filter(f => f.id !== file.id))}
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 文件大小格式化函数
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

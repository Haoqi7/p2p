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
  const [files, setFiles] = useState([]);
  const [roomMembers, setRoomMembers] = useState([]);
  const peerRef = useRef(null);
  const fileInputRef = useRef(null);

  // 初始化用户系统和Peer连接
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
    const blob = new Blob([data.content], { type: data.fileType });
    download(blob, data.fileName);
    setFiles(prev => [...prev.slice(-4), { name: data.fileName, size: data.size }]);
  };

  // 连接目标用户或房间
  const handleConnect = () => {
    if (!inputId) return;

    if (/^id\d{5}$/.test(inputId)) {
      const conn = peerRef.current.connect(inputId);
      setupConnection(conn);
    } else {
      const roomId = inputId || uuidv4().slice(0, 8);
      const discoveryConn = peerRef.current.connect(roomId, {
        metadata: { isDiscovery: true }
      });
      
      discoveryConn.on('open', () => {
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

  // 发送文件
  const sendFile = async (e) => {
    const file = e.target.files[0];
    if (!file || files.length >= 5) return;

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
      
      setFiles(prev => [...prev, {
        name: file.name,
        size: file.size
      }]);
    };
    reader.readAsArrayBuffer(file);
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

      {/* 主聊天区域 */}
      <div className="main">
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

        <div className="input-group">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="输入消息..."
          />

          <div className="action-buttons">
            <button className="btn" onClick={sendMessage}>
              发送
            </button>
            
            <button
              className="btn secondary"
              onClick={() => fileInputRef.current.click()}
            >
              📎 添加文件
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={sendFile}
              style={{ display: 'none' }}
            />
          </div>
        </div>

        <div className="file-status">
          <span>待发文件: {files.length}/5</span>
          <div className="file-list">
            {files.map((file, i) => (
              <div key={i} className="file-item">
                📎 {file.name} ({formatFileSize(file.size)})
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// 辅助函数：格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

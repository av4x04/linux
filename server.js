
// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const os = require('os');
const fs = require('fs').promises; 
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6,
  cors: { origin: '*' }
});

const SHELL = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

// --- Session Management (Persistent Processes) ---
class RingBuffer {
  constructor(limitBytes) {
    this.buf = Buffer.allocUnsafe(limitBytes);
    this.limit = limitBytes;
    this.start = 0;
    this.len = 0;
  }
  append(input) {
    const b = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
    if (b.length >= this.limit) {
      b.copy(this.buf, 0, b.length - this.limit);
      this.start = 0;
      this.len = this.limit;
      return;
    }
    const free = this.limit - this.len;
    if (b.length > free) {
      this.start = (this.start + (b.length - free)) % this.limit;
      this.len = this.limit;
    } else {
      this.len += b.length;
    }
    const writePos = (this.start + this.len - b.length) % this.limit;
    const firstPart = Math.min(b.length, this.limit - writePos);
    b.copy(this.buf, writePos, 0, firstPart);
    if (firstPart < b.length) {
      b.copy(this.buf, 0, firstPart);
    }
  }
  toString(enc = 'utf8') {
    if (this.len === 0) return '';
    if (this.start + this.len <= this.limit) {
      return this.buf.slice(this.start, this.start + this.len).toString(enc);
    } else {
      const tailLen = (this.start + this.len) - this.limit;
      return Buffer.concat([
        this.buf.slice(this.start, this.limit),
        this.buf.slice(0, tailLen)
      ]).toString(enc);
    }
  }
}

const sessions = new Map();
const HISTORY_LIMIT = 1024 * 512; 

function getNextSessionNumber() {
    const usedNumbers = Array.from(sessions.values())
        .map(s => {
            const match = s.name.match(/^Term (\d+)$/);
            return match ? parseInt(match[1], 10) : null;
        })
        .filter(n => n !== null)
        .sort((a, b) => a - b);
    
    let nextNumber = 1;
    for (const num of usedNumbers) {
        if (num === nextNumber) {
            nextNumber++;
        } else {
            break;
        }
    }
    return nextNumber;
}

function createSession() {
  const id = uuidv4();
  let ptyProc;

  try {
    ptyProc = pty.spawn(SHELL, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.env.HOME || process.cwd(),
      env: process.env
    });
  } catch (err) {
    console.error('Failed to spawn PTY:', err);
    return null;
  }

  const sessionNumber = getNextSessionNumber();
  const session = {
    id,
    name: `Term ${sessionNumber}`,
    pty: ptyProc,
    history: new RingBuffer(HISTORY_LIMIT),
  };

  ptyProc.on('data', (d) => {
    try {
      session.history.append(d);
      io.to(session.id).emit('output', { sessionId: session.id, data: d });
    } catch (err) {
      console.error(`Error on PTY data for session ${session.id}:`, err);
    }
  });

  ptyProc.on('exit', (code) => {
    console.log(`PTY for session ${session.id} exited with code ${code}`);
    sessions.delete(session.id);
    io.emit('session-closed', { id: session.id });
  });

  sessions.set(id, session);
  return session;
}

// Initial session
if (sessions.size === 0) createSession();

// Serve static files correctly
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('Client connected', socket.id);

  // --- Terminal Handling ---
  const sessionList = Array.from(sessions.values()).map(s => ({ id: s.id, name: s.name }));
  socket.emit('sessions-list', sessionList);

  socket.on('subscribe-session', (sessionId) => {
    const session = sessions.get(sessionId);
    if (session) {
      socket.join(sessionId);
      const h = session.history.toString();
      if (h.length) socket.emit('history', { sessionId, history: h });
    }
  });

  socket.on('create-session', (callback) => {
    const newSession = createSession();
    if (newSession && typeof callback === 'function') {
        callback({ id: newSession.id, name: newSession.name });
    }
  });

  socket.on('terminal-input', ({ sessionId, data }) => {
    const session = sessions.get(sessionId);
    if (session && session.pty) {
        session.pty.write(data);
    }
  });

  socket.on('terminal-resize', ({ sessionId, cols, rows }) => {
    const session = sessions.get(sessionId);
    if (session && session.pty) {
        try { session.pty.resize(cols, rows); } catch(e) {}
    }
  });

  // --- File Manager Handling ---
  socket.on('fs-list', async ({ path: reqPath }, callback) => {
    try {
        const targetPath = reqPath || (process.env.HOME || process.cwd());
        const items = await fs.readdir(targetPath, { withFileTypes: true });
        const result = items.map(item => ({
            name: item.name,
            isDirectory: item.isDirectory(),
            // size logic can be added here if needed
        }));
        // Sort: Directories first
        result.sort((a, b) => (a.isDirectory === b.isDirectory) ? 0 : a.isDirectory ? -1 : 1);
        callback({ path: targetPath, items: result });
    } catch (err) {
        callback({ error: err.message });
    }
  });

  socket.on('fs-read', async ({ path: reqPath }, callback) => {
    try {
        const content = await fs.readFile(reqPath, 'utf8');
        callback({ content });
    } catch (err) {
        callback({ error: err.message });
    }
  });

  // --- System Info Handling ---
  socket.on('get-sys-info', (callback) => {
    const info = {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus(),
        totalMem: os.totalmem(),
        freeMem: os.freemem(),
        uptime: os.uptime()
    };
    callback(info);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Linux WebOS running on http://localhost:${PORT}`));

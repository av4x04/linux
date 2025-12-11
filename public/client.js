
// public/client.js

// --- Core Architecture: Window Manager ---

class WindowManager {
  constructor() {
    this.windows = new Map(); // id -> Window Object
    this.activeWindowId = null;
    this.zIndexCounter = 100;
    this.container = document.getElementById('windows-container');
    this.taskList = document.getElementById('task-list');
  }

  createWindow(options) {
    const id = 'win-' + Math.random().toString(36).substr(2, 9);
    const win = new AppWindow(id, options, this);
    this.windows.set(id, win);
    this.container.appendChild(win.element);
    this.renderTaskbar();
    this.focusWindow(id);
    return win;
  }

  closeWindow(id) {
    const win = this.windows.get(id);
    if (win) {
      win.cleanup(); // Clean up app specific listeners
      win.element.remove();
      this.windows.delete(id);
      this.renderTaskbar();
    }
  }

  focusWindow(id) {
    if (this.activeWindowId === id) return;
    
    // Demote current
    if (this.activeWindowId) {
      const curr = this.windows.get(this.activeWindowId);
      if (curr) curr.element.classList.remove('active');
    }

    // Promote new
    this.activeWindowId = id;
    const win = this.windows.get(id);
    if (win) {
      this.zIndexCounter++;
      win.element.style.zIndex = this.zIndexCounter;
      win.element.classList.add('active');
      win.onFocus(); // Hook for terminal focus
    }
    this.renderTaskbar();
  }

  renderTaskbar() {
    this.taskList.innerHTML = '';
    this.windows.forEach(win => {
      const item = document.createElement('div');
      item.className = `task-item ${this.activeWindowId === win.id ? 'active' : ''}`;
      item.innerHTML = `<i class="${win.icon}"></i><span>${win.title}</span>`;
      item.onclick = () => {
        if (this.activeWindowId === win.id) {
           // Toggle minimize could go here
        }
        this.focusWindow(win.id);
      };
      this.taskList.appendChild(item);
    });
  }
}

class AppWindow {
  constructor(id, options, manager) {
    this.id = id;
    this.manager = manager;
    this.title = options.title || 'Application';
    this.icon = options.icon || 'fas fa-window-maximize';
    this.minWidth = options.minWidth || 300;
    this.minHeight = options.minHeight || 200;
    
    // Create DOM
    this.element = document.createElement('div');
    this.element.className = 'window';
    this.element.style.width = (options.width || 600) + 'px';
    this.element.style.height = (options.height || 400) + 'px';
    
    // Center it roughly
    const top = 50 + (Math.random() * 50);
    const left = 50 + (Math.random() * 50);
    this.element.style.top = top + 'px';
    this.element.style.left = left + 'px';

    this.element.innerHTML = `
      <div class="title-bar">
        <div class="window-controls">
          <div class="win-btn close"></div>
          <div class="win-btn min"></div>
          <div class="win-btn max"></div>
        </div>
        <div class="title-drag-area">${this.title}</div>
      </div>
      <div class="window-content"></div>
      <div class="resize-handle"></div>
    `;

    this.contentArea = this.element.querySelector('.window-content');
    
    // Bind Events
    this.bindEvents();
    
    // Close handler
    this.element.querySelector('.close').onclick = (e) => {
        e.stopPropagation();
        this.manager.closeWindow(this.id);
    };

    // Focus handler
    this.element.addEventListener('mousedown', () => {
      this.manager.focusWindow(this.id);
    });
  }

  bindEvents() {
    const titleBar = this.element.querySelector('.title-bar');
    const resizeHandle = this.element.querySelector('.resize-handle');

    // Dragging
    let isDragging = false;
    let dragStartX, dragStartY, initialLeft, initialTop;

    titleBar.addEventListener('mousedown', (e) => {
      if(e.target.classList.contains('win-btn')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      initialLeft = this.element.offsetLeft;
      initialTop = this.element.offsetTop;
      document.body.style.cursor = 'move';
    });

    // Resizing
    let isResizing = false;
    let resizeStartX, resizeStartY, initialWidth, initialHeight;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      e.stopPropagation(); // prevent window focus fighting
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      initialWidth = this.element.offsetWidth;
      initialHeight = this.element.offsetHeight;
    });

    // Global Mouse Move/Up
    window.addEventListener('mousemove', (e) => {
      if (isDragging) {
        e.preventDefault();
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        this.element.style.left = `${initialLeft + dx}px`;
        this.element.style.top = `${initialTop + dy}px`;
      }
      if (isResizing) {
        e.preventDefault();
        const dx = e.clientX - resizeStartX;
        const dy = e.clientY - resizeStartY;
        const newW = Math.max(this.minWidth, initialWidth + dx);
        const newH = Math.max(this.minHeight, initialHeight + dy);
        this.element.style.width = `${newW}px`;
        this.element.style.height = `${newH}px`;
        this.onResize(newW, newH);
      }
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      isResizing = false;
      document.body.style.cursor = 'default';
    });
  }

  cleanup() {
    // Override in subclass/instance if needed
  }
  onResize(w, h) {
    // Override
  }
  onFocus() {
    // Override
  }
}

// --- Application Logic ---

const socket = io({ transports: ['websocket'] });
const wm = new WindowManager();

// Clock
setInterval(() => {
  const now = new Date();
  document.getElementById('clock').innerText = now.toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'});
}, 1000);

// Status Indicator
socket.on('connect', () => {
  document.getElementById('status-indicator').style.background = '#4cd964'; // Green
  const loading = document.getElementById('loading-screen');
  if (loading) {
      loading.style.opacity = '0';
      setTimeout(() => loading.remove(), 500);
  }
});
socket.on('disconnect', () => {
  document.getElementById('status-indicator').style.background = '#ff5f56'; // Red
});

// --- App Definitions ---

const App = {
  // 1. Terminal App
  openTerminal: (sessionId = null) => {
    // If no sessionId, ask server to create one, then open window
    if (!sessionId) {
        socket.emit('create-session', (newSession) => {
            App.createTerminalWindow(newSession.id, newSession.name);
        });
    } else {
        // Reuse logic implies we need name. For simplicity, generic name if reconnecting without list.
        App.createTerminalWindow(sessionId, 'Terminal');
    }
  },

  createTerminalWindow: (sessionId, name) => {
    const win = wm.createWindow({
      title: name || 'Terminal',
      icon: 'fas fa-terminal',
      width: 640,
      height: 400
    });

    // Setup xterm
    const termContainer = document.createElement('div');
    termContainer.className = 'terminal-container';
    win.contentArea.appendChild(termContainer);

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'monospace',
      fontSize: 14,
      theme: { background: '#000000', foreground: '#f0f0f0' },
      allowTransparency: true
    });
    
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon.WebLinksAddon());
    
    term.open(termContainer);
    fitAddon.fit();

    // Socket Logic for this specific terminal
    socket.emit('subscribe-session', sessionId);

    // Incoming data
    const dataHandler = (msg) => {
        if (msg.sessionId === sessionId) {
            term.write(msg.data);
        }
    };
    
    const historyHandler = (msg) => {
        if (msg.sessionId === sessionId) {
            term.reset();
            term.write(msg.history);
        }
    };

    socket.on('output', dataHandler);
    socket.on('history', historyHandler);

    // Outgoing data
    term.onData(data => {
        socket.emit('terminal-input', { sessionId, data });
    });

    // Window hooks
    win.onResize = () => {
        fitAddon.fit();
        socket.emit('terminal-resize', { sessionId, cols: term.cols, rows: term.rows });
    };

    win.onFocus = () => {
        term.focus();
    };

    // Cleanup
    win.cleanup = () => {
        socket.off('output', dataHandler);
        socket.off('history', historyHandler);
        term.dispose();
    };

    // Initial resize sync
    setTimeout(() => win.onResize(), 100);
  },

  // 2. File Manager App
  openFileManager: (path = '') => {
    const win = wm.createWindow({
        title: 'File Manager',
        icon: 'fas fa-folder-open',
        width: 500,
        height: 350
    });

    win.contentArea.innerHTML = `
        <div class="fm-layout">
            <div class="fm-toolbar">
                <button class="btn" id="btn-up"><i class="fas fa-arrow-up"></i></button>
                <div class="fm-path" id="path-display">Loading...</div>
                <button class="btn" id="btn-refresh"><i class="fas fa-sync"></i></button>
            </div>
            <div class="fm-grid" id="file-grid"></div>
        </div>
    `;

    let currentPath = path;

    const renderFiles = (data) => {
        if (data.error) {
            alert(data.error);
            return;
        }
        currentPath = data.path;
        win.element.querySelector('#path-display').textContent = currentPath;
        const grid = win.element.querySelector('#file-grid');
        grid.innerHTML = '';

        data.items.forEach(item => {
            const el = document.createElement('div');
            el.className = `fm-item ${item.isDirectory ? 'dir' : 'file'}`;
            el.innerHTML = `
                <i class="fas ${item.isDirectory ? 'fa-folder' : 'fa-file'}"></i>
                <span>${item.name}</span>
            `;
            el.ondblclick = () => {
                if (item.isDirectory) {
                    loadPath(currentPath + (currentPath.endsWith('/') ? '' : '/') + item.name);
                } else {
                    // Simple text viewer for file
                    App.openTextViewer(currentPath + (currentPath.endsWith('/') ? '' : '/') + item.name);
                }
            };
            grid.appendChild(el);
        });
    };

    const loadPath = (p) => {
        socket.emit('fs-list', { path: p }, renderFiles);
    };

    // Initial Load
    loadPath('');

    // Controls
    win.element.querySelector('#btn-up').onclick = () => {
        loadPath(currentPath + '/..');
    };
    win.element.querySelector('#btn-refresh').onclick = () => {
        loadPath(currentPath);
    };
  },

  // 3. Text Viewer (Helper for Files)
  openTextViewer: (filePath) => {
      const win = wm.createWindow({
          title: filePath.split('/').pop(),
          icon: 'fas fa-file-alt',
          width: 500, height: 400
      });
      win.contentArea.innerHTML = '<pre style="padding:10px; color:#ddd; font-family:monospace; margin:0; overflow:auto; height:100%">Loading...</pre>';
      
      socket.emit('fs-read', { path: filePath }, (res) => {
          if(res.error) win.contentArea.innerHTML = `<div style="color:red;padding:10px">${res.error}</div>`;
          else win.contentArea.querySelector('pre').textContent = res.content;
      });
  },

  // 4. System Monitor
  openSystemMonitor: () => {
      const win = wm.createWindow({
          title: 'System Monitor',
          icon: 'fas fa-microchip',
          width: 300, height: 250
      });

      win.contentArea.innerHTML = `
        <div class="sys-layout" id="sys-content">Loading...</div>
      `;

      const updateInfo = () => {
          socket.emit('get-sys-info', (info) => {
              if(!win.element.parentElement) return; // Window closed
              
              const totalMemGB = (info.totalMem / 1024 / 1024 / 1024).toFixed(1);
              const freeMemGB = (info.freeMem / 1024 / 1024 / 1024).toFixed(1);
              const usedMemPerc = ((info.totalMem - info.freeMem) / info.totalMem * 100).toFixed(0);

              win.contentArea.querySelector('#sys-content').innerHTML = `
                <div class="sys-row">
                    <div class="sys-label">OS: ${info.platform} (${info.arch})</div>
                    <div class="sys-label">Host: ${info.hostname}</div>
                </div>
                <div class="sys-row">
                    <div class="sys-label">Memory (${usedMemPerc}%)</div>
                    <div class="sys-bar-bg"><div class="sys-bar-fill" style="width:${usedMemPerc}%"></div></div>
                    <div style="text-align:right; font-size:10px; margin-top:2px">${freeMemGB}GB free / ${totalMemGB}GB</div>
                </div>
                <div class="sys-row">
                    <div class="sys-label">Uptime: ${(info.uptime/3600).toFixed(1)} hrs</div>
                </div>
              `;
          });
      };
      
      updateInfo();
      const interval = setInterval(updateInfo, 2000);
      win.cleanup = () => clearInterval(interval);
  }
};

// Global accessor
window.app = App;

// Initial Load: Check for existing sessions
socket.on('sessions-list', (list) => {
    // If sessions exist, open windows for them
    if (list.length > 0) {
        list.forEach(s => {
            App.createTerminalWindow(s.id, s.name);
        });
    }
});

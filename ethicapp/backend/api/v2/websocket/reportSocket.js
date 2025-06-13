const WebSocket = require('ws');
const activityWorkerManager = require('../workers/ActivityWorkerManager');

class ReportSocketManager {
  constructor() {
    this.wss = null;
    this.userConnections = new Map(); // Map<userId, WebSocket>
  }

  initialize(server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/live-reports'
    });
    
    
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const userId = url.searchParams.get('userId');
      const token = url.searchParams.get('token');
      
      
      if (userId) {
        this.userConnections.set(userId, ws);
        
        ws.send(JSON.stringify({
          type: 'connection_established',
          userId,
          timestamp: new Date().toISOString()
        }));
        
        ws.on('close', () => {
          this.userConnections.delete(userId);
        });
        
        ws.on('error', (error) => {
          console.error(`❌ WebSocket error for user ${userId}:`, error);
        });
        
      } else {
        ws.close(1008, 'User not identified');
      }
    });

    activityWorkerManager.setWebSocketManager(this);
  }

  sendToUser(userId, message) {
    const ws = this.userConnections.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  getConnectedUsers() {
    return Array.from(this.userConnections.keys());
  }
}

const reportSocketManager = new ReportSocketManager();

function initializeWebSocket(server) {
  reportSocketManager.initialize(server);
}

module.exports = {
  initializeWebSocket,
  reportSocketManager
};



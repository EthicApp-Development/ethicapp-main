const axios = require('axios');

const API_HOST = process.env.API_HOST || 'localhost';
const API_PORT = process.env.API_PORT || 5050;
const API_PROTOCOL = process.env.NODE_ENV === 'production' ? 'https' : 'http';

let baseUrl;

if (API_HOST === "localhost") {
  baseUrl = `${API_PROTOCOL}://localhost:${API_PORT}/api/v2`;
} else {
  baseUrl = `${API_PROTOCOL}://${API_HOST}/api/v2`;
}

class ActivityWorkerManager {
  constructor() {
    this.activeWorkers = new Map();
    this.workerInterval = 5000; // 5 segundos
    this.websocketManager = null;
    this.testServer = null; 
  }

  setTestServer(server) {
    this.testServer = server;
  }

  setWebSocketManager(websocketManager) {
    this.websocketManager = websocketManager;
  }

  getBaseUrl() {
    if (process.env.NODE_ENV === 'test' && this.testServer) {
      const port = this.testServer.address()?.port;
      return `http://localhost:${port}/api/v2`;
    }
    return baseUrl;
  }

  startActivityWorker(activityId, userId, config = {}) {
    if (this.activeWorkers.has(activityId)) {
      return;
    }

    const interval = config.interval || this.workerInterval;

    const workerInterval = setInterval(async () => {
      await this.generateLiveReport(activityId, userId);
    }, interval);

    this.activeWorkers.set(activityId, {
      interval: workerInterval,
      userId,
      startedAt: new Date()
    });

    // Generar primer reporte después de 1 segundo
    setTimeout(() => {
      this.generateLiveReport(activityId, userId);
    }, 1000);
  }

  async generateLiveReport(activityId, userId) {
    try {
      
      const apiBaseUrl = this.getBaseUrl();
      const url = `${apiBaseUrl}/teacher/activities/${activityId}/state`;
      
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.generateInternalToken(userId)}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 segundos timeout
      });

      const reportData = {
        activityId,
        report: response.data,
        generatedAt: new Date().toISOString(),
        fromCache: response.headers['x-from-cache'] === 'true'
      };

      // Enviar via WebSocket
      if (this.websocketManager) {
        const sent = this.websocketManager.sendToUser(userId.toString(), {
          type: 'live_report_update',
          data: reportData
        });

        
      } else {
        console.log('⚠️  WebSocket manager not initialized');
      }

    } catch (error) {
      
      // Notificar error
      if (this.websocketManager) {
        this.websocketManager.sendToUser(userId.toString(), {
          type: 'live_report_error',
          data: {
            activityId,
            error: 'Error generating real-time report',
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  }

  stopActivityWorker(activityId) {
    const worker = this.activeWorkers.get(activityId);
    if (worker) {
      clearInterval(worker.interval);
      this.activeWorkers.delete(activityId);
      return true;
    }
    return false;
  }

  generateInternalToken(userId) {
    return process.env.INTERNAL_API_TOKEN || 'internal-service-token';
  }

  getActiveWorkers() {
    const workers = {};
    this.activeWorkers.forEach((worker, activityId) => {
      workers[activityId] = {
        userId: worker.userId,
        startedAt: worker.startedAt,
        runningFor: Date.now() - worker.startedAt.getTime()
      };
    });
    return workers;
  }

  stopAllWorkers() {
    this.activeWorkers.forEach((worker) => {
      clearInterval(worker.interval);
    });
    this.activeWorkers.clear();
  }
}

module.exports = new ActivityWorkerManager();



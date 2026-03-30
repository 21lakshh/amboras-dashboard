import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class AnalyticsNotificationService {
  private server?: Server;
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();

  setServer(server: Server) {
    this.server = server;
  }

  scheduleStoreUpdate(storeId: string) {
    const existingTimer = this.pendingTimers.get(storeId);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.server?.to(`store:${storeId}`).emit('analytics.updated', {
        scopes: ['overview', 'recent-activity'],
        asOf: new Date().toISOString(),
      });
      this.pendingTimers.delete(storeId);
    }, 500);

    this.pendingTimers.set(storeId, timer);
  }
}

import { Logger, UnauthorizedException } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { AnalyticsNotificationService } from './analytics-notification.service';

@WebSocketGateway({
  namespace: '/analytics',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class AnalyticsGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AnalyticsGateway.name);

  constructor(
    private readonly authService: AuthService,
    private readonly notificationService: AnalyticsNotificationService,
  ) {}

  afterInit(server: Server) {
    this.notificationService.setServer(server);
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractSocketToken(client);
      const storeContext = await this.authService.authenticate(token);
      client.data.storeContext = storeContext;
      await client.join(`store:${storeContext.storeId}`);
    } catch (error) {
      this.logger.warn(`Socket authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      client.disconnect();
    }
  }

  private extractSocketToken(client: Socket) {
    const authToken = client.handshake.auth.token;

    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }

    const header = client.handshake.headers.authorization;

    if (typeof header === 'string') {
      return this.authService.extractBearerToken(header);
    }

    throw new UnauthorizedException('Missing websocket token.');
  }
}

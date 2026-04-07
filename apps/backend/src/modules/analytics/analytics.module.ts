import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsGateway } from './analytics.gateway';
import { AnalyticsNotificationService } from './analytics-notification.service';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsNotificationService, AnalyticsGateway],
})
export class AnalyticsModule {}
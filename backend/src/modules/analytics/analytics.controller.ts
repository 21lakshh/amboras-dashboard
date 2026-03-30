import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { StoreContext } from '../auth/auth.types';
import { AnalyticsService } from './analytics.service';
import type { AnalyticsIngestPayload } from './analytics.types';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @UseGuards(AuthGuard)
  async getOverview(@Req() request: Request & { user: StoreContext }) {
    return this.analyticsService.getOverview(request.user);
  }

  @Get('top-products')
  @UseGuards(AuthGuard)
  async getTopProducts(@Req() request: Request & { user: StoreContext }) {
    return this.analyticsService.getTopProducts(request.user);
  }

  @Get('recent-activity')
  @UseGuards(AuthGuard)
  async getRecentActivity(@Req() request: Request & { user: StoreContext }) {
    return this.analyticsService.getRecentActivity(request.user);
  }

  @Post('events')
  @HttpCode(202)
  async ingestEvent(
    @Headers('x-ingest-key') ingestKey: string | undefined,
    @Body() payload: AnalyticsIngestPayload,
  ) {
    await this.analyticsService.validateIngestKey(ingestKey);
    return this.analyticsService.ingestEvent(payload);
  }
}

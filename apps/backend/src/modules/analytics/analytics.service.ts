import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import type { StoreContext } from '../auth/auth.types';
import {
  ANALYTICS_EVENT_TYPES,
  type AnalyticsEventType,
  type AnalyticsIngestPayload,
  type AnalyticsOverviewResponse,
  type AnalyticsSnapshot,
  type PersistedAnalyticsEvent,
  type RecentActivityResponse,
  type TopProductResponse,
} from './analytics.types';
import { AnalyticsNotificationService } from './analytics-notification.service';

interface StoreMetadata {
  storeId: string;
  timezone: string;
  currency: string;
}

interface PeriodInfo {
  dayKey: string;
  weekKey: string;
  monthKey: string;
  monthStartUtc: string;
  monthEndUtc: string;
  weekStartUtc: string;
  weekEndUtc: string;
  dayStartUtc: string;
  dayEndUtc: string;
}

interface RedisKeys {
  warm: string;
  recent: string;
  eventCountsMonth: string;
  revenueDay: string;
  revenueWeek: string;
  revenueMonth: string;
  topProductsMonth: string;
  productPurchasesMonth: string;
}

const EMPTY_EVENT_COUNTS = {
  page_view: 0,
  add_to_cart: 0,
  remove_from_cart: 0,
  checkout_started: 0,
  purchase: 0,
} satisfies Record<AnalyticsEventType, number>;

@Injectable()
export class AnalyticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly queue: PersistedAnalyticsEvent[] = [];
  private flushTimer?: NodeJS.Timeout;
  private isFlushing = false;
  private readonly rebuildPromises = new Map<string, Promise<AnalyticsSnapshot>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
    private readonly notificationService: AnalyticsNotificationService,
  ) {
    this.flushIntervalMs = Number(this.configService.get('ANALYTICS_BATCH_INTERVAL_MS') ?? 2000);
    this.batchSize = Number(this.configService.get('ANALYTICS_BATCH_SIZE') ?? 1000);
  }

  async onModuleInit() {
    try {
      await this.redisService.ensureConnection();
    } catch {
      // Redis can come up later; reads will rebuild from Postgres when needed.
    }

    this.flushTimer = setInterval(() => {
      void this.flushQueue();
    }, this.flushIntervalMs);
  }

  async onModuleDestroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    await this.flushQueue();
  }

  async getOverview(storeContext: StoreContext): Promise<AnalyticsOverviewResponse> {
    const snapshot = await this.getSnapshot(storeContext);
    return snapshot.overview;
  }

  async getTopProducts(storeContext: StoreContext): Promise<TopProductResponse[]> {
    const snapshot = await this.getSnapshot(storeContext);
    return snapshot.topProducts;
  }

  async getRecentActivity(storeContext: StoreContext): Promise<RecentActivityResponse[]> {
    const snapshot = await this.getSnapshot(storeContext);
    return snapshot.recentActivity;
  }

  async validateIngestKey(key?: string) {
    const ingestKey = this.configService.get<string>('ANALYTICS_INGEST_API_KEY');

    if (!ingestKey) {
      throw new InternalServerErrorException('ANALYTICS_INGEST_API_KEY is not configured.');
    }

    if (!key || key !== ingestKey) {
      throw new UnauthorizedException('Invalid ingest key.');
    }
  }

  async ingestEvent(payload: AnalyticsIngestPayload) {
    const normalizedEvent = await this.normalizeEvent(payload);
    const dedupeAccepted = await this.registerDeduplication(normalizedEvent);

    if (!dedupeAccepted) {
      return {
        accepted: false,
        duplicate: true,
      };
    }

    this.queue.push(normalizedEvent);

    if (this.queue.length >= this.batchSize) {
      void this.flushQueue();
    }

    try {
      await this.applyRedisMaterializations(normalizedEvent);
      this.notificationService.scheduleStoreUpdate(normalizedEvent.storeId);
    } catch {
      // If Redis is unavailable, Postgres remains the durable source and the cache
      // will rebuild on the next read once Redis is back.
    }

    return {
      accepted: true,
      duplicate: false,
    };
  }

  private async normalizeEvent(payload: AnalyticsIngestPayload): Promise<PersistedAnalyticsEvent> {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('A JSON event payload is required.');
    }

    if (!payload.event_id || !payload.store_id || !payload.event_type || !payload.timestamp) {
      throw new BadRequestException('event_id, store_id, event_type, and timestamp are required.');
    }

    if (!ANALYTICS_EVENT_TYPES.includes(payload.event_type)) {
      throw new BadRequestException('Unsupported event_type.');
    }

    const timestamp = DateTime.fromISO(payload.timestamp, { zone: 'utc' });

    if (!timestamp.isValid) {
      throw new BadRequestException('timestamp must be a valid ISO-8601 date.');
    }

    const storeMetadata = await this.getStoreMetadataById(payload.store_id);
    const amountCents =
      payload.data?.amount === undefined || payload.data.amount === null
        ? null
        : Math.round(Number(payload.data.amount) * 100);

    if (amountCents !== null && Number.isNaN(amountCents)) {
      throw new BadRequestException('data.amount must be numeric when provided.');
    }

    return {
      eventId: payload.event_id,
      storeId: payload.store_id,
      eventType: payload.event_type,
      timestamp: timestamp.toUTC().toISO() ?? new Date().toISOString(),
      productId: payload.data?.product_id ?? null,
      amountCents,
      currency: payload.data?.currency ?? storeMetadata.currency,
      rawData: payload.data ?? {},
      storeContext: {
        storeId: storeMetadata.storeId,
        timezone: storeMetadata.timezone,
        currency: storeMetadata.currency,
      },
    };
  }

  private async getStoreMetadataById(storeId: string): Promise<StoreMetadata> {
    const result = await this.databaseService.query<{
      id: string;
      name: string | null;
      timezone: string;
      currency: string;
    }>(
      `
        SELECT
          id::text AS id,
          name,
          timezone,
          currency
        FROM stores
        WHERE id::text = $1
        LIMIT 1
      `,
      [storeId],
    );

    const store = result.rows[0];

    if (!store) {
      throw new ForbiddenException('The provided store_id does not exist.');
    }

    return {
      storeId: store.id,
      timezone: store.timezone,
      currency: store.currency,
    };
  }

  private getPeriodInfo(timezone: string, timestamp = DateTime.utc()): PeriodInfo {
    const zonedTimestamp = timestamp.setZone(timezone);
    const monthStart = zonedTimestamp.startOf('month');
    const monthEnd = monthStart.plus({ months: 1 });
    const weekStart = zonedTimestamp.startOf('week');
    const weekEnd = weekStart.plus({ weeks: 1 });
    const dayStart = zonedTimestamp.startOf('day');
    const dayEnd = dayStart.plus({ days: 1 });

    return {
      dayKey: zonedTimestamp.toFormat('yyyy-LL-dd'),
      weekKey: zonedTimestamp.toFormat("kkkk-'W'WW"),
      monthKey: zonedTimestamp.toFormat('yyyy-LL'),
      monthStartUtc: monthStart.toUTC().toISO() ?? new Date().toISOString(),
      monthEndUtc: monthEnd.toUTC().toISO() ?? new Date().toISOString(),
      weekStartUtc: weekStart.toUTC().toISO() ?? new Date().toISOString(),
      weekEndUtc: weekEnd.toUTC().toISO() ?? new Date().toISOString(),
      dayStartUtc: dayStart.toUTC().toISO() ?? new Date().toISOString(),
      dayEndUtc: dayEnd.toUTC().toISO() ?? new Date().toISOString(),
    };
  }

  private getRedisKeys(storeId: string, periodInfo: PeriodInfo): RedisKeys {
    return {
      warm: `analytics:store:${storeId}:warm:${periodInfo.monthKey}`,
      recent: `analytics:store:${storeId}:recent`,
      eventCountsMonth: `analytics:store:${storeId}:events:${periodInfo.monthKey}`,
      revenueDay: `analytics:store:${storeId}:revenue:day:${periodInfo.dayKey}`,
      revenueWeek: `analytics:store:${storeId}:revenue:week:${periodInfo.weekKey}`,
      revenueMonth: `analytics:store:${storeId}:revenue:month:${periodInfo.monthKey}`,
      topProductsMonth: `analytics:store:${storeId}:products:${periodInfo.monthKey}`,
      productPurchasesMonth: `analytics:store:${storeId}:product-purchases:${periodInfo.monthKey}`,
    };
  }

  private async getSnapshot(storeContext: StoreContext) {
    const cachedSnapshot = await this.readSnapshotFromRedis(storeContext);

    if (cachedSnapshot) {
      return cachedSnapshot;
    }

    return this.rebuildStoreCache(storeContext);
  }

  private async readSnapshotFromRedis(storeContext: StoreContext): Promise<AnalyticsSnapshot | null> {
    const periodInfo = this.getPeriodInfo(storeContext.timezone);
    const redisKeys = this.getRedisKeys(storeContext.storeId, periodInfo);

    try {
      await this.redisService.ensureConnection();
      const isWarm = await this.redisService.client.get(redisKeys.warm);

      if (!isWarm) {
        return null;
      }

      const [dayRevenue, weekRevenue, monthRevenue, rawEventCounts, rawRecent, topProducts, purchaseCounts] =
        await Promise.all([
          this.redisService.client.get(redisKeys.revenueDay),
          this.redisService.client.get(redisKeys.revenueWeek),
          this.redisService.client.get(redisKeys.revenueMonth),
          this.redisService.client.hgetall(redisKeys.eventCountsMonth),
          this.redisService.client.lrange(redisKeys.recent, 0, 19),
          this.redisService.client.zrevrange(redisKeys.topProductsMonth, 0, 9, 'WITHSCORES'),
          this.redisService.client.hgetall(redisKeys.productPurchasesMonth),
        ]);

      const eventCounts = { ...EMPTY_EVENT_COUNTS };

      for (const eventType of ANALYTICS_EVENT_TYPES) {
        eventCounts[eventType] = Number(rawEventCounts[eventType] ?? 0);
      }

      const conversionRate =
        eventCounts.page_view > 0 ? (eventCounts.purchase / eventCounts.page_view) * 100 : 0;

      const topProductRows: TopProductResponse[] = [];

      for (let index = 0; index < topProducts.length; index += 2) {
        const productId = topProducts[index];
        const revenueCents = Number(topProducts[index + 1] ?? 0);

        topProductRows.push({
          productId,
          revenueCents,
          purchaseCount: Number(purchaseCounts[productId] ?? 0),
        });
      }

      return {
        overview: {
          revenue: {
            today: Number(dayRevenue ?? 0),
            week: Number(weekRevenue ?? 0),
            month: Number(monthRevenue ?? 0),
          },
          eventCounts,
          conversionRate,
          currency: storeContext.currency,
          timezone: storeContext.timezone,
          asOf: new Date().toISOString(),
        },
        topProducts: topProductRows,
        recentActivity: rawRecent.map((value) => JSON.parse(value) as RecentActivityResponse),
      };
    } catch {
      return null;
    }
  }

  private async rebuildStoreCache(storeContext: StoreContext): Promise<AnalyticsSnapshot> {
    const periodInfo = this.getPeriodInfo(storeContext.timezone);
    const rebuildKey = `${storeContext.storeId}:${periodInfo.monthKey}`;
    const existingPromise = this.rebuildPromises.get(rebuildKey);

    if (existingPromise) {
      return existingPromise;
    }

    const rebuildPromise = this.rebuildStoreCacheInternal(storeContext, periodInfo);
    this.rebuildPromises.set(rebuildKey, rebuildPromise);

    try {
      return await rebuildPromise;
    } finally {
      this.rebuildPromises.delete(rebuildKey);
    }
  }

  private async rebuildStoreCacheInternal(
    storeContext: StoreContext,
    periodInfo: PeriodInfo,
  ): Promise<AnalyticsSnapshot> {
    const [revenueResult, eventCountsResult, topProductsResult, recentActivityResult] = await Promise.all([
      this.databaseService.query<{
        bucket: 'day' | 'week' | 'month';
        revenue_cents: string | null;
      }>(
        `
          SELECT 'day' AS bucket, COALESCE(SUM(amount_cents), 0)::text AS revenue_cents
          FROM analytics_events
          WHERE store_id = $1
            AND event_type = 'purchase'
            AND event_timestamp >= $2
            AND event_timestamp < $3
          UNION ALL
          SELECT 'week' AS bucket, COALESCE(SUM(amount_cents), 0)::text AS revenue_cents
          FROM analytics_events
          WHERE store_id = $1
            AND event_type = 'purchase'
            AND event_timestamp >= $4
            AND event_timestamp < $5
          UNION ALL
          SELECT 'month' AS bucket, COALESCE(SUM(amount_cents), 0)::text AS revenue_cents
          FROM analytics_events
          WHERE store_id = $1
            AND event_type = 'purchase'
            AND event_timestamp >= $6
            AND event_timestamp < $7
        `,
        [
          storeContext.storeId,
          periodInfo.dayStartUtc,
          periodInfo.dayEndUtc,
          periodInfo.weekStartUtc,
          periodInfo.weekEndUtc,
          periodInfo.monthStartUtc,
          periodInfo.monthEndUtc,
        ],
      ),
      this.databaseService.query<{
        event_type: AnalyticsEventType;
        count: string;
      }>(
        `
          SELECT event_type, COUNT(*)::text AS count
          FROM analytics_events
          WHERE store_id = $1
            AND event_timestamp >= $2
            AND event_timestamp < $3
          GROUP BY event_type
        `,
        [storeContext.storeId, periodInfo.monthStartUtc, periodInfo.monthEndUtc],
      ),
      this.databaseService.query<{
        product_id: string;
        revenue_cents: string;
        purchase_count: string;
      }>(
        `
          SELECT
            product_id,
            COALESCE(SUM(amount_cents), 0)::text AS revenue_cents,
            COUNT(*)::text AS purchase_count
          FROM analytics_events
          WHERE store_id = $1
            AND event_type = 'purchase'
            AND event_timestamp >= $2
            AND event_timestamp < $3
            AND product_id IS NOT NULL
          GROUP BY product_id
          ORDER BY COALESCE(SUM(amount_cents), 0) DESC
          LIMIT 10
        `,
        [storeContext.storeId, periodInfo.monthStartUtc, periodInfo.monthEndUtc],
      ),
      this.databaseService.query<{
        event_id: string;
        event_type: AnalyticsEventType;
        event_timestamp: string;
        product_id: string | null;
        amount_cents: number | null;
        currency: string | null;
      }>(
        `
          SELECT
            event_id,
            event_type,
            event_timestamp::text,
            product_id,
            amount_cents,
            currency
          FROM analytics_events
          WHERE store_id = $1
          ORDER BY event_timestamp DESC
          LIMIT 20
        `,
        [storeContext.storeId],
      ),
    ]);

    const revenueMap = revenueResult.rows.reduce<Record<string, number>>((accumulator, row) => {
      accumulator[row.bucket] = Number(row.revenue_cents ?? 0);
      return accumulator;
    }, {});

    const eventCounts = { ...EMPTY_EVENT_COUNTS };

    for (const row of eventCountsResult.rows) {
      eventCounts[row.event_type] = Number(row.count);
    }

    const conversionRate =
      eventCounts.page_view > 0 ? (eventCounts.purchase / eventCounts.page_view) * 100 : 0;

    const topProducts = topProductsResult.rows.map<TopProductResponse>((row) => ({
      productId: row.product_id,
      revenueCents: Number(row.revenue_cents),
      purchaseCount: Number(row.purchase_count),
    }));

    const recentActivity = recentActivityResult.rows.map<RecentActivityResponse>((row) => ({
      eventId: row.event_id,
      eventType: row.event_type,
      timestamp: new Date(row.event_timestamp).toISOString(),
      productId: row.product_id,
      amountCents: row.amount_cents,
      currency: row.currency,
    }));

    const snapshot: AnalyticsSnapshot = {
      overview: {
        revenue: {
          today: revenueMap.day ?? 0,
          week: revenueMap.week ?? 0,
          month: revenueMap.month ?? 0,
        },
        eventCounts,
        conversionRate,
        currency: storeContext.currency,
        timezone: storeContext.timezone,
        asOf: new Date().toISOString(),
      },
      topProducts,
      recentActivity,
    };

    try {
      await this.redisService.ensureConnection();
      await this.writeSnapshotToRedis(storeContext, periodInfo, snapshot);
    } catch {
      // Redis can be rebuilt on a later request.
    }

    return snapshot;
  }

  private async writeSnapshotToRedis(
    storeContext: StoreContext,
    periodInfo: PeriodInfo,
    snapshot: AnalyticsSnapshot,
  ) {
    const redisKeys = this.getRedisKeys(storeContext.storeId, periodInfo);
    const pipeline = this.redisService.client.multi();

    pipeline.set(redisKeys.warm, '1');
    pipeline.set(redisKeys.revenueDay, String(snapshot.overview.revenue.today));
    pipeline.set(redisKeys.revenueWeek, String(snapshot.overview.revenue.week));
    pipeline.set(redisKeys.revenueMonth, String(snapshot.overview.revenue.month));
    pipeline.del(redisKeys.eventCountsMonth);
    pipeline.hset(redisKeys.eventCountsMonth, snapshot.overview.eventCounts as Record<string, string | number>);
    pipeline.del(redisKeys.topProductsMonth);
    pipeline.del(redisKeys.productPurchasesMonth);
    pipeline.del(redisKeys.recent);

    for (const product of snapshot.topProducts) {
      pipeline.zadd(redisKeys.topProductsMonth, product.revenueCents, product.productId);
      pipeline.hset(redisKeys.productPurchasesMonth, product.productId, product.purchaseCount);
    }

    if (snapshot.recentActivity.length > 0) {
      pipeline.rpush(
        redisKeys.recent,
        ...snapshot.recentActivity.map((event) => JSON.stringify(event)),
      );
      pipeline.ltrim(redisKeys.recent, -20, -1);
    }

    await pipeline.exec();
  }

  private async registerDeduplication(event: PersistedAnalyticsEvent) {
    try {
      await this.redisService.ensureConnection();
      const result = await this.redisService.client.set(
        `analytics:store:${event.storeId}:event:${event.eventId}`,
        '1',
        'EX',
        60 * 60 * 24 * 7,
        'NX',
      );

      return result === 'OK';
    } catch {
      return true;
    }
  }

  private async applyRedisMaterializations(event: PersistedAnalyticsEvent) {
    const parsedTimestamp = DateTime.fromISO(event.timestamp, { zone: 'utc' });
    const eventTimestamp = parsedTimestamp.isValid ? parsedTimestamp : DateTime.utc();
    const periodInfo = this.getPeriodInfo(event.storeContext.timezone, eventTimestamp);
    const redisKeys = this.getRedisKeys(event.storeId, periodInfo);
    const pipeline = this.redisService.client.multi();

    pipeline.set(redisKeys.warm, '1');
    pipeline.hincrby(redisKeys.eventCountsMonth, event.eventType, 1);

    if (event.eventType === 'purchase' && event.amountCents) {
      pipeline.incrby(redisKeys.revenueDay, event.amountCents);
      pipeline.incrby(redisKeys.revenueWeek, event.amountCents);
      pipeline.incrby(redisKeys.revenueMonth, event.amountCents);

      if (event.productId) {
        pipeline.zincrby(redisKeys.topProductsMonth, event.amountCents, event.productId);
        pipeline.hincrby(redisKeys.productPurchasesMonth, event.productId, 1);
      }
    }

    pipeline.lpush(
      redisKeys.recent,
      JSON.stringify({
        eventId: event.eventId,
        eventType: event.eventType,
        timestamp: event.timestamp,
        productId: event.productId,
        amountCents: event.amountCents,
        currency: event.currency,
      } satisfies RecentActivityResponse),
    );
    pipeline.ltrim(redisKeys.recent, 0, 19);

    await pipeline.exec();
  }

  private async flushQueue() {
    if (this.isFlushing || this.queue.length === 0) {
      return;
    }

    this.isFlushing = true;
    const batch = this.queue.splice(0, this.batchSize);

    try {
      await this.databaseService.withClient(async (client) => {
        const values: unknown[] = [];
        const placeholders = batch.map((event, index) => {
          const baseIndex = index * 8;
          values.push(
            event.eventId,
            event.storeId,
            event.eventType,
            event.timestamp,
            event.productId,
            event.amountCents,
            event.currency,
            JSON.stringify(event.rawData),
          );
          return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}::jsonb)`;
        });

        await client.query(
          `
            INSERT INTO analytics_events (
              event_id,
              store_id,
              event_type,
              event_timestamp,
              product_id,
              amount_cents,
              currency,
              data
            )
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (event_id) DO NOTHING
          `,
          values,
        );
      });
    } catch (error) {
      this.queue.unshift(...batch);
      this.logger.error(
        `Failed to flush analytics events: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      this.isFlushing = false;

      if (this.queue.length > 0) {
        void this.flushQueue();
      }
    }
  }
}

import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import type { StoreContext } from './auth.types';

interface AuthPayload {
  userId: string;
  email: string | null;
}

@Injectable()
export class AuthService {
  private readonly jwks;
  private readonly issuer;
  private readonly storeContextCacheTtlSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
  ) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL is required.');
    }

    this.issuer = `${supabaseUrl}/auth/v1`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    this.storeContextCacheTtlSeconds = Number(
      this.configService.get('AUTH_STORE_CONTEXT_TTL_SECONDS') ?? 60 * 15,
    );
  }

  async authenticate(token: string): Promise<StoreContext> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: 'authenticated',
      });

      const authPayload = this.getAuthPayload(payload);
      const cachedStoreContext = await this.getCachedStoreContext(authPayload.userId);

      if (cachedStoreContext) {
        return cachedStoreContext;
      }

      return await this.ensureProvisionedStoreContext(authPayload);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid or expired Supabase token.');
    }
  }

  async getProvisionedUserSummary(storeContext: StoreContext) {
    return {
      userId: storeContext.userId,
      storeId: storeContext.storeId,
      storeName: storeContext.storeName,
      timezone: storeContext.timezone,
      currency: storeContext.currency,
    };
  }

  private getAuthPayload(payload: Awaited<ReturnType<typeof jwtVerify>>['payload']): AuthPayload {
    const userId = payload.sub;

    if (!userId) {
      throw new UnauthorizedException('Token is missing a user subject.');
    }

    return {
      userId,
      email: typeof payload.email === 'string' ? payload.email : null,
    };
  }

  private createDefaultStoreId(userId: string) {
    return userId;
  }

  private createDefaultStoreName(email: string | null) {
    if (!email) {
      return 'Amboras Store';
    }

    const prefix = email.split('@')[0]?.trim();

    if (!prefix) {
      return 'Amboras Store';
    }

    const cleaned = prefix
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');

    if (!cleaned) {
      return 'Amboras Store';
    }

    return `${cleaned
      .split(' ')
      .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
      .join(' ')} Store`;
  }

  private getStoreContextCacheKey(userId: string) {
    return `auth:user:${userId}:store-context`;
  }

  private async getCachedStoreContext(userId: string): Promise<StoreContext | null> {
    try {
      await this.redisService.ensureConnection();
      const serializedContext = await this.redisService.client.get(this.getStoreContextCacheKey(userId));

      if (!serializedContext) {
        return null;
      }

      const parsedContext = JSON.parse(serializedContext) as Omit<StoreContext, 'userId'> & {
        userId?: string;
      };

      if (
        typeof parsedContext.storeId !== 'string' ||
        typeof parsedContext.storeName !== 'string' ||
        typeof parsedContext.timezone !== 'string' ||
        typeof parsedContext.currency !== 'string'
      ) {
        return null;
      }

      return {
        userId,
        storeId: parsedContext.storeId,
        storeName: parsedContext.storeName,
        timezone: parsedContext.timezone,
        currency: parsedContext.currency,
      };
    } catch {
      return null;
    }
  }

  private async cacheStoreContext(storeContext: StoreContext) {
    try {
      await this.redisService.ensureConnection();
      await this.redisService.client.set(
        this.getStoreContextCacheKey(storeContext.userId),
        JSON.stringify({
          storeId: storeContext.storeId,
          storeName: storeContext.storeName,
          timezone: storeContext.timezone,
          currency: storeContext.currency,
        }),
        'EX',
        this.storeContextCacheTtlSeconds,
      );
    } catch {
      // Cache availability should not block auth.
    }
  }

  async ensureProvisionedStoreContext({ userId, email }: AuthPayload): Promise<StoreContext> {
    const defaultStoreId = this.createDefaultStoreId(userId);
    const defaultStoreName = this.createDefaultStoreName(email);

    await this.databaseService.withClient(async (client) => {
      await client.query('BEGIN');

      try {
        const existingStoreResult = await client.query<{ id: string }>(
          `
            SELECT id::text AS id
            FROM stores
            WHERE owner_user_id = $1
            LIMIT 1
          `,
          [userId],
        );

        const provisionedStoreId = existingStoreResult.rows[0]?.id ?? defaultStoreId;

        await client.query(
          `
            INSERT INTO users (id, email, default_store_id, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (id) DO UPDATE
            SET email = EXCLUDED.email,
                default_store_id = EXCLUDED.default_store_id,
                updated_at = now()
          `,
          [userId, email, provisionedStoreId],
        );

        if (existingStoreResult.rows[0]?.id) {
          await client.query(
            `
              UPDATE stores
              SET name = COALESCE(name, $2),
                  timezone = COALESCE(timezone, 'Asia/Kolkata'),
                  currency = COALESCE(currency, 'USD')
              WHERE id::text = $1
            `,
            [provisionedStoreId, defaultStoreName],
          );
        } else {
          await client.query(
            `
              INSERT INTO stores (id, owner_user_id, name, timezone, currency)
              VALUES ($1, $2, $3, 'Asia/Kolkata', 'USD')
            `,
            [provisionedStoreId, userId, defaultStoreName],
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    const storeContext = await this.resolveStoreContext(userId);
    await this.cacheStoreContext(storeContext);
    return storeContext;
  }

  async resolveStoreContext(userId: string): Promise<StoreContext> {
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
        WHERE owner_user_id = $1
        LIMIT 1
      `,
      [userId],
    );

    const store = result.rows[0];

    if (!store) {
      throw new ForbiddenException('No store is linked to this owner.');
    }

    const storeContext = {
      userId,
      storeId: store.id,
      storeName: store.name ?? 'Amboras Store',
      timezone: store.timezone,
      currency: store.currency,
    };

    await this.cacheStoreContext(storeContext);
    return storeContext;
  }

  extractBearerToken(authorizationHeader?: string) {
    if (!authorizationHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    return authorizationHeader.slice('Bearer '.length);
  }
}

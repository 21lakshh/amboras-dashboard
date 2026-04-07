#!/usr/bin/env node

import pg from "pg"

const args = process.argv.slice(2)

function readFlag(name, fallback) {
  const direct = args.find((value) => value.startsWith(`--${name}=`))
  if (direct) {
    return direct.slice(name.length + 3)
  }

  const index = args.findIndex((value) => value === `--${name}`)
  if (index >= 0 && args[index + 1]) {
    return args[index + 1]
  }

  return fallback
}

function hasFlag(name) {
  return args.includes(`--${name}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function deriveStoreId(userId) {
  return userId
}

function createSyntheticStoreIds(storeCount) {
  return Array.from({ length: storeCount }, (_, index) => `load-store-${String(index + 1).padStart(4, "0")}`)
}

function pickEventType(randomValue) {
  if (randomValue < 0.55) return "page_view"
  if (randomValue < 0.73) return "add_to_cart"
  if (randomValue < 0.81) return "remove_from_cart"
  if (randomValue < 0.93) return "checkout_started"
  return "purchase"
}

function createEvent({ eventId, storeId, productId }) {
  const eventType = pickEventType(Math.random())
  const timestamp = new Date(Date.now() - Math.floor(Math.random() * 45_000)).toISOString()
  const payload = {
    event_id: eventId,
    store_id: storeId,
    event_type: eventType,
    timestamp,
    data: {
      product_id: productId,
    },
  }

  if (eventType === "purchase") {
    payload.data.amount = Number((Math.random() * 180 + 20).toFixed(2))
    payload.data.currency = "USD"
  }

  return payload
}

async function seedStores(storeIds) {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to auto-seed synthetic stores.")
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
  })

  await client.connect()

  try {
    await client.query("BEGIN")

    for (const storeId of storeIds) {
      await client.query(
        `
          INSERT INTO stores (id, name, timezone, currency)
          VALUES ($1, $2, 'Asia/Kolkata', 'USD')
          ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              timezone = EXCLUDED.timezone,
              currency = EXCLUDED.currency
        `,
        [storeId, `Load Test Store ${storeId.slice(-4)}`],
      )
    }

    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    await client.end()
  }
}

function printUsage() {
  console.log(`
Analytics load simulator

Examples:
  pnpm load:analytics -- --user-id cb65cec1-db23-4f29-aa59-0e75b375d48f --ingest-key KEY --rate-per-minute 10000 --duration-seconds 60
  pnpm load:analytics -- --store-count 25 --seed-stores --ingest-key KEY --rate-per-minute 10000 --duration-seconds 60 --concurrency 100
  pnpm load:analytics -- --store-ids store-a,store-b,store-c --ingest-key KEY --rate-per-minute 6000 --duration-seconds 120

Flags:
  --base-url             Backend base URL (default: http://localhost:4000)
  --ingest-key           Required ingest key
  --user-id              Use the auto-provisioned store for this Supabase user UUID
  --store-id             Target a single explicit store id
  --store-ids            Comma-separated list of store ids
  --store-count          Create N synthetic store ids (default: 1 if no store ids are given)
  --seed-stores          Upsert synthetic stores into Postgres before sending events
  --rate-per-minute      Target total event rate across all stores (default: 10000)
  --duration-seconds     How long to run the stream (default: 60)
  --concurrency          Max parallel ingest requests per batch (default: 100)
`)
}

async function main() {
  if (hasFlag("help")) {
    printUsage()
    return
  }

  const baseUrl = readFlag("base-url", process.env.ANALYTICS_BASE_URL || "http://localhost:4000")
  const ingestKey = readFlag("ingest-key", process.env.ANALYTICS_INGEST_API_KEY)
  const userId = readFlag("user-id", process.env.SUPABASE_USER_ID)
  const explicitStoreId = readFlag("store-id", process.env.STORE_ID)
  const explicitStoreIds = readFlag("store-ids", process.env.STORE_IDS)
  const storeCount = Number(readFlag("store-count", process.env.ANALYTICS_STORE_COUNT || "1"))
  const shouldSeedStores = hasFlag("seed-stores") || process.env.ANALYTICS_SEED_STORES === "true"
  const ratePerMinute = Number(readFlag("rate-per-minute", process.env.ANALYTICS_RATE_PER_MINUTE || "10000"))
  const durationSeconds = Number(readFlag("duration-seconds", process.env.ANALYTICS_DURATION_SECONDS || "60"))
  const concurrency = Number(readFlag("concurrency", process.env.ANALYTICS_CONCURRENCY || "100"))

  if (!ingestKey) {
    throw new Error("Missing ingest key. Pass --ingest-key or set ANALYTICS_INGEST_API_KEY.")
  }

  if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0) {
    throw new Error("Rate per minute must be a positive number.")
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Duration seconds must be a positive number.")
  }

  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error("Concurrency must be a positive number.")
  }

  let storeIds = []

  if (explicitStoreIds) {
    storeIds = explicitStoreIds
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  } else if (explicitStoreId) {
    storeIds = [explicitStoreId]
  } else if (userId) {
    storeIds = [deriveStoreId(userId)]
  } else {
    if (!Number.isFinite(storeCount) || storeCount <= 0) {
      throw new Error("Store count must be a positive number.")
    }

    storeIds = createSyntheticStoreIds(storeCount)
  }

  if (shouldSeedStores) {
    await seedStores(storeIds)
  }

  const totalEvents = Math.round((ratePerMinute * durationSeconds) / 60)
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const productIds = ["prod_101", "prod_202", "prod_303", "prod_404", "prod_505", "prod_606"]
  const eventTypeCounts = {
    page_view: 0,
    add_to_cart: 0,
    remove_from_cart: 0,
    checkout_started: 0,
    purchase: 0,
  }
  let sent = 0
  let failed = 0
  let sequence = 0

  console.log("Starting analytics load simulation")
  console.log(`Base URL: ${baseUrl}`)
  console.log(`Run ID: ${runId}`)
  console.log(`Stores: ${storeIds.length}`)
  console.log(`Rate target: ${ratePerMinute} events/minute`)
  console.log(`Duration: ${durationSeconds}s`)
  console.log(`Total events target: ${totalEvents}`)
  console.log(`Concurrency: ${concurrency}`)
  console.log(`Seed stores: ${shouldSeedStores ? "yes" : "no"}`)

  const startedAt = Date.now()
  const eventsPerSecondBase = Math.floor(totalEvents / durationSeconds)
  const eventsRemainder = totalEvents % durationSeconds

  for (let secondIndex = 0; secondIndex < durationSeconds; secondIndex += 1) {
    const secondStartedAt = Date.now()
    const eventsThisSecond = eventsPerSecondBase + (secondIndex < eventsRemainder ? 1 : 0)

    for (let offset = 0; offset < eventsThisSecond; offset += concurrency) {
      const batchSize = Math.min(concurrency, eventsThisSecond - offset)
      const requests = Array.from({ length: batchSize }, async (_, batchIndex) => {
        const currentSequence = sequence
        sequence += 1

        const storeId = storeIds[currentSequence % storeIds.length]
        const productId = productIds[currentSequence % productIds.length]
        const eventId = `evt_${runId}_${secondIndex}_${currentSequence}_${batchIndex}`
        const payload = createEvent({
          eventId,
          storeId,
          productId,
        })

        eventTypeCounts[payload.event_type] += 1

        const response = await fetch(`${baseUrl}/api/v1/analytics/events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ingest-key": ingestKey,
          },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          failed += 1
          const message = await response.text()
          console.error(`Failed event ${eventId}: ${response.status} ${message}`)
          return
        }

        sent += 1
      })

      await Promise.all(requests)
    }

    const elapsedThisSecond = Date.now() - secondStartedAt
    const sleepFor = 1000 - elapsedThisSecond

    if (sleepFor > 0) {
      await sleep(sleepFor)
    }

    const elapsedOverall = Date.now() - startedAt
    const progress = Math.round(((secondIndex + 1) / durationSeconds) * 100)
    console.log(
      `Window ${secondIndex + 1}/${durationSeconds} complete (${progress}%) | sent=${sent} failed=${failed} | elapsed=${elapsedOverall}ms`,
    )
  }

  const durationMs = Date.now() - startedAt
  const actualRatePerMinute = Math.round((sent / Math.max(durationMs, 1)) * 60_000)

  console.log("Completed analytics load simulation")
  console.log(`Accepted events: ${sent}`)
  console.log(`Failed events: ${failed}`)
  console.log(`Duration: ${durationMs}ms`)
  console.log(`Achieved rate: ${actualRatePerMinute} events/minute`)
  console.log("Event type distribution:")
  console.log(JSON.stringify(eventTypeCounts, null, 2))
  console.log("Store ids used:")
  console.log(storeIds.join(", "))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

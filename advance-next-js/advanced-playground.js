/**
 * Advanced JavaScript Playground
 * --------------------------------
 * A self-contained file with practical code examples:
 * - Data processing helpers
 * - Async task queue with retries
 * - Event bus
 * - Caching layer
 * - Simple analytics simulation
 *
 * Run:
 *   node advanced-playground.js
 */

"use strict";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) this.listeners.delete(event);
  }

  emit(event, payload) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`Event handler failed for "${event}":`, error.message);
      }
    }
  }
}

class TTLCache {
  constructor(defaultTtlMs = 30_000) {
    this.defaultTtlMs = defaultTtlMs;
    this.store = new Map();
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    const expiresAt = Date.now() + ttlMs;
    this.store.set(key, { value, expiresAt });
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.store.delete(key);
  }

  clearExpired() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  size() {
    this.clearExpired();
    return this.store.size;
  }
}

class RetryQueue {
  constructor({ concurrency = 2, retries = 3, retryDelay = 200 } = {}) {
    this.concurrency = concurrency;
    this.retries = retries;
    this.retryDelay = retryDelay;
    this.queue = [];
    this.running = 0;
    this.results = [];
  }

  add(task, metadata = {}) {
    this.queue.push({ task, metadata, attempts: 0 });
  }

  async run() {
    if (this.queue.length === 0) return [];
    return new Promise((resolve) => {
      const pump = async () => {
        while (this.running < this.concurrency && this.queue.length > 0) {
          const item = this.queue.shift();
          this.running += 1;
          this.execute(item)
            .then((result) => this.results.push(result))
            .finally(() => {
              this.running -= 1;
              if (this.running === 0 && this.queue.length === 0) resolve(this.results);
              else pump();
            });
        }
      };
      pump();
    });
  }

  async execute(item) {
    const { task, metadata } = item;
    for (let attempt = 1; attempt <= this.retries; attempt += 1) {
      try {
        const value = await task();
        return { ok: true, attempts: attempt, value, metadata };
      } catch (error) {
        if (attempt === this.retries) {
          return { ok: false, attempts: attempt, error: error.message, metadata };
        }
        await wait(this.retryDelay * attempt);
      }
    }
    return { ok: false, attempts: this.retries, error: "Unknown failure", metadata };
  }
}

const analytics = {
  summarizeVisits(visits) {
    const byCountry = new Map();
    const byDevice = new Map();
    let totalDuration = 0;

    for (const visit of visits) {
      byCountry.set(visit.country, (byCountry.get(visit.country) || 0) + 1);
      byDevice.set(visit.device, (byDevice.get(visit.device) || 0) + 1);
      totalDuration += visit.durationSec;
    }

    const averageDuration = visits.length ? totalDuration / visits.length : 0;
    return {
      total: visits.length,
      countries: Object.fromEntries(byCountry),
      devices: Object.fromEntries(byDevice),
      averageDuration: Number(averageDuration.toFixed(2)),
    };
  },

  topPages(visits, limit = 5) {
    const counts = new Map();
    for (const visit of visits) {
      counts.set(visit.page, (counts.get(visit.page) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([page, count]) => ({ page, count }));
  },

  retentionScore(visits) {
    const users = new Map();
    for (const visit of visits) {
      if (!users.has(visit.userId)) users.set(visit.userId, new Set());
      users.get(visit.userId).add(visit.day);
    }
    const retained = [...users.values()].filter((days) => days.size >= 2).length;
    return users.size === 0 ? 0 : Number(((retained / users.size) * 100).toFixed(2));
  },
};

function generateVisits(count = 120) {
  const countries = ["IN", "US", "UK", "DE", "JP"];
  const devices = ["mobile", "desktop", "tablet"];
  const pages = ["/", "/pricing", "/blog", "/dashboard", "/docs", "/contact"];
  const visits = [];

  for (let i = 0; i < count; i += 1) {
    const userId = `u${randomInt(1, 50)}`;
    visits.push({
      id: `v-${i + 1}`,
      userId,
      country: countries[randomInt(0, countries.length - 1)],
      device: devices[randomInt(0, devices.length - 1)],
      page: pages[randomInt(0, pages.length - 1)],
      durationSec: randomInt(5, 600),
      day: randomInt(1, 7),
      createdAt: new Date(Date.now() - randomInt(0, 7 * 24 * 60 * 60 * 1000)).toISOString(),
    });
  }
  return visits;
}

async function fakeApiWrite(record) {
  await wait(randomInt(20, 80));
  if (Math.random() < 0.2) throw new Error("Transient API error");
  return { stored: true, id: record.id };
}

async function main() {
  const bus = new EventBus();
  const cache = new TTLCache(5_000);
  const visits = generateVisits(150);

  bus.on("cache:hit", ({ key }) => console.log(`cache hit -> ${key}`));
  bus.on("cache:miss", ({ key }) => console.log(`cache miss -> ${key}`));
  bus.on("report:ready", ({ report }) => console.log("report ready:", report.total, "visits"));

  function getOrCompute(key, computeFn) {
    const existing = cache.get(key);
    if (existing !== undefined) {
      bus.emit("cache:hit", { key });
      return existing;
    }
    bus.emit("cache:miss", { key });
    const value = computeFn();
    cache.set(key, value);
    return value;
  }

  const report = getOrCompute("weekly-report", () => analytics.summarizeVisits(visits));
  bus.emit("report:ready", { report });
  const topPages = getOrCompute("top-pages", () => analytics.topPages(visits, 3));
  const retention = getOrCompute("retention", () => analytics.retentionScore(visits));

  console.log("\nTop pages:", topPages);
  console.log("Retention score:", `${retention}%`);

  const queue = new RetryQueue({ concurrency: 4, retries: 4, retryDelay: 60 });
  for (const visit of visits.slice(0, 30)) {
    queue.add(() => fakeApiWrite(visit), { visitId: visit.id });
  }

  const results = await queue.run();
  const success = results.filter((r) => r.ok).length;
  const failed = results.length - success;

  console.log("\nUpload results");
  console.log("-------------");
  console.log("Total:", results.length);
  console.log("Success:", success);
  console.log("Failed:", failed);

  if (failed > 0) {
    console.log("\nFailed records:");
    for (const result of results.filter((r) => !r.ok)) {
      console.log(`- ${result.metadata.visitId} after ${result.attempts} attempts (${result.error})`);
    }
  }

  await wait(5_100);
  const removed = cache.clearExpired();
  console.log(`\nExpired cache entries removed: ${removed}`);
  console.log("Current cache size:", cache.size());
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exitCode = 1;
});

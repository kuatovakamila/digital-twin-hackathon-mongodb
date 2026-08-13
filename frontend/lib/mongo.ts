/**
 * MongoDB Atlas connection for the Next.js route layer.
 *
 * Serverless reuses a warm process across requests, so the client is cached on
 * `globalThis` — opening a pool per request would exhaust Atlas connections.
 */

import { MongoClient, type Db } from "mongodb";

/**
 * Hardcoded to match backend/seed.js, which writes here. MONGODB_DB is
 * deliberately ignored: it is set to "rehearsal" in some envs, and honouring
 * it would point at an empty database and silently return no counterparts.
 */
const DB_NAME = "counterpart";

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function connect(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return Promise.reject(new Error("MONGODB_URI is not set"));
  }
  return new MongoClient(uri).connect();
}

// A rejected promise would otherwise be cached for the life of the process,
// so clear it and let the next request retry the connection.
const clientPromise: Promise<MongoClient> =
  globalThis._mongoClientPromise ??
  (globalThis._mongoClientPromise = connect().catch((error) => {
    globalThis._mongoClientPromise = undefined;
    throw error;
  }));

let indexesReady: Promise<void> | undefined;

/** Mirrors the indexes backend/index.js created on startup. Idempotent. */
async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection("traits").createIndex({ counterpartId: 1, category: 1, status: 1 }),
    db.collection("sessions").createIndex({ counterpartId: 1, startedAt: -1 }),
    db.collection("evidence").createIndex({ counterpartId: 1, createdAt: -1 }),
    db.collection("debriefs").createIndex({ sessionId: 1 }),
  ]);
}

export async function getClient(): Promise<MongoClient> {
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  const db = client.db(DB_NAME);

  // Once per cold start. Index creation is an optimisation, so a failure here
  // is logged and retried later rather than failing the request.
  indexesReady ??= ensureIndexes(db).catch((error) => {
    console.error("Index creation failed:", error);
    indexesReady = undefined;
  });
  await indexesReady;

  return db;
}

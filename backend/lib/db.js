const { MongoClient } = require("mongodb");
require("dotenv").config();

let clientPromise;
let dbPromise;

async function connect() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("counterpart");
  await db.command({ ping: 1 });

  console.log("Connected to MongoDB Atlas");

  await db.collection("traits").createIndex({ counterpartId: 1, category: 1, status: 1 });
  await db.collection("sessions").createIndex({ counterpartId: 1, startedAt: -1 });
  await db.collection("evidence").createIndex({ counterpartId: 1, createdAt: -1 });
  await db.collection("debriefs").createIndex({ sessionId: 1 });

  return { client, db };
}

function getClientAndDb() {
  if (!dbPromise) {
    dbPromise = connect().catch((error) => {
      dbPromise = undefined;
      throw error;
    });
  }
  return dbPromise;
}

async function getDb() {
  const { db } = await getClientAndDb();
  return db;
}

async function getClient() {
  const { client } = await getClientAndDb();
  return client;
}

module.exports = { getDb, getClient };

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);
let db;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `"${field}" is required and must be a non-empty string`);
  }
  return value.trim();
}

function requireOneOf(value, field, allowed) {
  const stringValue = requireString(value, field);
  if (!allowed.includes(stringValue)) {
    throw new HttpError(400, `"${field}" must be one of: ${allowed.join(", ")}`);
  }
  return stringValue;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `"${field}" is required and must be an array`);
  }
  return value;
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function startServer() {
  try {
    await client.connect();
    db = client.db("counterpart");
    await db.command({ ping: 1 });

    console.log("Connected to MongoDB Atlas");

    await db.collection("traits").createIndex({ counterpartId: 1, category: 1, status: 1 });
    await db.collection("sessions").createIndex({ counterpartId: 1, startedAt: -1 });
    await db.collection("evidence").createIndex({ counterpartId: 1, createdAt: -1 });
    await db.collection("debriefs").createIndex({ sessionId: 1 });

    app.get("/health", (req, res) => {
      res.json({
        status: "ok",
        database: "connected",
      });
    });

    app.get(
      "/api/counterparts",
      asyncHandler(async (req, res) => {
        const counterparts = await db
          .collection("counterparts")
          .find({}, { projection: { name: 1, role: 1, scenario: 1, userRole: 1 } })
          .sort({ name: 1 })
          .toArray();

        const counts = await db
          .collection("traits")
          .aggregate([
            { $match: { status: "active" } },
            { $group: { _id: "$counterpartId", activeTraits: { $sum: 1 } } },
          ])
          .toArray();

        const byId = Object.fromEntries(counts.map((c) => [c._id, c.activeTraits]));

        res.json({
          counterparts: counterparts.map((c) => ({
            ...c,
            activeTraits: byId[c._id] || 0,
          })),
        });
      })
    );

    app.post(
      "/api/counterparts",
      asyncHandler(async (req, res) => {
        const name = requireString(req.body.name, "name");
        const role = requireString(req.body.role, "role");
        const scenario = requireString(req.body.scenario, "scenario");
        const traitsInput = req.body.traits;

        if (typeof traitsInput !== "object" || traitsInput === null || Array.isArray(traitsInput)) {
          throw new HttpError(400, '"traits" must be an object keyed by category');
        }
        const traitEntries = Object.entries(traitsInput);
        if (traitEntries.length === 0) {
          throw new HttpError(400, '"traits" must contain at least one category');
        }

        // Slugify the name into a readable _id, and de-duplicate if taken.
        const base =
          (typeof req.body._id === "string" && req.body._id.trim()) ||
          name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        let counterpartId = base;
        for (let n = 2; await db.collection("counterparts").findOne({ _id: counterpartId }); n++) {
          counterpartId = `${base}_${n}`;
        }

        const now = new Date();

        const counterpartDoc = {
          _id: counterpartId,
          name,
          role,
          userRole: typeof req.body.userRole === "string" ? req.body.userRole : null,
          scenario,
          wants: typeof req.body.wants === "string" ? req.body.wants : "",
          concessions: Array.isArray(req.body.concessions) ? req.body.concessions : [],
          boundaries: Array.isArray(req.body.boundaries) ? req.body.boundaries : [],
          escalation: typeof req.body.escalation === "string" ? req.body.escalation : "",
          speechRules: {
            maximumWords: Number(req.body.speechRules?.maximumWords) || 35,
            fragmentsWhenTense: Boolean(req.body.speechRules?.fragmentsWhenTense),
            usesFiller: Boolean(req.body.speechRules?.usesFiller),
          },
          fictional: true,
          createdAt: now,
          updatedAt: now,
        };

        const traitDocs = traitEntries.map(([category, value]) => {
          const claim = requireString(
            typeof value === "string" ? value : value?.claim,
            `traits.${category}`
          );
          const confidence = Number(
            typeof value === "object" && value ? value.confidence : undefined
          );
          return {
            _id: `trait_${counterpartId}_${category}_v1`,
            counterpartId,
            category: requireString(category, "trait category"),
            claim,
            confidence: Number.isFinite(confidence) ? confidence : 0.7,
            status: "active",
            version: 1,
            evidenceIds: [],
            createdAt: now,
            updatedAt: now,
          };
        });

        const session = client.startSession();
        try {
          await session.withTransaction(async () => {
            await db.collection("counterparts").insertOne(counterpartDoc, { session });
            await db.collection("traits").insertMany(traitDocs, { session });
          });
        } finally {
          await session.endSession();
        }

        res.status(201).json({
          counterpart: counterpartDoc,
          traits: traitDocs,
        });
      })
    );

    app.get(
      "/api/counterparts/:id/context",
      asyncHandler(async (req, res) => {
        const counterpartId = req.params.id;

        const counterpart = await db
          .collection("counterparts")
          .findOne({ _id: counterpartId });

        if (!counterpart) {
          throw new HttpError(404, "Counterpart not found");
        }

        const activeTraits = await db
          .collection("traits")
          .find({
            counterpartId,
            status: "active",
          })
          .sort({ category: 1 })
          .toArray();

        const evidenceIds = activeTraits.flatMap(
          (trait) => trait.evidenceIds || []
        );

        const evidence = await db
          .collection("evidence")
          .find({
            _id: { $in: evidenceIds },
          })
          .toArray();

        res.json({
          counterpart,
          activeTraits,
          evidence,
        });
      })
    );

    app.post(
      "/api/sessions",
      asyncHandler(async (req, res) => {
        const counterpartId = requireString(req.body.counterpartId, "counterpartId");

        const counterpart = await db
          .collection("counterparts")
          .findOne({ _id: counterpartId });

        if (!counterpart) {
          throw new HttpError(404, "Counterpart not found");
        }

        const now = new Date();
        const session = {
          _id: generateId("session"),
          counterpartId,
          status: "active",
          turns: [],
          startedAt: now,
          updatedAt: now,
        };

        await db.collection("sessions").insertOne(session);

        res.status(201).json(session);
      })
    );

    app.post(
      "/api/sessions/:sessionId/turns",
      asyncHandler(async (req, res) => {
        const { sessionId } = req.params;
        const speaker = requireOneOf(req.body.speaker, "speaker", ["user", "counterpart"]);
        const text = requireString(req.body.text, "text");
        const delivery = req.body.delivery === undefined ? null : req.body.delivery;

        const session = await db.collection("sessions").findOne({ _id: sessionId });
        if (!session) {
          throw new HttpError(404, "Session not found");
        }
        if (session.status !== "active") {
          throw new HttpError(400, "Session is not active");
        }

        const now = new Date();
        const turn = {
          _id: generateId("turn"),
          speaker,
          text,
          delivery,
          timestamp: now,
        };

        const result = await db.collection("sessions").findOneAndUpdate(
          { _id: sessionId },
          { $push: { turns: turn }, $set: { updatedAt: now } },
          { returnDocument: "after" }
        );

        res.status(201).json({
          turn,
          session: result,
        });
      })
    );

    app.post(
      "/api/counterparts/:id/corrections",
      asyncHandler(async (req, res) => {
        const counterpartId = req.params.id;
        const category = requireString(req.body.category, "category");
        const correction = requireString(req.body.correction, "correction");

        const counterpart = await db
          .collection("counterparts")
          .findOne({ _id: counterpartId });
        if (!counterpart) {
          throw new HttpError(404, "Counterpart not found");
        }

        const previousTrait = await db.collection("traits").findOne({
          counterpartId,
          category,
          status: "active",
        });
        if (!previousTrait) {
          throw new HttpError(
            404,
            `No active trait found for counterpart "${counterpartId}" and category "${category}"`
          );
        }

        const now = new Date();
        const evidenceId = generateId("evidence");
        const newTraitId = generateId("trait");

        const session = client.startSession();
        let supersededTrait;
        let activeTrait;

        try {
          await session.withTransaction(async () => {
            const evidenceDoc = {
              _id: evidenceId,
              counterpartId,
              type: "user_correction",
              content: correction,
              source: "Director Interrupt",
              reliability: 0.95,
              referencesTraitId: previousTrait._id,
              createdAt: now,
            };
            await db.collection("evidence").insertOne(evidenceDoc, { session });

            await db.collection("traits").updateOne(
              { _id: previousTrait._id },
              {
                $set: {
                  status: "superseded",
                  supersededBy: newTraitId,
                  updatedAt: now,
                },
              },
              { session }
            );

            const newTraitDoc = {
              _id: newTraitId,
              counterpartId,
              category,
              claim: correction,
              confidence: 0.95,
              status: "active",
              version: (previousTrait.version || 1) + 1,
              evidenceIds: [evidenceId],
              supersedes: previousTrait._id,
              createdAt: now,
              updatedAt: now,
            };
            await db.collection("traits").insertOne(newTraitDoc, { session });

            supersededTrait = {
              ...previousTrait,
              status: "superseded",
              supersededBy: newTraitId,
              updatedAt: now,
            };
            activeTrait = newTraitDoc;
          });
        } finally {
          await session.endSession();
        }

        res.json({
          supersededTrait,
          activeTrait,
        });
      })
    );

    app.post(
      "/api/sessions/:sessionId/debrief",
      asyncHandler(async (req, res) => {
        const { sessionId } = req.params;
        const observationsInput = Array.isArray(req.body)
          ? req.body
          : req.body.observations;
        const observations = requireArray(observationsInput, "observations");

        const session = await db.collection("sessions").findOne({ _id: sessionId });
        if (!session) {
          throw new HttpError(404, "Session not found");
        }

        const validatedObservations = observations.map((observation, index) => {
          if (typeof observation !== "object" || observation === null) {
            throw new HttpError(400, `observations[${index}] must be an object`);
          }
          const timestamp = observation.timestamp;
          if (!timestamp) {
            throw new HttpError(400, `observations[${index}].timestamp is required`);
          }
          const title = requireString(observation.title, `observations[${index}].title`);
          const explanation = requireString(
            observation.explanation,
            `observations[${index}].explanation`
          );
          const turnIds = requireArray(observation.turnIds, `observations[${index}].turnIds`);

          return {
            timestamp: new Date(timestamp),
            title,
            explanation,
            turnIds,
            traitId: observation.traitId || null,
          };
        });

        const now = new Date();
        const debrief = {
          _id: generateId("debrief"),
          sessionId,
          counterpartId: session.counterpartId,
          observations: validatedObservations,
          createdAt: now,
        };

        await db.collection("debriefs").insertOne(debrief);

        await db.collection("sessions").updateOne(
          { _id: sessionId },
          { $set: { status: "completed", completedAt: now, updatedAt: now } }
        );

        res.status(201).json(debrief);
      })
    );

    app.use((req, res) => {
      res.status(404).json({ error: "Not found" });
    });

    app.use((err, req, res, next) => {
      if (err.type === "entity.parse.failed") {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
      const status = err.status || 500;
      if (status >= 500) {
        console.error("Unhandled error:", err);
      }
      res.status(status).json({ error: err.message || "Internal server error" });
    });

    app.listen(port, () => {
      console.log(`Backend running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
}

startServer();

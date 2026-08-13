const { MongoClient } = require("mongodb");
require("dotenv").config();

const client = new MongoClient(process.env.MONGODB_URI);
const databaseName = "counterpart";

async function seedDatabase() {
  try {
    await client.connect();

    const db = client.db(databaseName);
    const counterparts = db.collection("counterparts");
    const traits = db.collection("traits");
    const evidence = db.collection("evidence");

    const now = new Date();

    // Remove only Dana's previous seed data so this script is safe to rerun.
    await counterparts.deleteMany({ _id: "dana_reyes" });
    await traits.deleteMany({ counterpartId: "dana_reyes" });
    await evidence.deleteMany({ counterpartId: "dana_reyes" });

    await counterparts.insertOne({
      _id: "dana_reyes",
      name: "Dana Reyes",
      role: "VP Engineering at Northwind",
      scenario:
        "Sam is a vendor asking Dana to renew a contract that she believes is overpriced.",
      wants: "A 30% price reduction or she walks away.",
      concessions: ["A 12-month term instead of a 24-month term"],
      boundaries: ["Never agrees to anything above $80,000"],
      escalation:
        "If pushed too far, she becomes silent and says she needs to take it to Priya.",
      speechRules: {
        maximumWords: 30,
        fragmentsWhenTense: true,
        usesFiller: false,
      },
      fictional: true,
      createdAt: now,
      updatedAt: now,
    });

    const evidenceDocuments = [
      {
        _id: "evidence_dana_001",
        counterpartId: "dana_reyes",
        type: "user_observation",
        content:
          "Dana becomes quiet and clipped when annoyed. She never raises her voice.",
        source: "Initial scenario description",
        reliability: 0.9,
        createdAt: now,
      },
      {
        _id: "evidence_dana_002",
        counterpartId: "dana_reyes",
        type: "past_interaction",
        content:
          "Dana repeatedly referenced the March outage during the previous renewal discussion.",
        source: "Previous meeting recollection",
        reliability: 0.82,
        createdAt: now,
      },
      {
        _id: "evidence_dana_003",
        counterpartId: "dana_reyes",
        type: "user_observation",
        content:
          "Dana responds better to specific numbers and honest acknowledgment of past failures.",
        source: "Initial scenario description",
        reliability: 0.85,
        createdAt: now,
      },
    ];

    await evidence.insertMany(evidenceDocuments);

    const traitDocuments = [
      {
        _id: "trait_dana_conflict_v1",
        counterpartId: "dana_reyes",
        category: "conflict_response",
        claim: "Becomes quiet and clipped when annoyed",
        confidence: 0.9,
        status: "active",
        version: 1,
        evidenceIds: ["evidence_dana_001"],
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: "trait_dana_questioning_v1",
        counterpartId: "dana_reyes",
        category: "conversation_style",
        claim: "Often answers questions with another question",
        confidence: 0.78,
        status: "active",
        version: 1,
        evidenceIds: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: "trait_dana_leverage_v1",
        counterpartId: "dana_reyes",
        category: "negotiation_tactic",
        claim: "Uses the March outage as leverage during pricing discussions",
        confidence: 0.82,
        status: "active",
        version: 1,
        evidenceIds: ["evidence_dana_002"],
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: "trait_dana_hardens_v1",
        counterpartId: "dana_reyes",
        category: "hardening_trigger",
        claim: "Hardens when someone tells her what her engineering team needs",
        confidence: 0.76,
        status: "active",
        version: 1,
        evidenceIds: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: "trait_dana_softens_v1",
        counterpartId: "dana_reyes",
        category: "softening_trigger",
        claim:
          "Softens when given specific numbers or when someone admits a past failure",
        confidence: 0.85,
        status: "active",
        version: 1,
        evidenceIds: ["evidence_dana_003"],
        createdAt: now,
        updatedAt: now,
      },
    ];

    await traits.insertMany(traitDocuments);

    await traits.createIndex({
      counterpartId: 1,
      status: 1,
      category: 1,
    });

    await evidence.createIndex({
      counterpartId: 1,
      createdAt: -1,
    });

    console.log("Counterpart database seeded successfully");
    console.log("Created Dana, 5 traits, and 3 evidence records");
  } catch (error) {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

seedDatabase();
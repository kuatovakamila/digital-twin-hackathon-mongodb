const { MongoClient } = require("mongodb");
require("dotenv").config();

const client = new MongoClient(process.env.MONGODB_URI);
const databaseName = "counterpart";

/**
 * Every counterpart is the same shape: a scenario, a stance, and a set of
 * traits grouped by category. Traits are what the Director Interrupt
 * supersedes at runtime, so each person needs at least one trait per category
 * the app expects to correct.
 */
const PEOPLE = [
  {
    _id: "dana_reyes",
    name: "Dana Reyes",
    role: "VP Engineering at Northwind",
    userRole: "Sam, a vendor",
    scenario:
      "Sam is a vendor asking Dana to renew a contract that she believes is overpriced.",
    wants: "A 30% price reduction or she walks away.",
    concessions: ["A 12-month term instead of a 24-month term"],
    boundaries: ["Never agrees to anything above $80,000"],
    escalation:
      "If pushed too far, she becomes silent and says she needs to take it to Priya.",
    speechRules: { maximumWords: 30, fragmentsWhenTense: true, usesFiller: false },
    traits: {
      conflict_response: ["Becomes quiet and clipped when annoyed", 0.9],
      conversation_style: ["Often answers questions with another question", 0.78],
      negotiation_tactic: [
        "Uses the March outage as leverage during pricing discussions",
        0.82,
      ],
      hardening_trigger: [
        "Hardens when someone tells her what her engineering team needs",
        0.76,
      ],
      softening_trigger: [
        "Softens when given specific numbers or when someone admits a past failure",
        0.85,
      ],
    },
    evidence: [
      ["user_observation", "Dana becomes quiet and clipped when annoyed. She never raises her voice.", "Initial scenario description", 0.9, "conflict_response"],
      ["past_interaction", "Dana repeatedly referenced the March outage during the previous renewal discussion.", "Previous meeting recollection", 0.82, "negotiation_tactic"],
      ["user_observation", "Dana responds better to specific numbers and honest acknowledgment of past failures.", "Initial scenario description", 0.85, "softening_trigger"],
    ],
  },
  {
    _id: "marcus_hale",
    name: "Marcus Hale",
    role: "Landlord of your building",
    userRole: "his tenant of four years",
    scenario:
      "Marcus is raising the rent 22% at renewal. His tenant wants the increase reduced and the boiler finally fixed.",
    wants: "The full 22% increase, signed this week.",
    concessions: ["Fixing the boiler if the tenant signs at 15%"],
    boundaries: ["Never goes below a 10% increase", "Never puts a repair promise in writing on the spot"],
    escalation:
      "If pushed, he says he has three other people ready to view the flat.",
    speechRules: { maximumWords: 35, fragmentsWhenTense: false, usesFiller: true },
    traits: {
      conflict_response: ["Gets louder and talks over people when challenged", 0.88],
      conversation_style: [
        "Deflects to market rates and what other landlords charge",
        0.84,
      ],
      negotiation_tactic: [
        "Mentions other interested viewers to create time pressure",
        0.86,
      ],
      hardening_trigger: [
        "Hardens when the tenant threatens to involve the council or a lawyer",
        0.8,
      ],
      softening_trigger: [
        "Softens when reminded the tenant has always paid on time and never complained",
        0.75,
      ],
    },
    evidence: [
      ["user_observation", "Marcus raises his voice when challenged and talks over you rather than answering.", "Tenant recollection", 0.88, "conflict_response"],
      ["past_interaction", "He said 'that's just the market' four times during the last renewal call.", "Previous renewal call", 0.84, "conversation_style"],
      ["user_observation", "He went noticeably quieter when reminded of four years of on-time rent.", "Tenant recollection", 0.75, "softening_trigger"],
    ],
  },
  {
    _id: "priya_shah",
    name: "Priya Shah",
    role: "Director of Engineering, your skip-level",
    userRole: "an engineer on her org asking for promotion",
    scenario:
      "Priya is being asked to support a promotion to Staff Engineer in a cycle where she has limited headcount budget.",
    wants: "To defer the decision to the next cycle without saying no outright.",
    concessions: ["Naming one concrete gap and a date to revisit"],
    boundaries: ["Never commits to a promotion outside a formal cycle"],
    escalation:
      "If pushed, she gets warmer and vaguer, and suggests taking it offline.",
    speechRules: { maximumWords: 40, fragmentsWhenTense: false, usesFiller: false },
    traits: {
      conflict_response: [
        "Gets warmer and more agreeable in tone while conceding nothing",
        0.83,
      ],
      conversation_style: [
        "Reframes personal requests as team-wide process questions",
        0.79,
      ],
      negotiation_tactic: [
        "Cites calibration and fairness to peers as the reason she cannot move",
        0.81,
      ],
      hardening_trigger: [
        "Hardens when compared to a specific peer who was promoted",
        0.77,
      ],
      softening_trigger: [
        "Softens when shown written evidence of scope already being carried",
        0.86,
      ],
    },
    evidence: [
      ["user_observation", "Priya never says no directly. She agrees warmly and the answer is still no.", "Skip-level 1:1 notes", 0.83, "conflict_response"],
      ["past_interaction", "She said 'let's take this offline' twice when asked for a timeline.", "Previous 1:1", 0.79, "conversation_style"],
      ["user_observation", "She engaged properly when shown a written list of Staff-level work already shipped.", "Skip-level 1:1 notes", 0.86, "softening_trigger"],
    ],
  },
];

async function seedDatabase() {
  try {
    await client.connect();

    const db = client.db(databaseName);
    const counterparts = db.collection("counterparts");
    const traits = db.collection("traits");
    const evidence = db.collection("evidence");

    const now = new Date();
    const ids = PEOPLE.map((p) => p._id);

    // Reseeding is safe to rerun: clear only the people this script owns.
    await counterparts.deleteMany({ _id: { $in: ids } });
    await traits.deleteMany({ counterpartId: { $in: ids } });
    await evidence.deleteMany({ counterpartId: { $in: ids } });

    for (const person of PEOPLE) {
      const { traits: traitSpec, evidence: evidenceSpec, ...doc } = person;

      await counterparts.insertOne({
        ...doc,
        fictional: true,
        createdAt: now,
        updatedAt: now,
      });

      // Evidence is inserted first so traits can reference it by id.
      const evidenceByCategory = {};
      const evidenceDocs = evidenceSpec.map((entry, index) => {
        const [type, content, source, reliability, category] = entry;
        const _id = `evidence_${person._id}_${index + 1}`;
        evidenceByCategory[category] = _id;
        return {
          _id,
          counterpartId: person._id,
          type,
          content,
          source,
          reliability,
          createdAt: now,
        };
      });
      if (evidenceDocs.length) await evidence.insertMany(evidenceDocs);

      const traitDocs = Object.entries(traitSpec).map(
        ([category, [claim, confidence]]) => ({
          _id: `trait_${person._id}_${category}_v1`,
          counterpartId: person._id,
          category,
          claim,
          confidence,
          status: "active",
          version: 1,
          evidenceIds: evidenceByCategory[category]
            ? [evidenceByCategory[category]]
            : [],
          createdAt: now,
          updatedAt: now,
        }),
      );
      await traits.insertMany(traitDocs);

      console.log(
        `  ${person.name.padEnd(14)} ${traitDocs.length} traits, ${evidenceDocs.length} evidence`,
      );
    }

    await traits.createIndex({ counterpartId: 1, status: 1, category: 1 });
    await evidence.createIndex({ counterpartId: 1, createdAt: -1 });

    console.log(`\nSeeded ${PEOPLE.length} counterparts into "${databaseName}"`);
  } catch (error) {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

seedDatabase();

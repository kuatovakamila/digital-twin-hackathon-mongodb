# Voice Agent

Owns everything between the microphone and the speaker: browser speech
recognition, the ElevenLabs proxy, the delivery-tag → voice-settings mapping,
and the Director Interrupt.

Code lives in `frontend/` so it ships with the app. Files are namespaced under
`lib/voice/` and `components/rehearsal/` so they don't collide with whoever
owns the rest of the frontend.

| Path | What it is |
| --- | --- |
| `frontend/lib/voice/types.ts` | The `/api/chat` contract, shared with Member 2 |
| `frontend/lib/voice/delivery.ts` | Parses `[pace\|energy\|manner]` → ElevenLabs voice settings |
| `frontend/lib/voice/elevenlabs.ts` | Server-side Turbo v2.5 client |
| `frontend/lib/voice/useSpeechRecognition.ts` | `webkitSpeechRecognition` wrapper |
| `frontend/lib/voice/useVoicePlayback.ts` | Streams mp3 into a MediaSource, cuts off on demand |
| `frontend/lib/voice/useRehearsalSession.ts` | The mic → chat → voice loop and its state machine |
| `frontend/app/api/tts/route.ts` | ElevenLabs proxy (keeps the API key server-side) |
| `frontend/app/api/chat/route.ts` | **Stub — Member 2 replaces this** |
| `frontend/components/rehearsal/` | Stage, transcript, mic orb |

## Running it

```bash
cd frontend
cp .env.local.example .env.local     # add ELEVENLABS_API_KEY
npm install
npm run dev                          # http://localhost:3000
```

**Chrome or Edge only** — `webkitSpeechRecognition` doesn't exist in Safari or
Firefox, and the app says so rather than failing silently. **Wear headphones**:
the mic pauses during playback, but speaker bleed still confuses recognition on
the resume.

Without `ANTHROPIC_API_KEY` the chat stub returns canned Dana Reyes lines, so
the full voice loop demos offline. Without `ELEVENLABS_API_KEY` the TTS route
returns a 500 naming the missing variable.

### Voice choice and the free tier

Rachel (`21m00Tcm4TlvDq8ikWAM`) is a **library** voice — the free tier returns
`402 paid_plan_required` for it. We ship Sarah (`EXAVITQu4vr4xnSDxMaL`)
instead, which is free-tier accessible and better suited to Dana anyway: a
composed executive who goes quiet when annoyed, not loud. Also confirmed
working free: Laura `FGY2WhTYpPnrIDTdsKH5`, Matilda `XrExE9yKIg1WjnnlVkGX`.

The API key needs exactly one scope — **Text to Speech**. Everything else can
be `No access`. Set a credit cap while you're in there.

Free-tier keys rate-limit hard enough to throw 429s during a long rehearsal.
The route passes 429 through by name rather than failing vaguely, so if that
shows up mid-recording, that's what it is.

## The loop

```
     ┌──────────────────────────────────────────────┐
     ▼                                              │
  listening ──final transcript──▶ thinking ──▶ speaking
     ▲                                              │
     │                        hold D                │
     └──────── directing ◀────────────────────────  ┘
```

`listening` and `directing` both open the mic; the difference is where the
words go. A line goes to `/api/chat` as `kind: "line"` and continues the scene.
A note goes as `kind: "note"` and changes who the persona *is*.

### Director Interrupt

Hold `D` (or the on-screen button). Three things happen in order:

1. Audio stops mid-word — you correct her while she's still saying it wrong.
2. The mic reopens in note mode.
3. On release, the note posts as `kind: "note"`, gets stored as a behaviour
   correction, and the persona re-delivers the same beat with it applied. The
   retake is tagged `retake` in the transcript.

It's push-to-talk rather than a toggle deliberately — there's no way to leave
the mic in the wrong mode on camera.

### Delivery tags

Every persona line starts with `[pace|energy|manner]`. `delivery.ts` strips the
tag before synthesis (otherwise Rachel reads it aloud) and maps it onto voice
settings:

| Tag part | Effect |
| --- | --- |
| `pace` | `speed` 0.85 / 1.0 / 1.1 |
| `energy` | `stability` + `style` — `flat` is high-stability monotone, `sharp` is low-stability |
| `manner` | nudges the above; `clipped` tightens, `dismissive` adds style |

`stability` is inverted from intuition: **high means monotone**. Dana goes
quieter and flatter when annoyed, so `sharp` *lowers* stability rather than
raising volume. Final values are clamped to stability ≤ 0.9 and style ≤ 0.6 —
past those the voice goes robotic and starts slurring.

Unknown or missing tags fall back to `normal|flat|measured` rather than erroring.

## Backend integration (done)

`frontend/app/api/chat/route.ts` orchestrates one turn:

```
browser ──▶ /api/chat ──▶ MongoDB   (who Dana is, and what she has said)
                     └──▶ Claude    (what she says next)
```

**The persona prompt is assembled from Mongo, not hardcoded.** `buildSystem()`
reads the counterpart doc and its active traits and reconstructs the character
sheet — `conflict_response` / `conversation_style` / `negotiation_tactic`
become `BEHAVIOR`, `hardening_trigger` and `softening_trigger` become
`REACTIONS`. Supersede a trait and she behaves differently on the next turn.
That round trip is the product.

A director note can't go straight to `POST /api/counterparts/:id/corrections`
— that endpoint supersedes a trait *within a category*, and a spoken note
("she'd get quieter, not louder") names no category. So `classifyNote()` runs
a structured-output call constrained to an `enum` of the categories the
counterpart actually has, and rewrites the note as a trait claim. It cannot
invent a category the backend would reject.

Turn logging is fire-and-forget — it must never delay the line the user is
waiting to hear. The delivery tag is stored on the counterpart turn, which is
what the backend's `delivery` field was already there for.

**If Mongo is unreachable the scene still runs** off the static persona in
`lib/personas/dana-reyes.ts`, and the response carries `degraded` so the UI
says so rather than failing silently.

### Multiple people, and adding your own

Counterparts come from MongoDB, not from code. `GET /api/counterparts` feeds
the picker; three are seeded (Dana, a landlord, a skip-level director).

`POST /api/counterparts` on the Next side takes a **free-text description** —
"my letting agent, friendly on the phone but never puts anything in writing" —
resolves it into the structured body via a schema-constrained Claude call, and
`POST`s that to the Express `/api/counterparts` endpoint, which writes the
counterpart and one trait per category in a transaction. New people appear in
the picker immediately and are correctable exactly like the seeded ones.

Every persona needs **one trait per correctable category**, otherwise a note
about (say) what softens them has no trait to supersede. The creation schema
requires all five.

### One note can revise several traits

A note like *"he'd go cold, not stay chatty"* contradicts both
`conflict_response` and `conversation_style`. Revising only one leaves the
stale trait to outvote the new one, and the persona visibly doesn't change —
this was a real bug. `classifyNote()` now returns up to three revisions and
each is superseded in turn. Bounds are enforced in code because the API
rejects `minItems`/`maxItems` in structured-output schemas.

### Running both halves

```bash
cd backend  && npm install && npm run seed && npm start   # :3001
cd frontend && npm install && npm run dev                 # :3000
```

`npm run seed` is safe to rerun — it clears Dana's documents first, so it
resets traits to v1 for a clean demo.

## Original contract (superseded by the section above)

The types are in `frontend/lib/voice/types.ts` — import them, don't retype them.

**Request**

```ts
{
  sessionId: string;
  personaId: string;          // "dana-reyes"
  kind: "line" | "note";      // in-scene dialogue, or a director correction
  text: string;
  history: Turn[];            // role: "user" | "persona" | "director"
}
```

**Response**

```ts
{
  reply: string;              // MUST start with [pace|energy|manner]
  correction?: { id: string; summary: string };
  memoryWrite?: { collection: string; documentId: string };
}
```

Three things the voice layer needs from you:

1. **`reply` must carry the delivery tag.** Without it every line comes out
   flat. The persona prompt in `frontend/lib/personas/dana-reyes.ts` already
   instructs this; keep that prompt or keep the `DELIVERY` block from it.
2. **`kind: "note"` should store the correction and return a retake** — the
   persona's previous line, re-delivered with the correction applied. The stub
   shows the shape: corrections go into the system prompt below the character
   sheet so later notes override earlier instincts.
3. **Return `memoryWrite`** with the collection and document id you just wrote.
   The UI renders it, which is what makes the Atlas Data Explorer shot land in
   the video.

Anything else about the route is yours. Overwrite
`frontend/app/api/chat/route.ts` wholesale — nothing imports from it.

## 60-second submission video

I can write the script and shot list; recording and editing is yours.

**Before recording:** headphones on, Chrome, Atlas Data Explorer open in a
second window filtered to the corrections collection, and one rehearsal done
off-camera so the timing is known.

| Time | Screen | Audio |
| --- | --- | --- |
| 0:00–0:07 | Stage, "Dana Reyes, VP Engineering" | VO: "You can't practise a hard conversation by typing it." |
| 0:07–0:20 | Click Start, speak the opener | You: "I can do eighty-five thousand." Dana (voice): "[normal\|flat\|clipped] You're opening with the number? Bold." |
| 0:20–0:30 | Second exchange, delivery tag visible on each line | Dana pushes back; the tag under her name changes with her mood |
| 0:30–0:42 | **Hold D mid-line** — audio cuts off | You: "No — she'd get quieter when she's annoyed, not sharper." |
| 0:42–0:50 | Cut to Atlas: the correction document appears | VO: "The correction is stored against the persona." |
| 0:50–0:58 | Back to stage: same beat, `retake` badge, slower and flatter | Dana re-delivers, visibly quieter |
| 0:58–1:00 | Title card | VO: "It gets more like them every session." |

The whole pitch is the 0:30–0:58 stretch: interrupt, correct, watch the memory
write, hear the difference. Everything before it is setup and everything after
is a bow.

**Practical notes.** Record system audio, not the room — a mic capture of
laptop speakers sounds terrible and you're wearing headphones anyway. Keep the
Atlas window pre-scrolled to where the new document lands so the cut doesn't
need a hunt. If a take stalls on the network, the canned-line fallback still
gives you a usable voice loop.

## Known limits

- Chrome/Edge only, by way of the Web Speech API.
- Barge-in is push-to-talk, not open-mic — the mic pauses during playback to
  avoid transcribing Rachel's own voice back as user speech.
- The stub's corrections live in a `Map` and die with the server. That's
  Member 2's half.
- One persona is wired up. `frontend/lib/personas/` takes more without any
  change to the voice layer.

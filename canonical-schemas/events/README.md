# Domain Events

Domain events are one-way notifications between EthicApp services. They let a
service that takes over a student operation from the legacy `ethicapp` monolith
trigger side effects that still live in `ethicapp` (for example teacher Socket.IO
notifications) without calling it directly.

## Transport

- Redis pub/sub on the application Redis (today `REDIS_SESSION_*`; renamed to
  `REDIS_APP_*` by #660). Never on the cache Redis (`REDIS_CACHE_*`).
- One channel per event type: `ethicapp:events:<type>`.
- Messages are JSON envelopes validated against
  [`domain-event-envelope-v1.schema.json`](domain-event-envelope-v1.schema.json).

| Field | Meaning |
| --- | --- |
| `type` | Kebab-case event name; selects the channel. |
| `version` | Payload contract version, starting at `1`. |
| `id` | UUID for deduplication and log correlation. |
| `occurredAt` | ISO 8601 time set by the publisher. |
| `source` | Publishing service, for example `ethicapp-student`. |
| `payload` | Event-specific object defined by the event schema. |

## Delivery semantics

- At most once. An event published while no subscriber is connected is lost,
  and Redis does not store it.
- Consumers deduplicate by `id` and must be idempotent.
- Publishers never fail the originating request because of a publish error;
  they log it and continue. They connect at service startup, and a publish
  issued before the first connection completes waits for it for a bounded time
  (1 s by default); afterwards a disconnected publisher fails immediately.
  Each publish also waits at most 500 ms for Redis to accept it, so a server
  that stops responding on an open connection cannot stall the request.
- The student publisher caps its Redis connection at 100 pending commands and
  resets it when a publish times out, releasing queued and in-flight work.
  Commands fail immediately while the replacement connection is not ready.
  A timeout, or an in-flight publish rejected by the connection reset, means
  delivery is unknown: Redis may still apply commands already transmitted
  before the reset and deliver those events late. The publisher does not retry
  them automatically. Publishes attempted while disconnected fail before
  transmission and are logged as failures.
- Consumers ignore and log invalid envelopes, unknown types and unknown versions.

This fits notifications whose state can be recovered from the database, such as
live teacher-view updates that are also loaded when the view opens. An event
that must not be lost needs a durable mechanism (for example Redis Streams with
consumer groups) and its own design review.

## Events

| Event | Version | Publisher | Consumer | Effect |
| --- | --- | --- | --- | --- |
| [`session-participant-joined`](session-participant-joined-v1.schema.json) | 1 | `ethicapp-student` | `ethicapp` | Emits `onStudentJoined` to the teacher namespace for the session. |

## Adding or changing an event

1. Add `<type>-v<version>.schema.json` here, composing the envelope with `allOf`.
2. Keep payloads free of personal data: send ids and let consumers load what they need.
3. Add the payload validator to the publisher
   (`ethicapp-student/backend/services/domain-events/domain-event-envelope.js`)
   and a handler to the consumer
   (`ethicapp/backend/services/domain-events/handlers/`), registered in
   `ethicapp/backend/services/domain-events/index.js`.
4. A breaking payload change is a new version. Deploy the consumer handler for
   the new version before the publisher starts sending it, and keep the old
   handler until no publisher sends the old version.
5. Add the event to the table above.

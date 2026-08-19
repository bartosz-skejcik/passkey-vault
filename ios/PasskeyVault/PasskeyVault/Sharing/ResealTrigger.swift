//
//  ResealTrigger.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-10, Task 2.
//  The cadence half of DR-40-B's resealer -- mirrors
//  `web/src/lib/families/resealTrigger.ts` (`git show
//  main:web/src/lib/families/resealTrigger.ts`, header comment included,
//  read this session): runs opportunistically off the existing unlock/sync
//  cycle, is NEVER awaited by anything on the critical path, and tolerates
//  its own failure completely.
//
//  THE TRIGGER SET DELIBERATELY INCLUDES THE SHARER, same as the reference:
//  there is no `recipientUserId != me`-style guard anywhere in this file. A
//  `ResealableGrantRow` names a pair the CALLER already holds a key for and
//  a named member does not -- the server's own `family_wide_pending` query
//  (`families.rs:369-438`) already excludes the caller from ever appearing
//  as a `recipient_user_id` of their own pair, so no such guard is needed
//  here either.
//
//  This file owns exactly TWO things: the per-session attempted-pair set,
//  and the fan-out over a `resealable` snapshot. Fetching that snapshot
//  (`GET /api/families/family-wide-pending`) is deliberately NOT this
//  file's job -- `SharedItemsStore.fetchFamilyWidePending` already owns
//  that call (plan 40-05), and the production wiring (`SyncCoordinator`)
//  passes its `resealable` array straight through, so there is exactly ONE
//  fetch per pull cycle shared by both `PendingKeyState`'s `missing` axis
//  and this trigger's `resealable` fan-out -- mirroring `resealTrigger.ts`'s
//  own "one query, two consumers" header note.
//
//  `actor`, not a plain class: the reference's own load-bearing property is
//  "claim every fresh pair SYNCHRONOUSLY, before the first `await`, so a
//  concurrent invocation within the same tick sees them already claimed".
//  Swift's actor reentrancy model makes this a STRUCTURAL guarantee rather
//  than a discipline someone could get wrong: code between suspension
//  points inside an actor-isolated method runs atomically with respect to
//  every other call into that SAME actor, so the claim loop below (which
//  contains no `await`) can never interleave with another call's claim
//  loop, however the two calls happen to be scheduled. This IS the whole
//  concurrency control (matching the reference's own header: "deliberately
//  invents no coordination scheme of its own") -- no lock, lease, or queue
//  is added anywhere in this file.
//

import Foundation

/// The cadence/fan-out engine over `ResealableGrantRow` (`PendingKeyState.swift`'s
/// own type, decoded from `family_wide_pending`'s `resealable` array).
actor ResealTrigger {
    private var attemptedPairs: Set<String> = []
    private let resealService: ResealService

    init(resealService: ResealService) {
        self.resealService = resealService
    }

    private static func attemptKey(collectionId: String, recipientUserId: String) -> String {
        "\(collectionId):\(recipientUserId)"
    }

    /// Clears the attempted-pair set. Call on EVERY lock AND EVERY unlock
    /// transition (the production wiring's own job, `SyncCoordinator`) --
    /// mirrors `resetFamilyWideResealAttempts()`'s own doc comment: a pair
    /// that failed transiently must be retried on the next unlock's fresh
    /// snapshot, never stranded for the lifetime of this object.
    func resetAttempts() {
        attemptedPairs.removeAll()
    }

    /// One pair's identity, echoed back in `RunOutcome` so a caller (a test,
    /// or a future logging hook) can tell which pair succeeded/failed
    /// without re-deriving the key string this file uses internally.
    struct Attempt: Equatable {
        let collectionId: String
        let recipientUserId: String
    }

    /// One pair whose reseal attempt threw. `error` is NOT `Equatable` --
    /// kept as the real thrown error, never stringified here, so a caller
    /// that cares about the underlying cause (a test asserting on error
    /// type, a log line) can inspect it directly.
    struct FailedAttempt {
        let attempt: Attempt
        let error: Error
    }

    /// The result of one `run` call. NEVER thrown -- `run` has no `throws`
    /// in its own signature, structurally enforcing the reference's "never
    /// rejects" contract: a caller cannot even write a `try` around this
    /// call, let alone have to handle a reseal-specific error type on the
    /// unlock/sync path.
    struct RunOutcome {
        /// The count of FRESH pairs this call actually attempted -- i.e.
        /// `succeeded.count + failed.count`. Zero for an empty `resealable`
        /// list AND for a `resealable` list whose every pair was already
        /// claimed by an earlier call in this session -- the two cases this
        /// file's own header (Pitfall 6, `40-RESEARCH.md`) warns must be
        /// distinguishable from "the trigger ran and delivered nothing":
        /// pairing this field's own zero against a DIFFERENT call's
        /// non-zero value (as `ResealTriggerTests` does) is what makes that
        /// distinction real, since a hard-coded `return` early would make
        /// this field a constant zero forever, not a value that moves.
        let attempted: Int
        let succeeded: [Attempt]
        let failed: [FailedAttempt]
    }

    /// Fans out over `resealable`, claiming each fresh pair SYNCHRONOUSLY
    /// (this file's own header) and then settling each claimed pair
    /// INDEPENDENTLY -- a failure at one pair never prevents any other
    /// pair's attempt, and never causes this function itself to throw. The
    /// server's own `INSERT ... ON CONFLICT DO NOTHING` on `collection_keys`'
    /// composite PK (via `ResealService.reshareCollection`'s own conflict
    /// handling) makes each grant idempotent -- that idempotency IS the
    /// contention story a partial/interrupted run relies on; nothing here
    /// invents a second one.
    @discardableResult
    func run(resealable: [ResealableGrantRow], userKey: FfiUserKey) async -> RunOutcome {
        guard !resealable.isEmpty else {
            // The overwhelmingly common case (no family, or nothing
            // pending): zero extra work, not even a claim-loop iteration.
            return RunOutcome(attempted: 0, succeeded: [], failed: [])
        }

        // Claim every fresh pair SYNCHRONOUSLY, before the first `await`
        // below -- this file's own header explains why this ordering alone
        // is the entire concurrency control.
        var fresh: [ResealableGrantRow] = []
        for grant in resealable {
            let key = Self.attemptKey(collectionId: grant.collection_id, recipientUserId: grant.recipient_user_id)
            guard !attemptedPairs.contains(key) else { continue }
            attemptedPairs.insert(key)
            fresh.append(grant)
        }
        guard !fresh.isEmpty else {
            return RunOutcome(attempted: 0, succeeded: [], failed: [])
        }

        var succeeded: [Attempt] = []
        var failed: [FailedAttempt] = []
        for grant in fresh {
            // CR-03: a lock landing mid-fan-out (the caller cancels the
            // task that owns this call) stops the REMAINING pairs instead
            // of draining the whole list -- pairs already claimed in
            // `attemptedPairs` above stay claimed, so they are retried
            // cleanly on the next unlock's `resetAttempts()` + fresh
            // snapshot rather than either double-attempted or silently
            // dropped forever.
            guard !Task.isCancelled else { break }
            let attempt = Attempt(collectionId: grant.collection_id, recipientUserId: grant.recipient_user_id)
            do {
                try await resealService.reshareCollection(
                    collectionId: grant.collection_id, recipientUserId: grant.recipient_user_id, userKey: userKey
                )
                succeeded.append(attempt)
            } catch {
                // Opportunistic by construction: a failed pair is recorded
                // here and left for the next unlock's fresh snapshot (once
                // `resetAttempts()` runs), never surfaced to the user and
                // never allowed to abort the rest of this fan-out.
                failed.append(FailedAttempt(attempt: attempt, error: error))
            }
        }
        return RunOutcome(attempted: fresh.count, succeeded: succeeded, failed: failed)
    }
}

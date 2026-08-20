//
//  MatchingProbe.swift
//  PasskeyVault
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-05, Task 1 (E41-3).
//
//  Registers THREE distinct `ASCredentialServiceIdentifier`-typed identities for the SAME real
//  vault item -- one `.domain`, two `.URL` (differing only by port), each distinguished by its own
//  `user` string (this phase's established discriminator convention) -- directly via
//  `ASCredentialIdentityStore.shared.saveCredentialIdentities`, deliberately BYPASSING
//  `IdentityStoreSync` (production's ONE choke point, `.domain`-only as of Plan 41-04). This
//  experiment's whole point is to observe `.URL`-typed matching, which production does not
//  register at all yet -- writing through the choke point would either be a no-op (it only builds
//  `.domain` identities) or would require teaching it three registration shapes it has no
//  production reason to know, for a one-off diagnostic. This is a probe, not a second production
//  writer, and it never runs outside `PV_PROBE_E41_3` builds.
//
//  PORT NOTE (recorded here AND in `ios/evidence/41/e41-3-matching-matrix.md`'s own "what this
//  does NOT settle" section -- never softened in only one place): this harness has no
//  non-interactive root on the host Mac (`sudo -n true` was checked live this session and requires
//  a password), so binding TCP 80/443 -- the literal IANA default ports for http/https -- is not
//  possible without an interactive prompt, which this project's own "no interactive prompts in
//  automation" rule forbids for a routine, repeatable experiment (distinct from the one-time,
//  interactive `xcodes select` precedent). Every location in this experiment therefore uses an
//  explicit, non-privileged port; "the port identity B declares" stands in for "the default-port
//  location" the plan's own text names.
//
//  `*.localhost` hostnames resolve to the loopback address on macOS with NO `/etc/hosts` edit and
//  NO root (RFC 6761 -- confirmed live this session via `ping pv-e413.localhost` and
//  `ping sub.pv-e413.localhost`, both resolving to 127.0.0.1 with no prior configuration) -- used
//  for the base host, its subdomain, and the unregistered control, so no DNS setup is needed
//  either.
//
//  Compiled in only under `PV_PROBE_E41_3` -- inert for every other build.
//

import AuthenticationServices
import Foundation
import os

// WR-10 (41-REVIEW.md): the call site was correctly gated; this file's own BODY was not. See
// `SessionKeyProbeSeeder.swift`'s own note for the identical reasoning. `register()`/
// `registerUrlOnly()` here call `removeAllCredentialIdentities()` directly (bypassing
// `IdentityStoreSync` deliberately, this file's own header) -- a large blast radius to leave a
// single stray call site away in a Release build.
#if DEBUG || PV_PROBE_E41_3
enum MatchingProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    static let itemId = "e41-3-probe-item"

    /// Each string exists NOWHERE else on the simulator (Pitfall 6, `41-RESEARCH.md`) -- the
    /// discriminator that makes a QuickType suggestion attributable to a SPECIFIC one of the three
    /// registrations, not merely to "our provider in general".
    static let usernameDomain = "e413-a-domain-9f2c@pv.test"
    static let usernameUrlB = "e413-b-url-9f2c@pv.test"
    static let usernameUrlC = "e413-c-url-9f2c@pv.test"

    static let baseHost = "e413.localhost"
    static let portB = 8091
    static let portC = 8092

    /// The unregistered-location control's own host and the throwaway falsification identity's
    /// user string (this task's own acceptance criteria: prove the control row is a real
    /// observation, not an artifact of nothing being registered anywhere).
    static let unregisteredHost = "e413-unreg.localhost"
    static let controlProbeUsername = "e413-control-probe-9f2c@pv.test"

    private static let groupIdentifier = "group.cloud.blonie.PasskeyVault"
    private static let markerRegister = "e41-3-register.marker"
    private static let markerControlRegister = "e41-3-control-register.marker"
    private static let markerControlRemove = "e41-3-control-remove.marker"
    private static let markerUrlOnly = "e41-3-url-only.marker"
    private static let markerCleanControlRegister = "e41-3-clean-control-register.marker"
    private static let markerCleanControlRemove = "e41-3-clean-control-remove.marker"

    private static func containerURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupIdentifier)
    }

    private static func markerExists(_ name: String) -> Bool {
        guard let url = containerURL()?.appendingPathComponent(name) else { return false }
        return FileManager.default.fileExists(atPath: url.path)
    }

    /// Checked on every launch under `PV_PROBE_E41_3` -- a no-op (cheap file-exists checks) unless
    /// the driving script placed exactly one marker BEFORE this launch (same discipline
    /// `IdentityStoreSyncProbe.runIfMarked()` already established, this phase).
    static func runIfMarked() async {
        if markerExists(markerRegister) {
            await register()
        }
        if markerExists(markerControlRegister) {
            await registerControlProbe(host: unregisteredHost, user: controlProbeUsername)
        }
        if markerExists(markerControlRemove) {
            await removeControlProbe(host: unregisteredHost, user: controlProbeUsername)
        }
        if markerExists(markerUrlOnly) {
            await registerUrlOnly()
        }
        if markerExists(markerCleanControlRegister) {
            await registerControlProbe(host: unregisteredHost, user: controlProbeUsername)
        }
        if markerExists(markerCleanControlRemove) {
            await removeControlProbe(host: unregisteredHost, user: controlProbeUsername)
        }
    }

    /// Falsification leg added live, this session: the full three-identity table showed identity
    /// A (`.domain`) offered on EVERY visited location including the unregistered control, with
    /// ZERO extension `os_log` events for the whole drive (checked live via `simctl spawn log
    /// show`) -- i.e. the "Sign in to ..." sheet is populated by the SYSTEM directly from
    /// `ASCredentialIdentityStore`'s own registered metadata, never by invoking our extension code,
    /// and possibly not filtering by host at all when a `.domain` identity exists. This leg clears
    /// the store and registers ONLY the two `.URL`-typed identities (B, C) -- removing A entirely
    /// -- to observe, independently: (1) whether a `.URL`-typed identity is EVER offered through
    /// this sheet mechanism at all, and (2) whether the "something is always offered regardless of
    /// host" behaviour persists without A present, or was specific to A.
    static func registerUrlOnly() async {
        try? await ASCredentialIdentityStore.shared.removeAllCredentialIdentities()
        let identityB = ASPasswordCredentialIdentity(
            serviceIdentifier: ASCredentialServiceIdentifier(
                identifier: "http://\(baseHost):\(portB)/", type: .URL
            ),
            user: usernameUrlB, recordIdentifier: itemId
        )
        let identityC = ASPasswordCredentialIdentity(
            serviceIdentifier: ASCredentialServiceIdentifier(
                identifier: "http://\(baseHost):\(portC)/", type: .URL
            ),
            user: usernameUrlC, recordIdentifier: itemId
        )
        let identities: [any ASCredentialIdentity] = [identityB, identityC]
        do {
            try await ASCredentialIdentityStore.shared.saveCredentialIdentities(identities)
            logger.log("PVFILL|E41-3|stage=register-url-only status=ok count=2")
        } catch {
            logger.log("PVFILL|E41-3|stage=register-url-only status=fail error=\(String(describing: error), privacy: .public)")
        }
    }

    /// Registers the three identities. Idempotent -- clears the store first, so re-running (e.g.
    /// after the control-probe falsification leg below) returns to the clean three-identity
    /// baseline.
    static func register() async {
        // Clears any identity left over from a PRIOR session/build (durable across reinstalls,
        // L-34's own finding) -- so whatever QuickType/the fill entry point observes afterward is
        // unambiguously attributable to THIS run's three identities, never a stale entry from an
        // earlier evidence session (Pitfall 6).
        try? await ASCredentialIdentityStore.shared.removeAllCredentialIdentities()

        let identityA = ASPasswordCredentialIdentity(
            serviceIdentifier: ASCredentialServiceIdentifier(identifier: baseHost, type: .domain),
            user: usernameDomain, recordIdentifier: itemId
        )
        let identityB = ASPasswordCredentialIdentity(
            serviceIdentifier: ASCredentialServiceIdentifier(
                identifier: "http://\(baseHost):\(portB)/", type: .URL
            ),
            user: usernameUrlB, recordIdentifier: itemId
        )
        let identityC = ASPasswordCredentialIdentity(
            serviceIdentifier: ASCredentialServiceIdentifier(
                identifier: "http://\(baseHost):\(portC)/", type: .URL
            ),
            user: usernameUrlC, recordIdentifier: itemId
        )
        identityA.rank = 0
        identityB.rank = 1
        identityC.rank = 2

        let identities: [any ASCredentialIdentity] = [identityA, identityB, identityC]
        do {
            // The CURRENT, `[any ASCredentialIdentity]`-typed overload -- L-33
            // (`ios/IOS-SPIKE-LOG.md`).
            try await ASCredentialIdentityStore.shared.saveCredentialIdentities(identities)
            logger.log("PVFILL|E41-3|stage=register status=ok count=3")
        } catch {
            logger.log("PVFILL|E41-3|stage=register status=fail error=\(String(describing: error), privacy: .public)")
        }
    }

    /// Removes only identity A (the unregistered-location falsification leg, this task's own
    /// acceptance criteria: "register an identity for that location, re-run that single visit,
    /// observe a suggestion appear, then remove the identity and confirm the original row
    /// reproduces"). Re-adds A afterward via a full `register()` call from the driving script's own
    /// next stage -- this function only performs the interim "add a throwaway identity for the
    /// control location, then remove it again" half.
    static func registerControlProbe(host: String, user: String) async {
        let identity = ASPasswordCredentialIdentity(
            serviceIdentifier: ASCredentialServiceIdentifier(identifier: host, type: .domain),
            user: user, recordIdentifier: "e41-3-control-probe-item"
        )
        do {
            try await ASCredentialIdentityStore.shared.saveCredentialIdentities([identity])
            logger.log("PVFILL|E41-3|stage=control-probe-register status=ok host=\(host, privacy: .public)")
        } catch {
            logger.log("PVFILL|E41-3|stage=control-probe-register status=fail error=\(String(describing: error), privacy: .public)")
        }
    }

    static func removeControlProbe(host: String, user: String) async {
        let identity = ASPasswordCredentialIdentity(
            serviceIdentifier: ASCredentialServiceIdentifier(identifier: host, type: .domain),
            user: user, recordIdentifier: "e41-3-control-probe-item"
        )
        do {
            try await ASCredentialIdentityStore.shared.removeCredentialIdentities([identity])
            logger.log("PVFILL|E41-3|stage=control-probe-remove status=ok host=\(host, privacy: .public)")
        } catch {
            logger.log("PVFILL|E41-3|stage=control-probe-remove status=fail error=\(String(describing: error), privacy: .public)")
        }
    }
}
#endif

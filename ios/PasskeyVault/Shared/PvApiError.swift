//
//  PvApiError.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-02 originally defined this enum inline in
//  `Core/PvApiClient.swift`. Moved here by Plan 43-06, Task 1 -- a load-bearing deviation from
//  that plan's own authored shape (43-06-PLAN.md's `<read_first>` explicitly anticipated this
//  case: "confirm [VaultAPI.swift] has ZERO host-app-only dependencies... if it does, extract the
//  minimal `createItem`-reachable surface... and note the deviation"). `VaultAPI.swift`'s own
//  `send`/`requireStatus` plumbing -- which `createItem` calls directly -- throws this type on
//  every non-2xx path; it cannot compile into the `PasskeyVaultAutoFill` target without this type
//  also being visible there. `PvApiError` itself has zero host-app-only dependencies (pure
//  `Foundation`), so moving its DECLARATION here (never redefining it, never duplicating it) keeps
//  "one definition, reused" intact while unblocking the move -- `PvApiClient.swift` and every other
//  host-only consumer (`AccountService`, `FamilyAPI`, `ShareItemPresenter`, etc.) keep referencing
//  it unqualified, same module, no changes needed on their end.
//

import Foundation

/// Typed, non-leaking error surface shared by `PvApiClient` (host-only, `/api/auth/*`) and
/// `VaultAPI` (Shared, `/api/vault/*` + `/api/sync`). `.invalidCredentials` carries no hint about
/// which of email/password was wrong (T-37-08) -- it is the single case a 401 from ANY `pv-server`
/// route maps to.
enum PvApiError: Error, CustomStringConvertible {
    /// A 401 from any route. Deliberately hint-free.
    case invalidCredentials
    /// Any other non-2xx/non-401 response, carrying the HTTP status and the
    /// server's own `{"error": "<message>"}` body (or a fallback string when
    /// the body did not parse as that shape). `AccountService.register`
    /// inspects `status == 409` here to detect the ACC-01 concurrency edge.
    case httpError(status: Int, message: String)
    /// The response body did not decode into the shape this client expects
    /// -- a genuine wire-contract mismatch, never silently swallowed.
    case unexpectedResponse(String)
    /// `URLSession` itself failed (no network, DNS, TLS, etc.) before an
    /// HTTP response was ever received.
    case network(Error)

    var description: String {
        switch self {
        case .invalidCredentials:
            return "Invalid email or password."
        case let .httpError(status, message):
            return "Server error (\(status)): \(message)"
        case let .unexpectedResponse(message):
            return "Unexpected server response: \(message)"
        case let .network(error):
            return "Network error: \(error.localizedDescription)"
        }
    }
}

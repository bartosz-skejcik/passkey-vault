//
//  AutoFillStatus.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-13, Task 3.
//
//  Wraps `ASCredentialIdentityStore.shared.getState(_:)` behind a small
//  async call, so `OnboardingAutoFillStep` has exactly one thing to await
//  -- and a future test has exactly one thing to substitute, if this ever
//  grows a protocol seam. `state.isEnabled` reflects the OS-level "AutoFill
//  from: PasskeyVault" toggle in Settings -> Passwords -> AutoFill
//  regardless of the `ProvidesPasswords` capability key
//  (`ios/IOS-SPIKE-LOG.md` L-7, Plan 36-02 update: that key changes the
//  row's accessibility label and category, not whether the provider is
//  listed or toggleable) -- this is a genuinely different signal from L-7's
//  finding, read directly from the credential-identity-store API rather
//  than inferred from Settings UI presence.
//

import AuthenticationServices

enum AutoFillStatus {
    static func isEnabled() async -> Bool {
        await withCheckedContinuation { continuation in
            ASCredentialIdentityStore.shared.getState { state in
                continuation.resume(returning: state.isEnabled)
            }
        }
    }
}

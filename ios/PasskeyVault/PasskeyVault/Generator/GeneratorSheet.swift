//
//  GeneratorSheet.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-08. The generator surface --
//  and the ONLY Swift file that may call `generateCharacterPassword`/
//  `generatePassphrase`/`generatorBounds` (E-G1 check 2 greps for exactly
//  that). Every byte of randomness comes from `pv-ffi` -> `pv-core`'s
//  OS-CSPRNG-backed rejection sampling; no platform random-number API of
//  any kind appears anywhere in this file, or in this application's
//  source at all -- the full, named list of forbidden APIs lives in
//  exactly one place, `scripts/audit-generator-uses-ffi.sh`'s check 1
//  pattern, deliberately not restated here: restating those names in a
//  comment would make THIS file itself a hit against that very check.
//
//  Three modes, per `docs/superpowers/specs/2026-08-16-ios-vault-ui-design.md`
//  §6 (the 38-DESIGN-CONFORMANCE.md amendment to this plan -- the ORIGINAL
//  plan text spoke of two):
//    - Random    -- `generateCharacterPassword`, all four class toggles.
//    - Memorable -- `generatePassphrase`, EFF wordlist, hyphen-joined.
//    - PIN       -- `generateCharacterPassword` restricted to digits-only,
//                    reusing the SAME character-length bounds as Random.
//                    `generatorBounds()` has no PIN-specific range, and
//                    inventing a Swift-only literal bound for PIN here
//                    would recreate exactly the second-source-of-truth
//                    problem this plan exists to prevent (T-38-08-03) --
//                    so PIN mode is "Random, digits only," not a
//                    differently-bounded control.
//
//  EVERY slider range and default is read from `generatorBounds()` -- the
//  record `crates/pv-ffi::generator` exposes -- never written as a Swift
//  numeric literal next to a range operator. The sheet renders NOTHING
//  bounds-shaped until that record has loaded (`if let bounds`), rather
//  than falling back to a placeholder literal range, which would itself
//  be exactly the drift this file exists to avoid.
//
//  Reachable with the vault LOCKED (DR-38-A): the three FFI calls above
//  take no `FfiUserKey`/key-handle argument at all, and this file never
//  imports or references `VaultStore` -- the generator must remain usable
//  from the lock screen today and, in a later phase, from the AutoFill
//  extension process, which has no key at all.
//
//  Safe fallback class set (T-38-08 "backstop" truth): unticking every
//  character class in Random mode does NOT surface `pv-core`'s empty-set
//  rejection to the user. The fallback (lowercase-only, matching
//  `GeneratorDialog.tsx`'s `SAFE_DEFAULT_CHARSET` and
//  `generate-handler.ts`'s own fallback) is substituted BEFORE the call --
//  the Rust function's own validation is never bypassed, it is simply
//  never handed an empty set to validate.
//
//  Characters are colour-coded by class (design-conformance §38-08: "a
//  real requirement, not decoration -- it is what makes a generated
//  password typeable on another device"), using existing tokens only --
//  no new colorset, no literal colour (`scripts/audit-ios-colour-tokens.sh`
//  check 1).
//

import SwiftUI

struct GeneratorSheet: View {

    enum Mode: String, CaseIterable, Identifiable {
        case random = "Random"
        case memorable = "Memorable"
        case pin = "PIN"
        var id: String { rawValue }
    }

    /// Optional -- when the sheet is presented next to a password field
    /// (a future plan's item-create/edit form), the caller supplies this
    /// to receive the generated value and dismiss. `nil` when the sheet
    /// is presented standalone (e.g. this plan's own locked-state
    /// reachability screenshot).
    var onInsert: ((String) -> Void)?

    @Environment(\.dismiss) private var dismiss

    @State private var mode: Mode = .random
    @State private var bounds: FfiGeneratorBounds?
    @State private var boundsError: String?

    @State private var charLength: Double = 0
    @State private var wordCount: Double = 0
    @State private var pinLength: Double = 0
    @State private var separator: String = ""

    // Matches `packages/pv-ui/generator/password.ts`'s own documented
    // default charset (RESEARCH.md: "Default charset {lower:T, upper:T,
    // digits:T, symbols:F}").
    @State private var lowercase = true
    @State private var uppercase = true
    @State private var digits = true
    @State private var symbols = false

    @State private var preview = ""
    @State private var generationError: String?
    @State private var confirmation: ClipboardConfirmation?

    var body: some View {
        NavigationStack {
            Group {
                if let bounds {
                    loadedBody(bounds)
                } else if let boundsError {
                    errorBody(boundsError)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Generate password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .onAppear(perform: loadBoundsIfNeeded)
    }

    // MARK: - Loaded body

    @ViewBuilder
    private func loadedBody(_ bounds: FfiGeneratorBounds) -> some View {
        Form {
            Section {
                Picker("Mode", selection: $mode) {
                    ForEach(Mode.allCases) { m in
                        Text(m.rawValue).tag(m)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("generator-mode-picker")
            }
            .listRowBackground(Color.clear)
            .onChange(of: mode) { _, _ in regenerate() }

            Section {
                previewRow
                strengthMeterRow
            }

            switch mode {
            case .random:
                randomControls(bounds)
            case .memorable:
                memorableControls(bounds)
            case .pin:
                pinControls(bounds)
            }

            Section {
                Button {
                    regenerate()
                } label: {
                    Label("Regenerate", systemImage: "arrow.clockwise")
                }
                .accessibilityIdentifier("generator-regenerate")

                Button("Copy") { copyPreview() }
                    .disabled(preview.isEmpty)
                    .accessibilityIdentifier("generator-copy")

                if let onInsert {
                    Button("Use this password") {
                        onInsert(preview)
                        dismiss()
                    }
                    .disabled(preview.isEmpty)
                    .accessibilityIdentifier("generator-use")
                }
            }

            if let confirmation {
                Section {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let remaining = ClipboardService.remainingSeconds(
                            deadline: confirmation.deadline, now: context.date
                        )
                        Text(
                            ClipboardWording.confirmation(
                                fieldLabel: confirmation.fieldLabel, remainingSeconds: remaining
                            )
                        )
                        .font(.footnote)
                        .foregroundStyle(Color("PVTextMuted"))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func errorBody(_ message: String) -> some View {
        VStack(spacing: 12) {
            Text("Could not load generator settings")
                .font(.headline)
                .foregroundStyle(Color("PVTextPrimary"))
            Text(message)
                .font(.footnote)
                .foregroundStyle(Color("PVError"))
        }
        .padding()
    }

    // MARK: - Preview + strength

    private var previewRow: some View {
        HStack {
            if preview.isEmpty {
                Text(generationError ?? "—")
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(Color("PVTextMuted"))
                    .accessibilityIdentifier("generator-preview")
            } else {
                colouredPreviewText
                    .font(.system(.body, design: .monospaced))
                    .accessibilityIdentifier("generator-preview")
            }
            Spacer()
        }
    }

    /// Colour-codes each character by class -- lowercase/uppercase/digit/
    /// everything-else (symbols, and a passphrase's separator) -- so a
    /// generated value is easier to transcribe onto another device by eye.
    /// Existing tokens only, no new colorset, no literal colour.
    private var colouredPreviewText: Text {
        preview.reduce(Text("")) { partial, ch in
            partial + Text(String(ch)).foregroundColor(colour(for: ch))
        }
    }

    private func colour(for ch: Character) -> Color {
        if ch.isASCII, ch.isNumber { return Color("PVLink") }
        if ch.isASCII, ch.isUppercase { return Color("PVAccent") }
        if ch.isASCII, ch.isLowercase { return Color("PVTextPrimary") }
        return Color("PVWarning")
    }

    private var strengthMeterRow: some View {
        let result = PasswordStrength.scoreMeter(preview)
        return VStack(alignment: .leading, spacing: 4) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color("PVSurfaceAlt"))
                    Capsule()
                        .fill(meterColour(result.color))
                        .frame(width: geo.size.width * CGFloat(result.percent) / 100)
                }
            }
            .frame(height: 6)
            Text("\(result.percent)%")
                .font(.caption)
                .foregroundStyle(Color("PVTextMuted"))
                .accessibilityIdentifier("generator-strength-percent")
        }
    }

    private func meterColour(_ colour: PasswordStrength.MeterColor) -> Color {
        switch colour {
        case .success: return Color("PVSuccess")
        case .warning: return Color("PVWarning")
        case .error: return Color("PVError")
        }
    }

    // MARK: - Mode-specific controls

    @ViewBuilder
    private func randomControls(_ bounds: FfiGeneratorBounds) -> some View {
        Section("Length: \(Int(charLength))") {
            Slider(
                value: $charLength,
                in: Double(bounds.charMinLength)...Double(bounds.charMaxLength),
                step: 1
            )
            .accessibilityIdentifier("generator-length-slider")
        }
        .onChange(of: charLength) { _, _ in regenerate() }

        Section("Character classes") {
            Toggle("a-z", isOn: $lowercase)
                .accessibilityIdentifier("generator-toggle-lowercase")
            Toggle("A-Z", isOn: $uppercase)
                .accessibilityIdentifier("generator-toggle-uppercase")
            Toggle("0-9", isOn: $digits)
                .accessibilityIdentifier("generator-toggle-digits")
            Toggle("!@#$", isOn: $symbols)
                .accessibilityIdentifier("generator-toggle-symbols")
        }
        .onChange(of: lowercase) { _, _ in regenerate() }
        .onChange(of: uppercase) { _, _ in regenerate() }
        .onChange(of: digits) { _, _ in regenerate() }
        .onChange(of: symbols) { _, _ in regenerate() }
    }

    @ViewBuilder
    private func memorableControls(_ bounds: FfiGeneratorBounds) -> some View {
        Section("Words: \(Int(wordCount))") {
            Slider(
                value: $wordCount,
                in: Double(bounds.passphraseMinWords)...Double(bounds.passphraseMaxWords),
                step: 1
            )
            .accessibilityIdentifier("generator-words-slider")
        }
        .onChange(of: wordCount) { _, _ in regenerate() }

        Section("Separator") {
            TextField("Separator", text: $separator)
                .accessibilityIdentifier("generator-separator-field")
        }
        .onChange(of: separator) { _, _ in regenerate() }
    }

    @ViewBuilder
    private func pinControls(_ bounds: FfiGeneratorBounds) -> some View {
        // PIN reuses the CHARACTER-length bounds (see this file's header):
        // there is no PIN-specific record on the Rust side.
        Section("Digits: \(Int(pinLength))") {
            Slider(
                value: $pinLength,
                in: Double(bounds.charMinLength)...Double(bounds.charMaxLength),
                step: 1
            )
            .accessibilityIdentifier("generator-pin-slider")
        }
        .onChange(of: pinLength) { _, _ in regenerate() }
    }

    // MARK: - Loading bounds (never a literal fallback range)

    private func loadBoundsIfNeeded() {
        guard bounds == nil, boundsError == nil else { return }
        do {
            let loaded = try generatorBounds()
            bounds = loaded
            charLength = Double(loaded.charDefaultLength)
            wordCount = Double(loaded.passphraseDefaultWords)
            pinLength = Double(loaded.charDefaultLength)
            separator = loaded.defaultSeparator
            regenerate()
        } catch {
            boundsError = String(describing: error)
        }
    }

    // MARK: - Generation (the only place in this file that calls into pv-ffi)

    private func regenerate() {
        guard bounds != nil else { return }
        do {
            switch mode {
            case .random:
                preview = try generateCharacterPassword(
                    length: UInt32(charLength), options: safeCharacterOptions()
                )
            case .memorable:
                preview = try generatePassphrase(wordCount: UInt32(wordCount), separator: separator)
            case .pin:
                preview = try generateCharacterPassword(
                    length: UInt32(pinLength),
                    options: FfiCharacterPasswordOptions(
                        lowercase: false, uppercase: false, digits: true, symbols: false
                    )
                )
            }
            generationError = nil
        } catch {
            preview = ""
            generationError = String(describing: error)
        }
    }

    /// The safe fallback (T-38-08 backstop truth): if every class toggle is
    /// off, substitute lowercase-only BEFORE calling `pv-ffi` -- never call
    /// with an empty set and catch/hide the resulting error. Matches
    /// `GeneratorDialog.tsx`'s `SAFE_DEFAULT_CHARSET` exactly.
    private func safeCharacterOptions() -> FfiCharacterPasswordOptions {
        if lowercase || uppercase || digits || symbols {
            return FfiCharacterPasswordOptions(
                lowercase: lowercase, uppercase: uppercase, digits: digits, symbols: symbols
            )
        }
        return FfiCharacterPasswordOptions(lowercase: true, uppercase: false, digits: false, symbols: false)
    }

    // MARK: - Copy

    private func copyPreview() {
        guard !preview.isEmpty else { return }
        let deadline = ClipboardService.shared.copy(preview, fieldLabel: "Generated password")
        confirmation = ClipboardConfirmation(fieldLabel: "Generated password", deadline: deadline)
    }
}

#Preview {
    GeneratorSheet()
}

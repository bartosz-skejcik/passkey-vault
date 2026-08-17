//
//  ItemIconTile.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-06, Task 2. Mirrors
//  `packages/pv-ui/components/ItemIconTile.tsx` -- inherited rules, not
//  invented ones (design-conformance §3). Added as a Rule 2 deviation (not
//  in this plan's original `files_modified`, which predates the approved
//  design conformance doc).
//
//  - Logins AND passkeys -> favicon from the item's OWN domain, loaded
//    lazily and ephemerally by `FaviconLoader`.
//  - Cards -> brand tile detected locally via `CardBrandDetector`, zero
//    network calls.
//  - Everything else, and any failed favicon -> a monochrome glyph on
//    `PVSurfaceAlt`.
//

import SwiftUI

enum ItemIconTileVariant {
    case row
    case header

    var frameSize: CGFloat {
        switch self {
        case .row: return 32
        case .header: return 24
        }
    }

    var cornerRadius: CGFloat {
        switch self {
        case .row: return 8
        case .header: return 6
        }
    }

    var iconSize: CGFloat {
        switch self {
        case .row: return 18
        case .header: return 14
        }
    }
}

struct ItemIconTile: View {
    let item: VaultItemViewModel
    var variant: ItemIconTileVariant = .row

    @State private var faviconData: Data?
    @State private var faviconLoadAttempted = false

    var body: some View {
        Group {
            if item.isUndecryptable {
                glyph("exclamationmark.triangle.fill", tint: Color("PVError"))
            } else if item.isPendingFamilyKey {
                glyph("hourglass", tint: Color("PVTextMuted"))
            } else if let fields = item.fields, case let .card(card) = fields,
                let brand = CardBrandDetector.detect(card.number)
            {
                cardBrandTile(brand)
            } else if let hostname = faviconHostname, let faviconData,
                let uiImage = UIImage(data: faviconData)
            {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .padding(variant.frameSize * 0.15)
                    .frame(width: variant.frameSize, height: variant.frameSize)
                    .background(Color("PVFaviconTile"))
                    .clipShape(RoundedRectangle(cornerRadius: variant.cornerRadius, style: .continuous))
                    .accessibilityHidden(true)
                    .task(id: hostname) { await loadFaviconIfNeeded(hostname: hostname) }
            } else if let hostname = faviconHostname {
                // Favicon not yet loaded (or already failed) -- neutral
                // glyph while `.task` below resolves it lazily. This branch
                // ALSO covers the permanent failure case: a failed hostname
                // never re-enters the image branch above (`faviconData`
                // stays `nil` forever for it, `FaviconLoader` never retries
                // it either).
                glyph(fallbackSystemImage, tint: Color("PVTextMuted"))
                    .task(id: hostname) { await loadFaviconIfNeeded(hostname: hostname) }
            } else {
                glyph(fallbackSystemImage, tint: Color("PVTextMuted"))
            }
        }
    }

    // MARK: - Favicon eligibility (login/passkey only, own domain only)

    /// `nil` for every type except `login`/`passkey` -- mirrors
    /// `faviconHostnameFor` in the web component exactly, including the
    /// permissive `domainFromUrl` fallback for a bare (schemeless) domain.
    private var faviconHostname: String? {
        guard let fields = item.fields else { return nil }
        switch fields {
        case let .login(login):
            guard let url = login.urls.first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty })
            else { return nil }
            let hostname = VaultSearch.domainFromUrl(url).trimmingCharacters(in: .whitespaces)
            return hostname.isEmpty ? nil : hostname
        case let .passkey(passkey):
            let rpId = passkey.rpId.trimmingCharacters(in: .whitespaces)
            return rpId.isEmpty ? nil : rpId
        default:
            return nil
        }
    }

    private func loadFaviconIfNeeded(hostname: String) async {
        guard faviconData == nil, !faviconLoadAttempted else { return }
        faviconLoadAttempted = true
        faviconData = await FaviconLoader.shared.favicon(forHostname: hostname)
    }

    private var fallbackSystemImage: String {
        guard let fields = item.fields else { return "questionmark.circle" }
        switch fields {
        case .login: return "globe"
        case .card: return "creditcard"
        case .identity: return "person.text.rectangle"
        case .note: return "note.text"
        case .totp: return "timer"
        case .passkey: return "key.fill"
        }
    }

    // MARK: - Rendering helpers

    @ViewBuilder
    private func glyph(_ systemImage: String, tint: Color) -> some View {
        RoundedRectangle(cornerRadius: variant.cornerRadius, style: .continuous)
            .fill(Color("PVSurfaceAlt"))
            .frame(width: variant.frameSize, height: variant.frameSize)
            .overlay {
                Image(systemName: systemImage)
                    .font(.system(size: variant.iconSize))
                    .foregroundStyle(tint)
            }
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private func cardBrandTile(_ brand: CardBrand) -> some View {
        RoundedRectangle(cornerRadius: variant.cornerRadius, style: .continuous)
            .fill(cardBrandColor(brand))
            .frame(width: variant.frameSize, height: variant.frameSize)
            .overlay {
                Text(verbatim: cardBrandLabel(brand))
                    .font(.system(size: variant.frameSize * 0.24, weight: .heavy))
                    .foregroundStyle(Color("PVCardBrandLabel"))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .padding(.horizontal, 2)
            }
            .accessibilityHidden(true)
    }

    /// Every card-brand fill is an asset-catalog token, never a literal --
    /// `scripts/audit-ios-colour-tokens.sh` check 1 forbids a literal RGB initializer
    /// unconditionally, including for third-party brand marks.
    private func cardBrandColor(_ brand: CardBrand) -> Color {
        switch brand {
        case .visa: return Color("PVCardBrandVisa")
        case .mastercard: return Color("PVCardBrandMastercard")
        case .amex: return Color("PVCardBrandAmex")
        case .discover: return Color("PVCardBrandDiscover")
        }
    }

    private func cardBrandLabel(_ brand: CardBrand) -> String {
        switch brand {
        case .visa: return "VISA"
        case .mastercard: return "MC"
        case .amex: return "AMEX"
        case .discover: return "DISC"
        }
    }
}

//
//  TotpScanView.swift
//  PasskeyVault
//
//  Quick task 260818-lsk. The ＋ panel's "Scan QR code" slot -- the PRIMARY
//  path for adding a TOTP code now (manual entry, `ItemFormView`'s existing
//  "New code" form, remains the fallback: not every platform hands out a QR
//  code, some only show the raw secret, so this view routes there rather
//  than replacing it). Owns the whole scan-then-prefill flow: camera
//  capture, the permission dance, and the no-camera/permission-denied
//  fallback -- `ItemListView.sheetContent` only wires this view's two
//  callbacks onward.
//
//  SIMULATOR HAS NO CAMERA, which makes the fallback state -- not the
//  camera state -- the one this app's own CI/dev harness actually exercises.
//  `cameraAvailable` is checked and branched on FIRST, ahead of authorization
//  status, specifically so that fact is true: a simulator run never reaches
//  `AVCaptureDevice.requestAccess(for:)` at all, so it can never raise the OS
//  permission dialog this project's own standing rule forbids in automation.
//
//  Parsing is entirely `OtpauthParser.swift`'s job (Foundation-only, no
//  camera/UIKit knowledge) -- this file's job stops at "get a string out of
//  a QR code" and "hand that string to the parser". See that file's header
//  for why: TOTP code GENERATION stays FFI-only, and keeping the parser
//  dependency-free is what makes it unit-testable without a simulator.
//

import AVFoundation
import SwiftUI
import UIKit

struct TotpScanView: View {
    /// Called once, with the parsed fields, on a successful scan.
    /// `ItemListView.sheetContent` routes this into `.creatingFromScan`.
    var onScanned: (ParsedOtpauth) -> Void
    /// The fallback out of THIS view into the unprefilled manual form --
    /// reachable from the no-camera/denied state, and from the live camera
    /// state too (a user may simply prefer typing).
    var onManualEntry: () -> Void

    @Environment(\.dismiss) private var dismiss

    /// Read once, at view construction, not race-checked again mid-scan.
    /// `AVCaptureDevice.default(for: .video)` returns `nil` on every
    /// simulator (no camera hardware exists to enumerate) and non-`nil` on
    /// a real device with a working camera -- this is the ONE check that
    /// does not depend on the permission dance below at all.
    @State private var cameraAvailable = AVCaptureDevice.default(for: .video) != nil
    @State private var authorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    @State private var scanError: OtpauthParseError?

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Scan QR code")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
        }
        .task {
            // Guarded on `cameraAvailable`: a simulator run must never call
            // `requestAccess`, which is the call that can raise a system
            // dialog -- see this file's header.
            guard cameraAvailable, authorizationStatus == .notDetermined else { return }
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            authorizationStatus = granted ? .authorized : .denied
        }
    }

    @ViewBuilder
    private var content: some View {
        switch resolvedState {
        case .noCamera, .permissionDenied:
            noCameraFallback
        case .awaitingPermission:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color("PVBackground"))
        case .ready:
            cameraCapture
        }
    }

    private enum ResolvedState {
        case noCamera
        case permissionDenied
        case awaitingPermission
        case ready
    }

    private var resolvedState: ResolvedState {
        guard cameraAvailable else { return .noCamera }
        switch authorizationStatus {
        case .authorized: return .ready
        case .denied, .restricted: return .permissionDenied
        case .notDetermined: return .awaitingPermission
        @unknown default: return .permissionDenied
        }
    }

    /// The honest explainer state: no camera at all (every simulator run),
    /// or a real device where the user declined/never granted access.
    /// Distinct copy per cause -- "turn on camera access" is actionable
    /// advice on a device and misleading noise on a simulator, which has no
    /// camera to turn access on for.
    @ViewBuilder
    private var noCameraFallback: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 44))
                .foregroundStyle(Color("PVTextMuted"))
            StatusCallout(text: explainerText, tone: .muted)
            if let scanError {
                StatusCallout(text: scanError.description, tone: .error)
            }
            Button("Enter details manually") {
                onManualEntry()
            }
            .buttonStyle(PVPrimaryButtonStyle())
            .accessibilityIdentifier("totpscan.manualEntry")
            Spacer()
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("PVBackground"))
        // `.accessibilityElement(children: .contain)` BEFORE the identifier
        // below -- without it, SwiftUI was observed (live, in this quick
        // task's own UI test run) bleeding this container's identifier down
        // onto every plain descendant that had no identifier of its OWN
        // more specific reason to keep one, which silently overwrote the
        // "Enter details manually" button's `totpscan.manualEntry`
        // identifier with this container's -- the button existed, but under
        // the WRONG id, so `app.buttons["totpscan.manualEntry"]` found
        // nothing. `.contain` tells SwiftUI this is a real container with
        // independently-identifiable children, which is what stops the
        // bleed.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("totpscan.noCameraFallback")
    }

    private var explainerText: String {
        cameraAvailable
            ? "Camera access is off, so Passkey Vault can't scan a QR code. You can still add this code by entering its details manually."
            : "This device has no camera to scan with. You can still add this code by entering its details manually."
    }

    @ViewBuilder
    private var cameraCapture: some View {
        ZStack(alignment: .bottom) {
            QrCaptureRepresentable(onCode: handle(rawCode:))
                .ignoresSafeArea()
            VStack(spacing: 12) {
                if let scanError {
                    StatusCallout(text: scanError.description, tone: .error)
                        .padding(.horizontal, 24)
                }
                Button("Enter details manually") {
                    onManualEntry()
                }
                .buttonStyle(PVPrimaryButtonStyle())
                .padding(.horizontal, 24)
                .accessibilityIdentifier("totpscan.manualEntry")
            }
            .padding(.bottom, 40)
        }
    }

    private func handle(rawCode: String) {
        do {
            let parsed = try OtpauthParser.parse(rawCode)
            scanError = nil
            onScanned(parsed)
        } catch let error as OtpauthParseError {
            scanError = error
        } catch {
            scanError = .malformed
        }
    }
}

// MARK: - Camera capture (UIKit interop)
//
// SwiftUI has no native camera-capture view; `AVCaptureVideoPreviewLayer`
// is a `CALayer`, and `AVCaptureMetadataOutput`'s delegate callback is a
// UIKit/AVFoundation-era API. `UIViewControllerRepresentable` is the
// standard bridge -- see `TotpScanView`'s own header for why none of this
// lives in `OtpauthParser.swift` instead.

private struct QrCaptureRepresentable: UIViewControllerRepresentable {
    var onCode: (String) -> Void

    func makeUIViewController(context: Context) -> QrCaptureViewController {
        let controller = QrCaptureViewController()
        controller.onCode = onCode
        return controller
    }

    func updateUIViewController(_ uiViewController: QrCaptureViewController, context: Context) {
        uiViewController.onCode = onCode
    }
}

private final class QrCaptureViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?

    private let session = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    /// One delivery per scan sheet. Without this, the metadata delegate
    /// fires repeatedly (many times a second) for the same code while the
    /// camera keeps pointing at it, and `onScanned` would be invoked over
    /// and over during the moment it takes SwiftUI to dismiss this sheet.
    private var hasDelivered = false

    override func viewDidLoad() {
        super.viewDidLoad()
        // A token, not a literal `.black` -- `scripts/audit-ios-colour-tokens.sh`
        // bars literal colours everywhere, UIKit interop included; this is the
        // same `UIColor(named:)` pattern `SnapshotCover.swift` already uses for
        // exactly the same "a UIKit `UIView`'s background still has to be a
        // brand token" need. Force-unwrapped for the same reason that file's
        // own comment gives: a missing asset belongs in a crash, not a silent
        // literal fallback.
        view.backgroundColor = UIColor(named: "PVBackground")!
        configureSession()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !session.isRunning else { return }
        let session = self.session
        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        guard session.isRunning else { return }
        let session = self.session
        DispatchQueue.global(qos: .userInitiated).async {
            session.stopRunning()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    private func configureSession() {
        guard
            let device = AVCaptureDevice.default(for: .video),
            let input = try? AVCaptureDeviceInput(device: device),
            session.canAddInput(input)
        else { return }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        // `.qr` only -- this scanner has one job (see `TotpScanView`'s
        // header); it does not also become a barcode reader by accident.
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)
        previewLayer = preview
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !hasDelivered else { return }
        guard
            let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
            object.type == .qr,
            let value = object.stringValue
        else { return }
        hasDelivered = true
        onCode?(value)
    }
}

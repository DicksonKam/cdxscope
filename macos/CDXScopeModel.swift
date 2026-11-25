import Foundation
import Combine
import AppKit

struct Allowance: Decodable, Identifiable {
    let account: String?
    let bucket: String
    let slot: String
    let used: Double
    let duration: Double?
    let reset: Double?
    let at: Double
    var id: String { "\(bucket)/\(slot)" }
    var remaining: Double { min(100, max(0, 100 - used)) }
    var title: String {
        let name = bucket == "codex" ? "Codex" : bucket
        guard let minutes = duration, minutes > 0 else { return "\(name) · \(slot)" }
        if minutes >= 1440 { return "\(name) · \(Int(minutes / 1440)) days" }
        if minutes >= 60 { return "\(name) · \(Int(minutes / 60)) hours" }
        return "\(name) · \(Int(minutes)) minutes"
    }
}
struct ReadAttempt: Decodable { let at: Double; let ok: Bool }
struct MonitorState: Decodable {
    let enabled: Bool
    let running: Bool
    let authPaused: Bool?
    let offline: Bool?
}
struct Status: Decodable {
    let version: Int
    let csrf: String
    let windows: [Allowance]
    let collector: MonitorState
    let attempts: [ReadAttempt]
    var latestRead: Date? { attempts.first.map { Date(timeIntervalSince1970: $0.at / 1000) } }
    func isFresh(at now: Date = Date()) -> Bool {
        guard let read = latestRead, attempts.first?.ok == true else { return false }
        let age = now.timeIntervalSince(read)
        return age >= -60 && age < 180
    }
}
struct ConnectionSettings: Decodable { let port: Int? }
struct AppConnection: Decodable { let settingsPath: String; let port: Int }
func monitorURL(port: Int) throws -> URL {
    guard (1024...65535).contains(port), let url = URL(string: "http://127.0.0.1:\(port)") else {
        throw MonitorError.configuration
    }
    return url
}
enum MonitorError: Error { case configuration, response, incompatible }

enum MenuBarAlertKind: Equatable {
    case healthy, low, depleted, unavailable
}

struct MenuBarReading: Equatable {
    let title: String
    let remaining: Double?
    let secondaryTitle: String?
    let tag: String?
    let alert: MenuBarAlertKind
    let detail: String
    var accessibilityLabel: String { "CDXScope — \(detail)" }

    private static func formatPercent(_ value: Double) -> String {
        value > 0 && value < 1 ? "<1%" : "\(Int(value.rounded()))%"
    }

    private static func durationTag(for window: Allowance) -> String? {
        guard let minutes = window.duration, minutes > 0 else { return nil }
        if minutes >= 1440 { return "\(Int((minutes / 1440).rounded()))D" }
        if minutes >= 60 { return "\(Int((minutes / 60).rounded()))H" }
        return "\(Int(minutes.rounded()))M"
    }

    init(status: Status?, window: Allowance?, secondary: Allowance? = nil, unavailable: Bool, now: Date) {
        var reason: String?
        if unavailable { reason = "Monitor unavailable" }
        else if status == nil { reason = "Connecting to monitor" }
        else if status?.collector.enabled == false { reason = "Monitoring paused" }
        else if status?.collector.authPaused == true { reason = "Paused · sign in to Codex and refresh" }
        else if status?.collector.offline == true { reason = "Offline · waiting for network" }
        else if window == nil { reason = "No allowance available" }
        else if status?.isFresh(at: now) != true { reason = "Waiting for a fresh reading" }
        else if let window {
            let age = now.timeIntervalSince1970 - window.at / 1000
            if !window.used.isFinite || !age.isFinite || age < -60 || age >= 180 {
                reason = "Waiting for a fresh reading"
            } else if let reset = window.reset, !reset.isFinite || reset <= now.timeIntervalSince1970 {
                reason = "Reset time reached · awaiting a reading"
            }
        }
        if let reason {
            title = "—"
            remaining = nil
            secondaryTitle = nil
            tag = nil
            alert = .unavailable
            detail = reason
        } else if let window {
            // Match the panel's rounding; preserve a small nonzero allowance without displaying 0%.
            let value = window.remaining
            remaining = value
            title = Self.formatPercent(value)
            let validSecondary: Allowance? = {
                guard let secondary, secondary.id != window.id, secondary.used.isFinite else { return nil }
                let age = now.timeIntervalSince1970 - secondary.at / 1000
                guard age.isFinite, age >= -60, age < 180 else { return nil }
                if let reset = secondary.reset, !reset.isFinite || reset <= now.timeIntervalSince1970 { return nil }
                return secondary
            }()
            if let validSecondary {
                let secPct = Self.formatPercent(validSecondary.remaining)
                secondaryTitle = secPct
                tag = (validSecondary.duration ?? 0) >= 1440 ? "WK" : (Self.durationTag(for: validSecondary) ?? "WK")
                detail = "\(window.title): \(title) remaining · \(validSecondary.title): \(secPct) remaining"
            } else {
                secondaryTitle = nil
                tag = Self.durationTag(for: window)
                detail = "\(window.title): \(title) remaining"
            }
            if value <= 0 { alert = .depleted }
            else if value < 15 { alert = .low }
            else { alert = .healthy }
        } else {
            title = "—"
            remaining = nil
            secondaryTitle = nil
            tag = nil
            alert = .unavailable
            detail = "No allowance available"
        }
    }
}

/// Circular Codex emblem rendered in CoreGraphics with a true alpha-transparent `›_` prompt cutout.
enum CodexOrbShape {
    static func draw(in cg: CGContext, rect: CGRect, color: NSColor, alpha: CGFloat) {
        cg.saveGState()
        cg.setAlpha(alpha)
        cg.beginTransparencyLayer(auxiliaryInfo: nil)
        // Map 24x24 top-down coordinates into AppKit's bottom-up rect.
        cg.translateBy(x: rect.minX, y: rect.maxY)
        cg.scaleBy(x: rect.width / 24.0, y: -rect.height / 24.0)

        // Solid circular orb
        cg.setFillColor(color.cgColor)
        cg.addEllipse(in: CGRect(x: 12.0 - 9.2, y: 12.0 - 9.2, width: 18.4, height: 18.4))
        cg.fillPath()

        // Punch a true alpha-transparent `›_` prompt cutout in the center
        cg.setBlendMode(.clear)
        cg.setLineWidth(2.4)
        cg.setLineCap(.round)
        cg.setLineJoin(.round)
        cg.beginPath()
        cg.move(to: CGPoint(x: 7.8, y: 9.0))
        cg.addLine(to: CGPoint(x: 11.1, y: 12.0))
        cg.addLine(to: CGPoint(x: 7.8, y: 15.0))
        cg.move(to: CGPoint(x: 12.6, y: 15.0))
        cg.addLine(to: CGPoint(x: 16.4, y: 15.0))
        cg.strokePath()

        cg.endTransparencyLayer()
        cg.restoreGState()
    }
}

/// Living Codex Orb menu bar meter: circular `›_` badge filled bottom-to-top by remaining % + bold % + compact window tag.
enum MenuBarGauge {
    static let height: CGFloat = 22

    static func width(reading: MenuBarReading) -> CGFloat {
        if reading.secondaryTitle != nil { return 72 }
        if reading.tag != nil { return 63 }
        return 42
    }

    static func image(reading: MenuBarReading, darkBar: Bool = true) -> NSImage {
        let size = NSSize(width: width(reading: reading), height: height)
        let useTemplate = reading.alert == .healthy || reading.alert == .unavailable

        let primaryColor: NSColor
        let secondaryColor: NSColor
        switch reading.alert {
        case .healthy, .unavailable:
            primaryColor = NSColor.black
            secondaryColor = NSColor.black
        case .low:
            primaryColor = darkBar
                ? NSColor(red: 0.98, green: 0.75, blue: 0.14, alpha: 1) // #fbbf24
                : NSColor(red: 0.85, green: 0.47, blue: 0.02, alpha: 1) // #d97706
            secondaryColor = darkBar ? NSColor.white : NSColor.black
        case .depleted:
            primaryColor = darkBar
                ? NSColor(red: 0.97, green: 0.44, blue: 0.44, alpha: 1) // #f87171
                : NSColor(red: 0.86, green: 0.15, blue: 0.15, alpha: 1) // #dc2626
            secondaryColor = primaryColor
        }

        let image = NSImage(size: size, flipped: false) { _ in
            guard let cg = NSGraphicsContext.current?.cgContext else { return false }

            // 1. Living Codex Orb silhouette (25% ghost top + solid liquid fill bottom-to-top)
            let logoRect = CGRect(x: 1.0, y: 2.25, width: 17.5, height: 17.5)
            CodexOrbShape.draw(in: cg, rect: logoRect, color: primaryColor, alpha: 0.25)

            if let rem = reading.remaining, rem.isFinite, rem > 0 {
                let frac = CGFloat(min(100, max(0, rem)) / 100.0)
                // Circle vertically spans y=[2.8..21.2] in the 24x24 box.
                let baseY = logoRect.minY + (2.8 / 24.0) * logoRect.height
                let spanH = (18.4 / 24.0) * logoRect.height
                let fillH = spanH * frac
                cg.saveGState()
                cg.clip(to: CGRect(x: logoRect.minX - 1, y: baseY - 1, width: logoRect.width + 2, height: fillH + 1))
                CodexOrbShape.draw(in: cg, rect: logoRect, color: primaryColor, alpha: 1.0)
                cg.restoreGState()
            }

            // 2. Bold hero remaining percentage (harmonized with AGYScope)
            let digits = reading.title.replacingOccurrences(of: "%", with: "")
            let fontSize: CGFloat = digits.count >= 3 ? 10.2 : 12.2
            let text = NSMutableAttributedString(string: reading.title, attributes: [
                .font: NSFont.monospacedDigitSystemFont(ofSize: fontSize, weight: .bold),
                .foregroundColor: primaryColor,
            ])
            if reading.title.hasSuffix("%") {
                text.addAttribute(.font, value: NSFont.systemFont(ofSize: 7.4, weight: .semibold), range: NSRange(location: (reading.title as NSString).length - 1, length: 1))
            }
            let textOriginX: CGFloat = 20.5
            text.draw(at: NSPoint(x: textOriginX, y: digits.count >= 3 ? 4.4 : 3.4))

            // 3. Right-hand window context: stacked WK/% when dual-window, or compact duration tag (e.g. 7D)
            if let secondaryTitle = reading.secondaryTitle {
                let tagAttr = NSAttributedString(string: reading.tag ?? "WK", attributes: [
                    .font: NSFont.systemFont(ofSize: 5.8, weight: .semibold),
                    .foregroundColor: secondaryColor.withAlphaComponent(0.48),
                ])
                let secDigits = secondaryTitle.replacingOccurrences(of: "%", with: "")
                let secAttr = NSMutableAttributedString(string: secondaryTitle, attributes: [
                    .font: NSFont.monospacedDigitSystemFont(ofSize: secDigits.count >= 3 ? 7.2 : 8.2, weight: .medium),
                    .foregroundColor: secondaryColor.withAlphaComponent(0.72),
                ])
                if secondaryTitle.hasSuffix("%") {
                    secAttr.addAttribute(.font, value: NSFont.systemFont(ofSize: 5.5, weight: .medium), range: NSRange(location: (secondaryTitle as NSString).length - 1, length: 1))
                }
                let centerX: CGFloat = 59.5
                tagAttr.draw(at: NSPoint(x: centerX - tagAttr.size().width / 2, y: 12.2))
                secAttr.draw(at: NSPoint(x: centerX - secAttr.size().width / 2, y: 2.2))
            } else if let tag = reading.tag {
                let tagAttr = NSAttributedString(string: tag, attributes: [
                    .font: NSFont.systemFont(ofSize: 6.5, weight: .bold),
                    .foregroundColor: secondaryColor.withAlphaComponent(0.48),
                ])
                let tagX = max(textOriginX + text.size().width + 3.0, 48.0)
                let tagY = (size.height - tagAttr.size().height) / 2.0 - 0.3
                tagAttr.draw(at: NSPoint(x: min(tagX, size.width - tagAttr.size().width - 1.5), y: tagY))
            }
            return true
        }
        image.isTemplate = useTemplate
        return image
    }
}

// Never follow a localhost redirect with the in-memory request token.
final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
final class MonitorClient {
    let base: URL
    let session: URLSession
    init(base: URL, session: URLSession? = nil) {
        self.base = base
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 20
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = session ?? URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }
    func read(refresh: Bool = false) async throws -> Status {
        // Obtain a current token first: the monitor may have restarted since the panel last opened.
        let current = try await request(path: "/api/status")
        return refresh ? try await request(path: "/api/refresh", token: current.csrf) : current
    }
    func history(days: Int, window: Allowance?) async throws -> HistoryResponse {
        var url = URLComponents(url: base.appendingPathComponent("/api/state"), resolvingAgainstBaseURL: false)!
        let key = try window.map { String(data: try JSONEncoder().encode([$0.bucket, $0.slot]), encoding: .utf8)! } ?? ""
        url.queryItems = [URLQueryItem(name: "view", value: "overview"), URLQueryItem(name: "days", value: String(days == 0 ? 30 : days)), URLQueryItem(name: "historyScope", value: days == 0 ? "current" : "range"), URLQueryItem(name: "window", value: key), URLQueryItem(name: "timezone", value: TimeZone.current.identifier)]
        let result: HistoryResponse = try await decodedRequest(url: url.url!)
        guard result.version == 1, result.history.count <= 600, result.localHistory.count <= 600 else { throw MonitorError.incompatible }
        if days == 0 && result.cycle == nil { throw MonitorError.incompatible }
        if let window {
            guard result.latest?.id == window.id, result.latest?.account == window.account else { throw MonitorError.incompatible }
        }
        return result
    }
    private func request(path: String, token: String? = nil) async throws -> Status {
        let status: Status = try await decodedRequest(url: base.appendingPathComponent(path), token: token)
        guard status.version == 1, !status.csrf.isEmpty, Set(status.windows.map(\.id)).count == status.windows.count else { throw MonitorError.incompatible }
        return status
    }
    private func decodedRequest<T: Decodable>(url: URL, token: String? = nil) async throws -> T {
        var request = URLRequest(url: url)
        if let token {
            request.httpMethod = "POST"
            request.httpBody = Data("{}".utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(base.absoluteString, forHTTPHeaderField: "Origin")
            request.setValue(token, forHTTPHeaderField: "X-CDXScope-Token")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count < 2_000_000 else { throw MonitorError.response }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
final class HistorySelection: ObservableObject {
    @Published var local = false
    @Published var inspected: PlotPoint?
}
@MainActor
final class PanelModel: ObservableObject {
    @Published private(set) var status: Status?
    @Published private(set) var busy = false
    @Published private(set) var unavailable = false
    @Published private(set) var history: HistoryResponse?
    @Published private(set) var historyBusy = false
    @Published private(set) var historyUnavailable = false
    let historySelection = HistorySelection()
    @Published var days = 30
    @Published var selectedWindow = ""
    private var historyKey = ""
    private var historyGeneration = 0
    private var historyReadAt: Date?
    var window: Allowance? { status?.windows.first(where: { $0.id == selectedWindow }) ?? status?.windows.first }
    var companionWindow: Allowance? {
        guard let active = window else { return nil }
        return status?.windows.first(where: { $0.bucket == active.bucket && $0.id != active.id })
    }
    private let client: MonitorClient
    var dashboardURL: URL { client.base }
    init(client: MonitorClient) { self.client = client }
    func menuBarReading(at now: Date = Date()) -> MenuBarReading {
        MenuBarReading(status: status, window: window, secondary: companionWindow, unavailable: unavailable, now: now)
    }
    func poll(historyVisible: Bool) async {
        await update()
        if historyVisible { await updateHistory() }
    }
    func update(refresh: Bool = false) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let next = try await client.read(refresh: refresh)
            if next.windows.first?.account != status?.windows.first?.account {
                history = nil; historyReadAt = nil; historyGeneration += 1; historyBusy = false
            }
            status = next; unavailable = false
        }
        catch { unavailable = true } // Keep the previous reading, explicitly marked stale.
    }
    func updateHistory(force: Bool = false) async {
        let selected = window
        let key = "\(days)/\(selected?.account ?? "")/\(selected?.id ?? "")/\(TimeZone.current.identifier)"
        if !force && key == historyKey && (historyBusy || (historyReadAt.map { Date().timeIntervalSince($0) < 60 } ?? false)) { return }
        if key != historyKey { history = nil }
        historyKey = key; historyGeneration += 1
        let generation = historyGeneration
        historyBusy = true
        do {
            let result = try await client.history(days: days, window: selected)
            guard generation == historyGeneration else { return }
            history = result; historyUnavailable = false; historyReadAt = Date()
        } catch {
            guard generation == historyGeneration else { return }
            historyUnavailable = true
        }
        historyBusy = false
    }
    func headline(at now: Date) -> String {
        if unavailable { return "Monitor unavailable" }
        guard let status else { return "Connecting to monitor…" }
        if !status.collector.enabled { return "Monitoring paused" }
        if status.collector.authPaused == true { return "Paused · check Codex sign-in & refresh" }
        if status.collector.offline == true { return "Offline · waiting for network" }
        return status.isFresh(at: now) ? "Monitoring healthy" : "Waiting for a fresh reading"
    }
}

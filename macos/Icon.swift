import AppKit

// CDXScope app icon: deep forest-emerald tile with the Living Codex Orb (`›_`) emblem.
let folder = CommandLine.arguments[1]

for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let p = CGFloat(pixels)
        let tileColor = NSColor(red: 0.10, green: 0.24, blue: 0.21, alpha: 1)
        let markColor = NSColor(red: 0.66, green: 0.86, blue: 0.75, alpha: 1)

        tileColor.setFill()
        NSBezierPath(roundedRect: NSRect(x: p * 0.05, y: p * 0.05, width: p * 0.9, height: p * 0.9), xRadius: p * 0.2, yRadius: p * 0.2).fill()

        if let cg = NSGraphicsContext.current?.cgContext {
            let inset = p * 0.16
            let box = CGRect(x: inset, y: inset, width: p - inset * 2, height: p - inset * 2)
            cg.saveGState()
            cg.beginTransparencyLayer(auxiliaryInfo: nil)
            cg.translateBy(x: box.minX, y: box.maxY)
            cg.scaleBy(x: box.width / 24.0, y: -box.height / 24.0)

            cg.setFillColor(markColor.cgColor)
            cg.addEllipse(in: CGRect(x: 12.0 - 9.2, y: 12.0 - 9.2, width: 18.4, height: 18.4))
            cg.fillPath()

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

        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: folder).appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}

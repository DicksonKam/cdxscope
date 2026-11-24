import AppKit

// CDXScope app icon: deep forest-emerald tile with the crisp 6-petal blossom mark.
let folder = CommandLine.arguments[1]

func petalPath() -> CGPath {
    let p = CGMutablePath()
    p.move(to: CGPoint(x: 12.0, y: 3.1))
    p.addCurve(to: CGPoint(x: 16.0, y: 7.0), control1: CGPoint(x: 14.3, y: 3.1), control2: CGPoint(x: 16.0, y: 4.8))
    p.addLine(to: CGPoint(x: 16.0, y: 10.6))
    p.addCurve(to: CGPoint(x: 14.5, y: 12.0), control1: CGPoint(x: 16.0, y: 11.4), control2: CGPoint(x: 15.3, y: 12.0))
    p.addLine(to: CGPoint(x: 11.1, y: 12.0))
    p.addCurve(to: CGPoint(x: 9.9, y: 10.7), control1: CGPoint(x: 10.4, y: 12.0), control2: CGPoint(x: 9.9, y: 11.4))
    p.addLine(to: CGPoint(x: 9.9, y: 5.5))
    p.addCurve(to: CGPoint(x: 12.0, y: 3.1), control1: CGPoint(x: 9.9, y: 4.1), control2: CGPoint(x: 10.8, y: 3.1))
    p.closeSubpath()
    return p
}

let petal = petalPath()

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
            let inset = p * 0.18
            let box = CGRect(x: inset, y: inset, width: p - inset * 2, height: p - inset * 2)
            cg.saveGState()
            cg.beginTransparencyLayer(auxiliaryInfo: nil)
            cg.translateBy(x: box.minX, y: box.maxY)
            cg.scaleBy(x: box.width / 24.0, y: -box.height / 24.0)
            cg.setFillColor(markColor.cgColor)
            for i in 0..<6 {
                cg.saveGState()
                cg.translateBy(x: 12.0, y: 12.0)
                cg.rotate(by: CGFloat(i) * (.pi / 3.0))
                cg.translateBy(x: -12.0, y: -12.0)
                cg.addPath(petal)
                cg.fillPath()
                cg.restoreGState()
            }
            cg.setBlendMode(.clear)
            cg.addEllipse(in: CGRect(x: 12.0 - 2.8, y: 12.0 - 2.8, width: 5.6, height: 5.6))
            cg.fillPath()
            cg.endTransparencyLayer()
            cg.restoreGState()
        }

        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: folder).appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}

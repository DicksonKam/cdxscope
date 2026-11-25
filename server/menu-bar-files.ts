import { join } from "node:path";
export const menuBarLabel = "com.dicksonkam.cdxscope.menubar";
export function plistString(value: string) {
  return `<string>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;")}</string>`;
}
export function menuBarAgent(app: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${plistString(menuBarLabel)}
<key>ProgramArguments</key><array>${plistString(join(app, "Contents/MacOS/CDXScope"))}</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>LimitLoadToSessionType</key><string>Aqua</string>
<key>ProcessType</key><string>Interactive</string>
<key>ThrottleInterval</key><integer>30</integer>
</dict></plist>\n`;
}
export function appInfo() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key>${plistString(menuBarLabel)}
<key>CFBundleName</key><string>CDXScope</string>
<key>CFBundleDisplayName</key><string>CDXScope</string>
<key>CFBundleExecutable</key><string>CDXScope</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.2.2</string>
<key>CFBundleVersion</key><string>8</string>
<key>CFBundleIconFile</key><string>CDXScope</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>\n`;
}

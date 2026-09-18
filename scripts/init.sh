#!/bin/bash
set -e

echo "🔧 Initializing Easy OTP development environment..."

# Clean install electron
echo "📦 Installing dependencies..."
rm -rf node_modules/electron
npm install

# Remove quarantine attribute (unsigned Electron on macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
    ELECTRON_PATH="node_modules/electron/dist/Electron.app"
    if [ -d "$ELECTRON_PATH" ]; then
        echo "🛡️  Removing quarantine attribute from Electron..."
        xattr -dr com.apple.quarantine "$ELECTRON_PATH" || true

        echo "✍️  Adding ad-hoc code signature..."
        codesign -s - "$ELECTRON_PATH" || true
    fi
fi

echo "✅ Setup complete! Run 'npm start' to launch the app."

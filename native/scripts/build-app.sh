#!/usr/bin/env bash
# native/scripts/build-app.sh — SPM 실행 파일을 진짜 macOS .app 번들로 감싼다.
#
# 왜 필요한가: UNUserNotificationCenter 같은 프레임워크는 CFBundleIdentifier가 있는 진짜 .app 번들
# 안에서 실행 중이어야만 동작한다(bundleProxyForCurrentProcess nil 크래시로 실측됨 — §NotificationBridge.swift).
# `swift build`가 만드는 raw 실행 파일은 번들이 아니라서, 로컬 개발 중엔 그 기능이 자동으로 꺼지고
# (§NotificationBridge.hasProperBundle) 이 스크립트로 패키징해야 실제 동작을 확인할 수 있다.
#
# 기본값은 ad-hoc 서명(로컬 실행/테스트용). 실제 배포(Developer ID + 공증)는 electron-builder의
# afterSign.cjs가 하던 것과 같은 자리지만, 그건 이 앱을 실제로 배포하기로 확정한 뒤 사람이 판단할
# 일이라 여기서 자동으로 만지지 않는다 — CODESIGN_IDENTITY 환경변수로 넘기면 그 identity로 서명한다.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
APP_NAME="OpenTask-Swift"
BUILD_DIR="$NATIVE_DIR/.build/app"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
CONFIGURATION="${1:-debug}" # debug | release

echo "🔨  swift build -c $CONFIGURATION"
cd "$NATIVE_DIR"
if [ "$CONFIGURATION" = "release" ]; then
	swift build -c release
	BIN_PATH="$NATIVE_DIR/.build/release/OpenTaskShell"
else
	swift build
	BIN_PATH="$NATIVE_DIR/.build/debug/OpenTaskShell"
fi

echo "📦  번들 조립 — $APP_BUNDLE"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
cp "$BIN_PATH" "$APP_BUNDLE/Contents/MacOS/OpenTaskShell"

VERSION=$(node -e "console.log(require('$REPO_ROOT/app/package.json').version)" 2>/dev/null || echo "0.0.0")
sed "s/__VERSION__/$VERSION/g" "$NATIVE_DIR/Resources/Info.plist" > "$APP_BUNDLE/Contents/Info.plist"

ICON_SRC="$REPO_ROOT/app/build/icon.png"
if [ -f "$ICON_SRC" ]; then
	echo "🎨  아이콘 변환 — $ICON_SRC → icon.icns"
	ICONSET_DIR="$BUILD_DIR/icon.iconset"
	rm -rf "$ICONSET_DIR"
	mkdir -p "$ICONSET_DIR"
	for size in 16 32 128 256 512; do
		sips -z $size $size "$ICON_SRC" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
		double=$((size * 2))
		sips -z $double $double "$ICON_SRC" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
	done
	iconutil -c icns "$ICONSET_DIR" -o "$APP_BUNDLE/Contents/Resources/icon.icns"
	rm -rf "$ICONSET_DIR"
else
	echo "⚠️  아이콘 소스 없음($ICON_SRC) — 기본 아이콘으로 실행됨"
fi

IDENTITY="${CODESIGN_IDENTITY:--}" # 기본값 '-' = ad-hoc 서명(로컬 전용, 배포 불가)
echo "🔏  코드사이닝 — identity: $IDENTITY"
codesign --force --deep --sign "$IDENTITY" "$APP_BUNDLE"

echo "✅  빌드 완료: $APP_BUNDLE"
echo "   실행: open \"$APP_BUNDLE\""

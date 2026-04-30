.SUFFIXES:
.PHONY: help install install-deps sign-node-pty dev build lint clean \
        cli-install cli-build cli-link cli-dev cli-doctor cli-test-client \
        mobile-install mobile-start mobile-ios mobile-android mobile-web mobile-lint \
        landing-serve

# OS detection for system-level dependencies (cloudflared, tmux).
UNAME_S := $(shell uname -s 2>/dev/null)

# Default target prints the help table.
help:
	@echo "Juno Makefile"
	@echo ""
	@echo "Top-level"
	@echo "  install            Install system + project deps and link juno globally."
	@echo "  install-deps       Install system tools (cloudflared, tmux) for current OS."
	@echo "  dev                Start cli (juno pair) and mobile expo concurrently."
	@echo "  build              Build cli (TypeScript -> dist/)."
	@echo "  lint               Run mobile lint."
	@echo "  clean              Remove dist + node_modules across cli + mobile."
	@echo ""
	@echo "CLI       (Node + TypeScript, ships as juno binary)"
	@echo "  cli-install        npm install"
	@echo "  cli-build          tsc compile"
	@echo "  cli-link           npm link (exposes juno on PATH)"
	@echo "  cli-dev            Start juno pair via ts-node + tunnel script"
	@echo "  cli-doctor         Run juno doctor against current env"
	@echo "  cli-test-client    Manual smoke client over WebSocket"
	@echo ""
	@echo "Mobile    (Expo / React Native)"
	@echo "  mobile-install     npm install"
	@echo "  mobile-start       Expo dev server"
	@echo "  mobile-ios         Run on iOS simulator"
	@echo "  mobile-android     Run on Android emulator"
	@echo "  mobile-web         Expo web mode"
	@echo "  mobile-lint        ESLint via Expo"
	@echo ""
	@echo "Landing   (static site for vercel)"
	@echo "  landing-serve      Serve landing/ on http://localhost:8000"

# ───── Top level ─────

install: install-deps cli-install mobile-install cli-build sign-node-pty cli-link
	@echo ""
	@echo "✅ juno installed. run 'juno pair' from any project to start."

# macOS only: ensure node-pty's prebuilt spawn-helper is executable + signed.
# Without this, PTY spawning fails with "posix_spawnp failed" on Apple Silicon.
sign-node-pty:
ifeq ($(UNAME_S),Darwin)
	@echo "▶ preparing node-pty prebuilts for macOS"
	@cd cli && for helper in $$(find node_modules/node-pty/prebuilds -type f -name spawn-helper); do \
	  echo "  chmod +x $$helper"; chmod +x "$$helper"; \
	  echo "  codesign $$helper"; codesign --force --sign - "$$helper"; \
	done
	@cd cli && for native in $$(find node_modules/node-pty -name "*.node"); do \
	  echo "  codesign $$native"; codesign --force --sign - "$$native"; \
	done
	@echo "✅ node-pty ready"
endif

# Cross-platform system dependency installer.
# - macOS: Homebrew
# - Linux: apt (Debian/Ubuntu), dnf (Fedora/RHEL), or pacman (Arch)
# - Other: prints manual install instructions and continues.
install-deps:
	@echo "▶ installing system deps (cloudflared, tmux) for $(UNAME_S)"
ifeq ($(UNAME_S),Darwin)
	@command -v brew >/dev/null || { echo "❌ Homebrew required. Install from https://brew.sh first."; exit 1; }
	@command -v cloudflared >/dev/null || brew install cloudflared
	@command -v tmux >/dev/null || brew install tmux
else ifeq ($(UNAME_S),Linux)
	@if command -v apt-get >/dev/null; then \
	  command -v cloudflared >/dev/null || (curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i /tmp/cloudflared.deb && rm /tmp/cloudflared.deb); \
	  command -v tmux >/dev/null || sudo apt-get install -y tmux; \
	elif command -v dnf >/dev/null; then \
	  command -v cloudflared >/dev/null || sudo dnf install -y cloudflared; \
	  command -v tmux >/dev/null || sudo dnf install -y tmux; \
	elif command -v pacman >/dev/null; then \
	  command -v cloudflared >/dev/null || sudo pacman -S --noconfirm cloudflared; \
	  command -v tmux >/dev/null || sudo pacman -S --noconfirm tmux; \
	else \
	  echo "⚠️  Unknown Linux distro. Install cloudflared + tmux manually then re-run 'make install'."; \
	fi
else
	@echo "⚠️  Unsupported OS: $(UNAME_S)."
	@echo "   On Windows, run inside WSL2 (Ubuntu) or install cloudflared + tmux manually:"
	@echo "     winget install --id Cloudflare.cloudflared"
	@echo "     (tmux is not available on native Windows; use WSL)"
endif
	@echo "✅ system deps ready"

dev:
	@echo "▶ starting cli + mobile in parallel - ctrl+c to stop both"
	@trap 'kill 0' INT TERM EXIT; \
	  ($(MAKE) cli-dev &) ; \
	  ($(MAKE) mobile-start &) ; \
	  wait

build: cli-build

lint: mobile-lint

clean:
	rm -rf cli/dist cli/node_modules
	rm -rf mobile/node_modules mobile/.expo

# ───── CLI ─────

cli-install:
	cd cli && npm install

cli-build:
	cd cli && npm run build

cli-link: cli-build
	cd cli && npm link

cli-dev:
	cd cli && npm run dev

cli-doctor:
	cd cli && node bin/juno.js doctor

cli-test-client:
	cd cli && npm run test:client

# ───── Mobile ─────

mobile-install:
	cd mobile && npm install

mobile-start:
	cd mobile && npx expo start

mobile-ios:
	cd mobile && npx expo start --ios

mobile-android:
	cd mobile && npx expo start --android

mobile-web:
	cd mobile && npx expo start --web

mobile-lint:
	cd mobile && npx expo lint

# ───── Landing ─────

landing-serve:
	cd landing && python3 -m http.server 8000

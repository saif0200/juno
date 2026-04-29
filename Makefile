.SUFFIXES:
.PHONY: help install dev build lint clean \
        cli-install cli-build cli-link cli-dev cli-doctor cli-test-client \
        mobile-install mobile-start mobile-ios mobile-android mobile-web mobile-lint \
        landing-serve

# Default target prints the help table.
help:
	@echo "Juno Makefile"
	@echo ""
	@echo "Top-level"
	@echo "  install            Install deps for cli + mobile and link juno globally."
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

install: cli-install mobile-install cli-build cli-link

dev:
	@echo "▶ starting cli + mobile in parallel — ctrl+c to stop both"
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

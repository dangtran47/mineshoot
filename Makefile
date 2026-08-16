.PHONY: start install server client build test deploy deploy-fe deploy-be

# Prod server URL baked into client bundle at build time
VITE_SERVER_URL ?= wss://mineshoot-server-prd.fly.dev

# Simulated round-trip latency (ms) for local dev; 0 = off. Usage: make start LAG=50
LAG ?= 0

install:
	npm install

# Start server + client together (Ctrl-C stops both)
start:
	@echo "Starting mineshoot (server + client)..."
	@trap 'kill 0' INT TERM EXIT; \
	SIMULATE_LATENCY_MS=$(LAG) npm run dev --workspace=@mineshoot/server & \
	npm run dev --workspace=@mineshoot/client & \
	wait

server:
	SIMULATE_LATENCY_MS=$(LAG) npm run dev --workspace=@mineshoot/server

client:
	npm run dev --workspace=@mineshoot/client

build:
	npm run build --workspace=@mineshoot/server
	npm run build --workspace=@mineshoot/client

test:
	npm test

deploy: deploy-fe deploy-be

deploy-fe:
	VITE_SERVER_URL=$(VITE_SERVER_URL) npm run build -w @mineshoot/client
	npx wrangler pages deploy packages/client/dist --project-name mineshoot

deploy-be:
	fly deploy -c packages/server/fly.toml --ha=false

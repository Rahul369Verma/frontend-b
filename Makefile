# -------------------------------------------------------------
# 💻 FRONTEND DOCKER MANAGEMENT
# -------------------------------------------------------------

# Main deployment command
up: build
	@echo "🚀 Starting Frontend services..."
	docker compose up -d
	@echo "✅ Frontend started at http://localhost:5173"

# Build the Docker image
build:
	@echo "🏗️ Building Frontend Docker image..."
	docker compose build

# Stop services
down:
	@echo "🛑 Stopping Frontend services..."
	docker compose down

# Fast restart
restart:
	@echo "🔄 Restarting Frontend container..."
	docker compose restart frontend

# View logs
logs:
	docker compose logs -f frontend

# Drop into shell
shell:
	docker compose exec -it frontend /bin/bash

# Clean build
clean:
	@echo "🗑️ Wiping Docker cache and rebuilding..."
	docker compose build --no-cache
	docker compose up -d

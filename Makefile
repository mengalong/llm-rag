BACKEND_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))backend

.PHONY: install dev-backend dev-frontend dev reset-db check rebuild-graph migrate-kuzu help

help:
	@echo "Available targets:"
	@echo "  install         Install all dependencies"
	@echo "  check           Check all configured models are reachable"
	@echo "  dev             Start backend + frontend (run in two terminals)"
	@echo "  dev-backend     Start FastAPI backend (port 9000)"
	@echo "  dev-frontend    Start Vite frontend (port 5173)"
	@echo "  reset-db        Delete all data (uploads, chroma, graph, sqlite)"
	@echo "  rebuild-graph   Rebuild knowledge graph from all indexed documents"
	@echo "                  Skip LLM extraction: make rebuild-graph no-llm=1"
	@echo "  migrate-kuzu    Migrate GraphML snapshots to Kuzu format"

install:
	cd backend && conda run -n llm-rag pip install -r requirements.txt
	cd frontend && npm install

check:
	cd backend && conda run --no-capture-output -n llm-rag python -m scripts.check_models

dev-backend:
	cd backend && conda run --no-capture-output -n llm-rag uvicorn app.main:app --reload --port 9000 --log-level info

dev-frontend:
	cd frontend && npm run dev

dev:
	@echo "Open two terminals and run:"
	@echo "  make dev-backend"
	@echo "  make dev-frontend"

reset-db:
	@echo "Deleting all data..."
	rm -rf backend/data/uploads/* backend/data/chroma/* backend/data/graphs/* backend/data/metadata.db
	@echo "Done."

rebuild-graph:
	cd backend && conda run --no-capture-output -n llm-rag python -m scripts.rebuild_graph $(if $(no-llm),--no-llm,)

migrate-kuzu:
	cd backend && conda run --no-capture-output -n llm-rag python -m scripts.migrate_to_kuzu

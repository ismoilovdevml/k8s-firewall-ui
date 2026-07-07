BINARY := bin/k8s-firewall-ui
VERSION ?= dev
LDFLAGS := -s -w -X github.com/ismoilovdevml/k8s-firewall-ui/internal/version.Version=$(VERSION)

.PHONY: all web backend build run dev test test-web lint lint-web docker helm-lint clean

all: build

## web: build the frontend into web/dist (embedded by the Go binary)
web:
	cd web && npm ci && npm run build

## backend: build the Go binary (embeds whatever is in web/dist)
backend:
	go build -ldflags '$(LDFLAGS)' -o $(BINARY) ./cmd/k8s-firewall-ui

## build: full production build (frontend + backend)
build: web backend

## run: build everything and run against the current kubeconfig
run: build
	./$(BINARY)

## dev: run backend only; start the frontend separately with `cd web && npm run dev`
dev:
	go run ./cmd/k8s-firewall-ui

test:
	go test ./... -race -cover

test-web:
	cd web && npm test -- --run

lint:
	golangci-lint run ./...

lint-web:
	cd web && npm run lint

docker:
	docker build -t k8s-firewall-ui:$(VERSION) .

helm-lint:
	helm lint deploy/helm/k8s-firewall-ui

clean:
	rm -rf bin web/dist/*
	touch web/dist/.gitkeep

# Stage 1: build the frontend
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: build the Go binary with the frontend embedded
FROM golang:1.26-alpine AS build
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build \
      -ldflags "-s -w -X github.com/ismoilovdevml/k8s-firewall-ui/internal/version.Version=${VERSION}" \
      -o /k8s-firewall-ui ./cmd/k8s-firewall-ui

# Stage 3: minimal runtime
FROM gcr.io/distroless/static:nonroot
COPY --from=build /k8s-firewall-ui /k8s-firewall-ui
USER nonroot
EXPOSE 8080
ENTRYPOINT ["/k8s-firewall-ui"]

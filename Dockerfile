# Build stage
FROM alpine:latest AS builder

RUN apk add --no-cache zig

WORKDIR /app
COPY . .
RUN zig build -Doptimize=ReleaseSafe

# Runtime stage
FROM alpine:latest

RUN apk add --no-cache ca-certificates aws-cli tar

WORKDIR /app
COPY --from=builder /app/zig-out/bin/neiro /usr/local/bin/neiro
COPY config.json /app/config.json

# Entry point
CMD ["neiro"]

FROM --platform=linux/amd64 debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs stockfish ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Debian installs stockfish into /usr/games which isn't on root's default PATH.
ENV PATH=/usr/games:$PATH

WORKDIR /app
COPY server.mjs .

EXPOSE 8080
CMD ["node", "server.mjs"]

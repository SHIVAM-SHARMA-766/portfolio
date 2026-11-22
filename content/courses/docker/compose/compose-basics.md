---
title: Docker Compose basics
description: Run an app and its database together with one file and one command.
sidebar:
  order: 1
difficulty: intermediate
minutes: 25
quiz:
  - question: How does the web service reach the database in this example?
    options: ["localhost:5432", "db:5432", "The host's IP address", "It can't without extra config"]
    answer: 1
    explanation: Compose puts services on a shared network where each service name resolves via DNS.
  - question: What survives `docker compose down` in this example?
    options: ["Nothing", "The containers", "The named volume pgdata", "The network"]
    answer: 2
    explanation: Named volumes are kept unless you run down -v.
---

Real applications have several parts — a web app, a database, maybe a cache. **Docker
Compose** describes them all in one file.

```yaml title="compose.yaml"
services:
  web:
    build: .
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgres://app:app@db:5432/app
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      retries: 5

volumes:
  pgdata:
```

```bash
docker compose up -d       # build and start everything
docker compose ps          # status of each service
docker compose logs -f web
docker compose down        # stop and remove containers (volumes are kept)
```

## What Compose gives you

- **A private network** where each service is reachable by its name — `web` talks to
  `db:5432`, not `localhost`.
- **Startup order** with `depends_on`, and with `condition: service_healthy` it waits until
  the database actually accepts connections.
- **Named volumes** so data survives `down` and `up`.

:::note
The passwords here are fine for local development only. In production, use Compose
secrets or your platform's secret store.
:::

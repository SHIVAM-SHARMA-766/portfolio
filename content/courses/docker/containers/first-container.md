---
title: Running containers
description: Run, list, inspect, stop and remove containers.
sidebar:
  order: 1
difficulty: beginner
minutes: 15
quiz:
  - question: Which flag publishes container port 80 on host port 8080?
    options: ["-p 80:8080", "-p 8080:80", "--port 8080", "-e PORT=8080"]
    answer: 1
    explanation: The format is host:container, so -p 8080:80.
  - question: What does `docker ps -a` show that `docker ps` doesn't?
    options: ["Images", "Stopped containers", "Volumes", "Networks"]
    answer: 1
    explanation: Without -a, only running containers are listed.
---

## Run a web server

```bash
docker run -d --name web -p 8080:80 nginx:1.27
```

| Flag | Meaning |
|---|---|
| `-d` | Detached — run in the background |
| `--name web` | Give the container a name instead of a random one |
| `-p 8080:80` | Publish container port 80 on host port 8080 (`host:container`) |
| `nginx:1.27` | The image and its tag. Always pin a tag rather than relying on `latest` |

Open <http://localhost:8080> and you'll see the nginx welcome page.

## Look around

```bash
docker ps                 # running containers
docker logs -f web        # follow its output (Ctrl+C to stop following)
docker exec -it web sh    # open a shell inside it
docker inspect web        # everything Docker knows about it, as JSON
```

## Clean up

```bash
docker stop web
docker ps -a              # the stopped container still exists
docker rm web
```

:::tip
`docker run --rm ...` removes the container automatically when it exits — ideal for
one-off commands.
:::

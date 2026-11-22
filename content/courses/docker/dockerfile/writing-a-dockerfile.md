---
title: Writing a Dockerfile
description: Build your own image — small, cached and running as a non-root user.
sidebar:
  order: 1
difficulty: intermediate
minutes: 25
quiz:
  - question: Why copy requirements.txt and install dependencies before copying the rest of the code?
    options: ["It's required by Docker", "So code changes don't invalidate the dependency layer cache", "It makes the image more secure", "Python needs it that way"]
    answer: 1
    explanation: Layers rebuild from the first changed step onwards. Dependencies change less often than code.
  - question: What does the USER instruction protect against?
    options: ["Slow builds", "A compromised app having root inside the container", "Port conflicts", "Large images"]
    answer: 1
    explanation: Running as non-root limits what an attacker can do if the application is exploited.
---

A **Dockerfile** is a recipe for an image. Here's a small Python web app:

```dockerfile title="Dockerfile"
FROM python:3.12-slim

WORKDIR /app

# Dependencies first: this layer is cached until requirements.txt changes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Code last: it changes most often
COPY . .

# Never run as root inside the container
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000
CMD ["python", "-m", "http.server", "8000"]
```

Build and run it:

```bash
docker build -t myapp:1.0 .
docker run --rm -p 8000:8000 myapp:1.0
```

## Keep the build context small

Everything in the directory is sent to the builder. Add a `.dockerignore`:

```text title=".dockerignore"
.git
node_modules
__pycache__
.env
```

:::danger
Never `COPY` secrets such as `.env` files into an image. Anyone who can pull the image can
read every layer — even files deleted in a later step.
:::

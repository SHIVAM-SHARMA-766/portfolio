---
title: Images and layers
description: How images are built from layers, and why that makes them fast.
sidebar:
  order: 2
difficulty: beginner
minutes: 15
quiz:
  - question: Two images share the same base layers. How many copies of those layers are stored on disk?
    options: ["One", "Two", "One per container", "It depends on the registry"]
    answer: 0
    explanation: Layers are content-addressed and shared, so identical layers are stored once.
---

An image is a stack of **read-only layers**. Each layer records the files added, changed
or removed by one build step. When you run a container, Docker adds a thin **writable
layer** on top.

```bash
docker pull python:3.12-slim
docker history python:3.12-slim     # one row per layer
docker image ls                     # local images and their sizes
```

## Why layers matter

- **Sharing** — layers are identified by a hash of their content. Ten images built on the
  same base store that base once.
- **Caching** — when you rebuild, Docker reuses every layer whose inputs haven't changed.
  Order your build steps from *least* to *most* frequently changing to get the most cache
  hits. You'll use this in the next chapter.

## Tags and digests

A tag like `python:3.12-slim` is a movable pointer — it can point at a different image
tomorrow. A digest (`python@sha256:…`) never changes. Production deployments pin digests
for exactly that reason.

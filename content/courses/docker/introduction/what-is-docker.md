---
title: What is Docker?
description: Containers, images and why they exist.
sidebar:
  order: 1
difficulty: beginner
minutes: 10
quiz:
  - question: What does a container share with its host?
    options: ["Nothing — it has its own kernel", "The host's kernel", "The host's user accounts", "The host's filesystem, always"]
    answer: 1
    explanation: Containers are isolated processes on the host kernel. A virtual machine brings its own kernel.
  - question: An image is to a container what…
    options: ["a class is to an object", "a server is to a client", "a disk is to RAM", "a log is to a metric"]
    answer: 0
    explanation: An image is the read-only template; a container is a running instance created from it.
---

"It works on my machine" is the oldest problem in software. Your laptop has one version
of Python, the server has another, and a library that was present on one is missing on
the other. **Docker packages an application together with everything it needs to run**, so
it behaves the same everywhere.

## Containers are just isolated processes

A container is not a small virtual machine. It is an ordinary Linux process that the
kernel isolates using two features:

- **Namespaces** decide what a process can *see* — its own process list, network
  interfaces, hostname and filesystem.
- **cgroups** decide what a process can *use* — how much CPU, memory and I/O.

Because containers share the host's kernel, they start in milliseconds and use far less
memory than virtual machines, which each boot a full operating system.

| | Virtual machine | Container |
|---|---|---|
| Kernel | Its own | Shared with host |
| Start time | Tens of seconds | Milliseconds |
| Size | Gigabytes | Megabytes |
| Isolation | Strong (hardware) | Process-level |

## Images and containers

- An **image** is a read-only template: a filesystem plus metadata such as which command
  to run.
- A **container** is a running instance of an image, with a thin writable layer on top.

You can start many containers from one image, just as you can create many objects from
one class.

:::tip
Containers are meant to be disposable. Anything you want to keep — databases, uploads —
belongs in a **volume**, which you'll meet in chapter 2.
:::

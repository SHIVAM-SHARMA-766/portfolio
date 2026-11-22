---
title: Installing Docker
description: Get Docker running on Linux, macOS or Windows.
sidebar:
  order: 2
difficulty: beginner
minutes: 10
quiz:
  - question: Which command checks that Docker can pull and run an image?
    options: ["docker version", "docker run hello-world", "docker ps", "docker info --pull"]
    answer: 1
    explanation: hello-world pulls a tiny image and runs it, exercising the whole path end to end.
---

## Linux

The quickest way on Ubuntu or Debian is Docker's convenience script. Read it before you
run it — that's a good habit for any script piped from the internet.

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
less get-docker.sh          # read what it does
sudo sh get-docker.sh
sudo usermod -aG docker "$USER"   # run docker without sudo (log out and back in)
```

:::caution
Membership of the `docker` group is effectively root access on that machine. Only add
users you would trust with `sudo`.
:::

## macOS and Windows

Install **Docker Desktop** from docker.com. It runs a small Linux VM behind the scenes,
because containers need a Linux kernel.

## Check it works

```bash
docker run hello-world
```

You should see `Hello from Docker!`. Behind that message, Docker looked for the image
locally, pulled it from Docker Hub, created a container and ran it.

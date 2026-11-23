---
title: Why my infrastructure costs $0 a month
description: Running real services on free tiers without cutting corners on quality.
date: 2026-11-22
tags: [devops, oci, terraform]
cover: /uploads/blog-zero-cost.webp
coverAlt: "$0 a month: Oracle Cloud, Cloudflare, GitHub Actions and AWS on free tiers"
draft: false
---

Zero cost is a constraint, not an excuse. Everything I run is defined in Terraform,
kept in Git and documented well enough that a stranger could rebuild it.

## The rules

1. **Verify free-tier limits in the provider's own docs** before placing a workload.
2. **One Terraform state per provider**, so one provider can be torn down without touching the others.
3. **Boring and self-healing beats clever.** Something that fails loudly and restarts is better than something elegant that needs nursing at 2am.

This site itself follows those rules: it's static, built by GitHub Actions and served
by Caddy from an always-free Oracle Cloud VM.

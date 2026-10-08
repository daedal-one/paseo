---
id: PROJECT:daedal-dsh
type: project
status: accepted
summary: "Primary daedal-one desktop, mobile and web interface for DeepSeek Harness."
owners: [daedal-one]
---

# Daedal DSH

## Purpose

Give DSH users one interface for their existing and new sessions across desktop, iPhone and browser, under the Daedal DSH product identity confirmed by Carlo.

## Scope

Own the frontend, portable presentation, platform shell, connection experience and client delivery. Integrate DSH workspaces, sessions, tools, approvals, settings, extensions and host capabilities. Coordinate backend work in the owning DSH repository. Retain the current DSH UI until parity and recovery gates pass.

## Non-goals

Do not own a second agent engine, duplicate durable session store, independent execution scheduler or alternate package-management authority. Do not make Forge Spec or Forge Intellect mandatory runtime services for end-user conversations. Do not narrow DSH to one model provider. Hosted multi-tenant accounts and a public relay are outside this migration.

## Principles

DSH owns execution and durable state. Native DSH semantics survive all clients. Platform limitations and missing host capabilities are visible. Device reachability does not confer application permission. Updates preserve installed identity and data ownership. Forge Spec owns reviewed intent and Forge Intellect retains attributable evidence.

Carlo approved implementation of the specifications and the [migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).

# WebSocket Server

[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?style=flat-square&logo=bun&logoColor=black)](https://bun.sh/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-010101?style=flat-square&logo=socket.io&logoColor=white)](https://socket.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-orange?style=flat-square)](./LICENSE)
[![Engine](https://img.shields.io/npm/v/@rvncom/socketio-bun-engine?style=flat-square&color=blue&label=engine)](https://www.npmjs.com/package/@rvncom/socketio-bun-engine)

Standalone real-time WebSocket server built on [Socket.IO](https://socket.io/) with [Bun](https://bun.sh/) runtime and native Bun WebSocket support via [`@rvncom/socketio-bun-engine`](https://www.npmjs.com/package/@rvncom/socketio-bun-engine).

## Features

- Native Bun WebSocket transport (no Node.js compatibility layer)
- Token-based authentication via external auth service callback
- In-memory token & access caching to minimize auth overhead
- IP-based rate limiting for connection attempts
- Per-socket message rate limiting (timer-based)
- REST broadcast API for service-to-service event delivery
- Zero-copy broadcast optimization for global notifications
- Built-in server metrics and RTT measurement
- Graceful degradation under high load
- Room-based access control (support tickets, profile comments)

## Setup

```bash
bun install
cp .env.example .env.local
```

Edit `.env.local` with your configuration (see `.env.example` for all options).

## Usage

```bash
# Development (auto-reload)
bun dev

# Production
bun start
```

## API

### Health Check

```
GET /health
→ { "status": "ok", "connections": 42, "degraded": false, "metrics": { ... } }
```

### Broadcast (internal, requires `x-internal-api-key` header)

| Endpoint | Description |
|---|---|
| `POST /broadcast/support/message` | New support message |
| `POST /broadcast/support/ticket-update` | Ticket status change |
| `POST /broadcast/support/ticket-assigned` | Ticket assignment |
| `POST /broadcast/support/message-read` | Messages marked as read |
| `POST /broadcast/profile/comment` | New profile comment |
| `POST /broadcast/system` | System notification (zero-copy broadcast) |

### Socket.IO Events

**Client → Server:**
- `support:join` / `support:leave` — join/leave ticket room
- `support:typing` — typing indicator (rate-limited)
- `profile:join` / `profile:leave` — join/leave profile room

**Server → Client:**
- `support:message:new` — new message in ticket
- `support:ticket:updated` — ticket status changed
- `support:ticket:assigned` — ticket assigned
- `support:typing:status` — typing indicator broadcast
- `support:message:read` — messages read
- `support:error` — error notification
- `profile:comment:new` — new profile comment
- `system:notification` — system notification

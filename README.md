# ⚡ Decentralized EV Charging System

> A real-time distributed systems simulation demonstrating the **Ricart–Agrawala Mutual Exclusion Algorithm** applied to **EV charging station slot management**.

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11-blue?logo=python&logoColor=white" alt="Python 3.11" />
  <img src="https://img.shields.io/badge/FastAPI-0.110-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/React-18.2-61DAFB?logo=react&logoColor=black" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-5.2-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-5.1-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" alt="Docker" />
</p>

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Concepts](#key-concepts)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [Option 1 — Docker Compose (Recommended)](#option-1--docker-compose-recommended)
  - [Option 2 — Run Locally (PowerShell)](#option-2--run-locally-powershell)
  - [Option 3 — Manual Setup](#option-3--manual-setup)
- [Usage Guide](#usage-guide)
- [Simulation Scenarios](#simulation-scenarios)
- [API Reference](#api-reference)
- [WebSocket Protocol](#websocket-protocol)
- [Technical Deep Dive](#technical-deep-dive)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

In a decentralized EV charging network, multiple autonomous charging stations compete for shared resources (booking slots) without a central coordinator. This project simulates that problem using the **Ricart–Agrawala algorithm** — a classic distributed mutual exclusion protocol — where each node must obtain permission from every other active node before entering the critical section (i.e., booking a charging slot).

The system runs **5 independent backend nodes** (A–E), each as a separate FastAPI server with its own Lamport logical clock, communicating via HTTP. A React-based real-time dashboard visualizes the entire protocol in action: message passing, clock synchronization, state transitions, and fault handling.

---

## Key Concepts

| Concept | Description |
| --- | --- |
| **Mutual Exclusion** | Only one node may occupy the critical section (charging slot) at a time |
| **Ricart–Agrawala Algorithm** | A permission-based distributed algorithm that uses timestamped requests |
| **Lamport Clocks** | Logical clocks to establish a total ordering of events across distributed nodes |
| **Deferred Replies** | When a node is in the CS or has higher priority, it defers replying until it exits |
| **Fault Tolerance** | Nodes can fail and recover; the system adapts by updating the active peer set |
| **Network Partitioning** | The system handles scenarios where subsets of nodes become unreachable |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Frontend (React)                     │
│                    localhost:5173                         │
│  ┌─────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │  Network     │  │  Controls     │  │  Real-time    │  │
│  │  Topology    │  │  Panel        │  │  Logs         │  │
│  │  (SVG Graph) │  │  (Scenarios)  │  │  (WebSocket)  │  │
│  └──────┬──────┘  └───────┬───────┘  └───────┬───────┘  │
│         │  WebSocket (x5) │  HTTP POST       │           │
└─────────┼─────────────────┼──────────────────┼───────────┘
          │                 │                  │
    ┌─────▼─────────────────▼──────────────────▼─────┐
    │              Backend Nodes (FastAPI)             │
    │                                                  │
    │  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
    │  │Node A│◄─►Node B│◄─►Node C│◄─►Node D│◄─►Node E│
    │  │:8001 │  │:8002 │  │:8003 │  │:8004 │  │:8005 │
    │  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘
    │         Peer-to-Peer HTTP Communication          │
    └──────────────────────────────────────────────────┘
```

### Communication Flow

1. **Frontend → Backend**: HTTP POST requests to trigger actions (book, fail, recover, reset)
2. **Backend → Frontend**: WebSocket pushes for real-time state updates, logs, and message events
3. **Backend ↔ Backend**: HTTP POST requests for Ricart–Agrawala protocol messages (REQUEST, REPLY, RECOVER)

---

## Project Structure

```
Decentralized-EV-Charging-System/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI application — routes & WebSocket endpoint
│   │   └── node.py              # Core Ricart–Agrawala algorithm implementation
│   ├── Dockerfile               # Python 3.11 slim container
│   └── requirements.txt         # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Main dashboard UI with controls & node cards
│   │   ├── main.tsx             # React entry point
│   │   ├── index.css            # Global styles, neon effects, scrollbar
│   │   ├── components/
│   │   │   └── NetworkGraph.tsx # Interactive SVG network topology visualization
│   │   └── hooks/
│   │       └── useNodes.ts      # WebSocket connection manager & state hook
│   ├── index.html               # HTML template with Inter font
│   ├── package.json             # Node dependencies (React, Framer Motion, Lucide)
│   ├── tailwind.config.js       # Tailwind CSS configuration
│   ├── postcss.config.js        # PostCSS configuration
│   ├── tsconfig.json            # TypeScript configuration
│   ├── vite.config.ts           # Vite dev server configuration
│   └── Dockerfile               # Node 18 Alpine container
├── docker-compose.yml           # Multi-service orchestration (5 nodes + frontend)
├── run-local.ps1                # PowerShell script for local development
└── README.md                    # This file
```

---

## Prerequisites

### For Docker Setup
- [Docker](https://docs.docker.com/get-docker/) (v20+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+)

### For Local Development
- [Python](https://www.python.org/downloads/) 3.11+
- [Node.js](https://nodejs.org/) 18+
- [npm](https://www.npmjs.com/) 9+

---

## Getting Started

### Option 1 — Docker Compose (Recommended)

The simplest way to run the entire system:

```bash
# Clone the repository
git clone https://github.com/your-username/Decentralized-EV-Charging-System.git
cd Decentralized-EV-Charging-System

# Build and start all services
docker-compose up --build
```

This spins up:
| Service | URL | Description |
| --- | --- | --- |
| **Frontend** | http://localhost:5173 | React dashboard |
| **Node A** | http://localhost:8001 | Backend node A |
| **Node B** | http://localhost:8002 | Backend node B |
| **Node C** | http://localhost:8003 | Backend node C |
| **Node D** | http://localhost:8004 | Backend node D |
| **Node E** | http://localhost:8005 | Backend node E |

To stop all services:
```bash
docker-compose down
```

### Option 2 — Run Locally (PowerShell)

A convenience script is provided for Windows:

```powershell
# From the project root
.\run-local.ps1
```

This will:
1. Install Python backend dependencies
2. Start 5 backend nodes as PowerShell background jobs
3. Install frontend dependencies
4. Start the Vite dev server

> **Note:** To stop the backend jobs later, run `Stop-Job *` in PowerShell.

### Option 3 — Manual Setup

#### Backend

```bash
cd backend

# Create virtual environment (optional but recommended)
python -m venv venv
# Windows
.\venv\Scripts\Activate.ps1
# macOS/Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start each node in a separate terminal:
# Terminal 1
$env:NODE_ID="A"; $env:PEERS="http://localhost:8002,http://localhost:8003,http://localhost:8004,http://localhost:8005"
uvicorn app.main:app --port 8001

# Terminal 2
$env:NODE_ID="B"; $env:PEERS="http://localhost:8001,http://localhost:8003,http://localhost:8004,http://localhost:8005"
uvicorn app.main:app --port 8002

# Terminal 3
$env:NODE_ID="C"; $env:PEERS="http://localhost:8001,http://localhost:8002,http://localhost:8004,http://localhost:8005"
uvicorn app.main:app --port 8003

# Terminal 4
$env:NODE_ID="D"; $env:PEERS="http://localhost:8001,http://localhost:8002,http://localhost:8003,http://localhost:8005"
uvicorn app.main:app --port 8004

# Terminal 5
$env:NODE_ID="E"; $env:PEERS="http://localhost:8001,http://localhost:8002,http://localhost:8003,http://localhost:8004"
uvicorn app.main:app --port 8005
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Usage Guide

### Dashboard Layout

The dashboard is organized into four main sections:

1. **Network Topology** (top-left) — An SVG pentagon graph showing all 5 nodes with animated message packets flowing between them. Node borders change color based on state.

2. **Universal Controls** (top-right) — Three sets of per-node buttons:
   - 🟢 **Book Slot**: Triggers the node to request the critical section
   - 🔴 **Fail Node**: Simulates an immediate node failure
   - ⚪ **Recover Node**: Brings a failed node back online and re-announces it to peers

3. **Node Cluster Status** (middle) — Real-time status cards for each node showing:
   - Lamport clock value
   - Current state (IDLE / REQUESTING / WAITING_SLOT / OFFLINE)
   - Deferred reply list
   - Reply count vs. required replies

4. **Real-time Logs** (right sidebar) — A scrollable feed of timestamped protocol events from all nodes

### Node States

| State | Visual | Description |
| --- | --- | --- |
| **IDLE** | Gray border | Node is available, not requesting any resource |
| **REQUESTING** | Yellow neon glow | Node has sent REQUEST messages and is waiting for replies |
| **HELD** (WAITING_SLOT) | Green neon glow | Node has received all replies and is in the critical section |
| **FAILED** | Red neon glow | Node has crashed or been taken offline |
| **OFFLINE** | Dim gray | Node is disconnected from the frontend |

---

## Simulation Scenarios

The dashboard includes 5 pre-built scenarios to demonstrate different aspects of the algorithm:

### 🟣 High Load
All idle, connected nodes simultaneously request the critical section. Demonstrates how the algorithm handles contention by using Lamport timestamps as tie-breakers.

### 🔵 Sequential
Nodes request one-by-one with a 1.5s delay between each. Shows orderly, cooperative scheduling where each node enters the CS in turn.

### 🟠 Contention Failure
Node A requests, then immediately fails. Node B requests shortly after. Demonstrates how the system handles a failure during active contention — Node A is removed from the peer set and Node B can proceed.

### 🟢 Recovery & Rejoin
A node fails, recovers after 4 seconds, then requests the critical section. Demonstrates the recovery protocol where the recovering node broadcasts its presence to re-join the active peer set.

### 🟤 Network Partition / Split
Nodes D and E are failed, simulating a network split. The remaining nodes (A, B, C) continue operating as a smaller cluster. Tests partition tolerance.

---

## API Reference

Each backend node exposes the following REST endpoints:

### Internal Protocol Endpoints

| Method | Endpoint | Body | Description |
| --- | --- | --- | --- |
| `POST` | `/api/request` | `{ "timestamp": int, "node_id": str }` | Receive a REQUEST message from a peer |
| `POST` | `/api/reply` | `{ "node_id": str }` | Receive a REPLY message from a peer |
| `POST` | `/api/recover` | `{ "node_id": str, "is_active": bool }` | Receive a recovery announcement |

### UI Trigger Endpoints

| Method | Endpoint | Body | Description |
| --- | --- | --- | --- |
| `POST` | `/api/trigger_booking` | — | Trigger this node to request the critical section |
| `POST` | `/api/trigger_fail` | — | Simulate a failure on this node |
| `POST` | `/api/trigger_recover` | — | Recover this node |
| `POST` | `/api/reset` | — | Reset this node to its initial state |

### WebSocket

| Endpoint | Description |
| --- | --- |
| `ws://localhost:{port}/ws` | Real-time state updates, log entries, and message events |

---

## WebSocket Protocol

The frontend connects to each node's WebSocket endpoint. Messages are JSON objects with a `type` field:

### `STATE_UPDATE`
```json
{
  "type": "STATE_UPDATE",
  "node_id": "A",
  "clock": 5,
  "state": "REQUESTING",
  "deferred": ["B"],
  "active_peers": ["http://node-b:80", "http://node-c:80"],
  "replies_received": ["C"]
}
```

### `LOG`
```json
{
  "type": "LOG",
  "node_id": "A",
  "message": "[T=5] Requesting critical section (ts=5)"
}
```

### `MESSAGE_EVENT`
```json
{
  "type": "MESSAGE_EVENT",
  "source": "A",
  "target": "B",
  "msg_type": "REQUEST"
}
```

---

## Technical Deep Dive

### Ricart–Agrawala Algorithm

The Ricart–Agrawala algorithm is a permission-based distributed mutual exclusion protocol that reduces message complexity from **3(N-1)** (Lamport's algorithm) to **2(N-1)** messages by combining the RELEASE + REPLY into a single deferred REPLY.

#### Algorithm Steps:

1. **Requesting the CS:**
   - Increment Lamport clock
   - Set state to `REQUESTING` and record request timestamp
   - Send `REQUEST(timestamp, node_id)` to all active peers

2. **Receiving a REQUEST:**
   - Update local clock: `clock = max(local_clock, received_clock) + 1`
   - If in `HELD` state → defer the reply
   - If in `REQUESTING` state and own request has higher priority (lower timestamp, or lower ID on tie) → defer
   - Otherwise → send `REPLY` immediately

3. **Entering the CS:**
   - Once replies are received from **all** active peers, enter the critical section

4. **Exiting the CS:**
   - Set state to `IDLE`
   - Send all deferred `REPLY` messages

### Fault Handling

- **Node Failure**: When a peer doesn't respond to a REQUEST (HTTP timeout), it's removed from the active peer set. This allows the requesting node to proceed with fewer required replies.
- **Node Recovery**: A recovering node broadcasts a `RECOVER` message to all known peers, who re-add it to their active peer sets.
- **Network Reset**: All nodes can be reset to their initial state simultaneously.

### Concurrency Control

Each node uses an `asyncio.Lock` to prevent race conditions when multiple concurrent requests arrive. This ensures consistency of the local state (clock, deferred list, replies) despite the asynchronous nature of the system.

---

## Troubleshooting

### Nodes show as "OFFLINE" in the dashboard
- Ensure all 5 backend nodes are running on ports 8001–8005
- Check for port conflicts: `netstat -an | findstr "800[1-5]"`
- If using Docker, verify containers are healthy: `docker-compose ps`

### WebSocket connections keep reconnecting
- The frontend automatically reconnects every 3 seconds if a connection drops
- This is normal if backend nodes haven't started yet

### CORS errors in the browser console
- The backend includes a permissive CORS middleware (`allow_origins=["*"]`)
- If issues persist, clear your browser cache or try in an incognito window

### Docker build fails
- Ensure Docker daemon is running
- Try `docker-compose build --no-cache` for a clean build
- Verify no port conflicts with other services

### PowerShell script errors
- Run PowerShell as Administrator
- Ensure Python and Node.js are in your system PATH
- Check execution policy: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

---

## Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| **Backend** | Python 3.11, FastAPI, Uvicorn | Distributed node servers with async I/O |
| **Communication** | httpx, WebSockets | Inter-node protocol & real-time UI updates |
| **Frontend** | React 18, TypeScript, Vite | Reactive dashboard with hot module replacement |
| **Styling** | Tailwind CSS 3.4 | Utility-first, dark theme styling |
| **Animation** | Framer Motion 11 | Smooth state transitions & message packet animation |
| **Icons** | Lucide React | Clean, consistent icon set |
| **Containerization** | Docker, Docker Compose | Multi-service orchestration |

---

## Contributing

Contributions are welcome! Here are some ideas:

- ✨ Add more distributed algorithms (e.g., Maekawa's, token-based)
- 📊 Add metrics and analytics (throughput, latency, fairness)
- 🧪 Add automated testing (unit + integration)
- 🌐 Deploy to a cloud environment with real network latency
- 📱 Improve mobile responsiveness
- 🔐 Add authentication for the control panel

### Steps

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is open source and available under the [MIT License](LICENSE).

---

<p align="center">
  Built with ⚡ for distributed systems enthusiasts
</p>

# ⚡ Technical Deep Dive: Decentralized EV Charging System

This document provides an exhaustive, in-depth explanation of the concepts, architecture, and file-by-file implementation details of the Decentralized EV Charging System project. It is designed to give you a complete understanding of how the distributed system operates under the hood.

---

## 1. Theoretical Foundation

Before diving into the code, it is essential to understand the theoretical concepts that govern the system.

### The Problem: Distributed Mutual Exclusion
In a decentralized network of EV charging stations, multiple autonomous stations (nodes) might try to book the exact same charging slot at the same time. Because there is no central server (like a master database) to manage a queue, the nodes must communicate with each other to agree on who gets the slot. This problem is known as **Distributed Mutual Exclusion**.

### The Solution: Ricart-Agrawala Algorithm
This project uses the **Ricart–Agrawala Algorithm**, a permission-based algorithm designed for distributed mutual exclusion.
1. When a node wants to enter the Critical Section (CS) — in our case, booking the slot — it broadcasts a `REQUEST` message to all other nodes.
2. It can only enter the CS once it has received a `REPLY` message from **every other active node**.
3. If two nodes request the slot simultaneously, they use **Lamport Logical Clocks** to tie-break.

### Lamport Logical Clocks
In distributed systems, physical clocks cannot be synchronized perfectly. A Lamport clock is a simple software counter maintained by each node.
* Every time a node does something (like requesting a slot), it increments its clock.
* Every time a message is passed, the clock value is attached.
* When a node receives a message, it updates its own clock to be `max(local_clock, received_clock) + 1`.
* **Tie-breaking:** If Node A (clock 5) and Node B (clock 6) request simultaneously, Node A wins because it has the lower timestamp. If clocks are equal, the Node's alphabetical ID (A vs B) is used as the tie-breaker.

---

## 2. Backend Deep Dive (`backend/`)

The backend is built with Python and FastAPI. The simulation runs 5 identical but separate instances of this backend.

### `app/node.py` (The Core Algorithm)
This file is the brain of each individual charging station.

* **Class `Node`**: Holds the state of the node.
  * `self.state`: Can be `IDLE` (doing nothing), `REQUESTING` (trying to get the slot), `HELD` (currently occupying the slot), or `FAILED` (offline).
  * `self.clock`: The Lamport logical clock.
  * `self.deferred_replies`: A list of peer IDs. If a peer asks this node for the slot, but this node has higher priority (e.g., it is already `HELD` or is `REQUESTING` with a lower timestamp), it will not reply immediately. Instead, it adds the peer to this list, effectively making them wait.
  
* **`request_cs(self)`**: Triggered when a node wants to book a slot. It increments the clock, sets its state to `REQUESTING`, and uses `httpx` to send asynchronous HTTP POST requests (`/api/request`) to all other active nodes.

* **`receive_request(self, req)`**: Triggered when a peer asks this node for permission.
  * **Rule 1**: If this node is `HELD` (charging), it DEFERS the reply.
  * **Rule 2**: If this node is `REQUESTING`, it compares timestamps. If this node has a lower timestamp, it DEFERS. Otherwise, it sends a `REPLY` immediately.
  * **Rule 3**: If this node is `IDLE`, it always sends a `REPLY` immediately.

* **`receive_reply(self, rep)`**: Records incoming replies. Once the number of received replies matches the number of active peers, `check_cs_entry()` promotes the node to `HELD` (it enters the Critical Section).

* **`exit_cs(self)`**: Once done charging, the node resets to `IDLE` and loops through `self.deferred_replies`, sending a `REPLY` to all nodes it made wait. This "passes the baton" to the next nodes in line.

* **WebSocket Logic**: Interleaved throughout are calls to `broadcast_ui_update()`. This serializes the node's state into JSON and pushes it to the React frontend over WebSockets, ensuring the UI is always perfectly in sync with the backend memory.

### `app/main.py` (The Network Interfaces)
This file defines the HTTP API that allows the python object in `node.py` to communicate over the network.

* **Inter-Node APIs (`/api/request`, `/api/reply`, `/api/recover`)**: These are the endpoints nodes use to talk to *each other*. For example, when Node A sends a request, it literally performs a POST request to `http://node-b:8002/api/request`.
* **UI Control APIs (`/api/trigger_booking`, `/api/trigger_fail`)**: These endpoints are for the React frontend. When you click "Book Slot" in the UI, React calls this endpoint, which internally forces the Python node to execute `request_cs()`.
* **WebSocket Endpoint (`/ws`)**: Accepts WebSocket connections from the frontend and links them to the `Node` object.

---

## 3. Frontend Deep Dive (`frontend/`)

The frontend is a React application built with TypeScript, Tailwind CSS, and Framer Motion.

### `src/hooks/useNodes.ts` (Synchronization & State)
Hooks in React manage state. Since we are simulating a distributed system, React needs to pull data from 5 different sources simultaneously.

* **Initialization**: The `useEffect` hook runs when the app loads. It explicitly opens 5 `WebSocket` instances hitting the 5 local ports (8001 through 8005).
* **Event Loop**: It listens for messages on these websockets.
  * If it receives `STATE_UPDATE`, it updates the React state object `nodes`.
  * If it receives `LOG`, it prepends a new message to the `logs` array.
  * If it receives `MESSAGE_EVENT`, it adds data to `messageEvents` (which triggers the packet animations).
* **Action Handlers**: Provides functions like `triggerBooking`. When called, this function performs standard HTTP `fetch` requests to the specific node's backend port.

### `src/App.tsx` (Dashboard Layout & Logic)
This is the main view component.

* **Simulation Scenarios (e.g., `handleHighLoad`, `handlePartition`)**: These are functions that strictly manipulate network timings. For example, `handlePartition` tells the backend to "fail" Nodes D and E, and then asks A, B, and C to book a slot. This proves that the Ricart-Agrawala implementation correctly recalculates the active peer size dynamically.
* **Component Composition**: Uses CSS Grid to lay out the dashboard symmetrically. It maps over the `nodes` object to render 5 `<NodeCard />` components.
* **NodeCard Component**: A sub-component that maps a node's state to CSS classes. If state is `REQUESTING`, it applies `.neon-border-yellow`. If `HELD`, it applies `.neon-border`. 

### `src/components/NetworkGraph.tsx` (Data Visualization)
This component translates mathematical node events into a visual map.

* It hardcodes SVG coordinate positions (`x, y`) for a 5-point pentagon.
* It dynamically draws gray lines (edges) between all points.
* **Framer Motion Integration**: The most complex part is `<AnimatePresence>`. When `useNodes.ts` receives a `MESSAGE_EVENT` (e.g., Node A sent a Request to Node B), this component calculates the `x, y` of Node A and Node B, and renders an SVG `<circle />`. Framer Motion mathematically animates the `cx` and `cy` attributes of that circle over 0.6 seconds so it looks like a packet flying across the screen.

### `src/index.css` (The Aesthetic Engine)
* Defines custom `@layer utilities`.
* The `.neon-border` classes utilize multiple overlaid `box-shadows` (an inner shadow + an outer shadow) to create an emissive, glowing effect that looks like hardware LEDs.
* Implements a custom webkit scrollbar for the logging sidebar to match the dark, terminal-like aesthetic.

---

## 4. Orchestration & DevOps

To make the simulation work smoothly, all 6 microservices (1 frontend + 5 backends) must be orchestrated.

### `docker-compose.yml` (Network Bridging)
When using Docker, this file defines how the nodes discover each other.
* It maps container ports to your machine (e.g., `8001:80`).
* **Environment Variables**: The magic happens here. It injects `NODE_ID=A` and `PEERS=http://node-b:80,http://node-c:80...` into the Node A container. This completely decouples the Python code from the network topology. The application code (`node.py`) simply reads the `PEERS` env string and knows exactly who to talk to, relying on Docker's internal DNS resolving `node-b` to an internal IP address.

### `run-local.ps1` (Local Testing)
If Docker isn't used, this script replicates the environment variable injection locally. It uses PowerShell's `Start-Job` to spawn multiple invisible background processes, assigning environment variables to `localhost:8002`, `localhost:8003`, etc., allowing the system to run purely on the host OS.

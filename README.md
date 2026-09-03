Real-Time Collaborative Engineering Workspace 

●	Built  a real-time collaborative engineering workspace enabling multiple users to edit a shared CRDT-based Notepad with near-instant synchronization, while maintaining an independent Python execution environment and shared execution output; designed the system to remain resilient during connectivity loss through automatic state recovery.

●	Deployed full-stack system with a React/Vite frontend on Vercel, FastAPI/Node.js backend services on Render, Ably for low latency realtime messaging and synchronization, Yjs CRDTs with IndexedDB persistence for conflict free collaboration and offline durability, Neon PostgreSQL for persistent room state, and E2B isolated sandboxes for secure Python execution.

●	Tech: React, TypeScript, Vite, Node.js, Express, Yjs, CRDT, Ably, IndexedDB, PostgreSQL, Neon, E2B, REST APIs, Vercel, Render

●	Instant collaborative synchronization during multi user editing, with offline local state retention and isolated Python execution

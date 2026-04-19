# System Pulse Frontend

Vite + React operator UI for the System Pulse backend.

## Features

- Invite users (superadmin/admin flow)
- Accept invitation and set password
- Register system URLs
- Trigger queued health checks
- Read health logs per system
- Assign system access and user status updates

## Run locally

```bash
cd frontend
npm install
npm run dev
```

## Environment variables

Create `frontend/.env`:

```bash
VITE_API_URL=https://YOUR_API_GATEWAY_URL/dev
```

## Build

```bash
npm run build
```

## Deploy

- Frontend: Vercel
- Backend: AWS API Gateway + Lambda (Serverless)

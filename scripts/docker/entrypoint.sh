#!/bin/sh

# Copy default logo to the frontend public folder if it doesn't exist
cp -rn /tmp/img/* /opt/app/frontend/public/img

# Initialize database if needed
echo "Checking database initialization..."
cd /opt/app/backend

# Check if database exists and has tables
if ! sqlite3 ../data/pingvin-share.db ".tables" 2>/dev/null | grep -q "Config"; then
  echo "Database not initialized. Setting up database..."
  
  # Create database directory if it doesn't exist
  mkdir -p ../data
  
  # Initialize database schema
  echo "Running database migrations..."
  npx prisma db push --accept-data-loss
  
  # Seed initial configuration
  echo "Seeding initial configuration..."
  npx tsx prisma/seed/config.seed.ts || echo "Seed completed"
  
  echo "Database initialization completed!"
else
  echo "Database already initialized."
fi

# Start the backend server
echo "Starting backend server..."
npm run start:prod &
BACKEND_PID=$!
cd /opt/app

# Wait for backend to be ready
echo "Waiting for backend to be ready..."
timeout=60
while [ $timeout -gt 0 ]; do
  if curl -sf http://localhost:8080/api/health > /dev/null 2>&1; then
    echo "Backend is ready!"
    break
  fi
  echo "Backend not ready yet, waiting... ($timeout seconds remaining)"
  sleep 2
  timeout=$((timeout - 2))
done

if [ $timeout -le 0 ]; then
  echo "Backend failed to start within 60 seconds"
  exit 1
fi

if [ "$CADDY_DISABLED" != "true" ]; then
  # Start Caddy
  echo "Starting Caddy..."
  if [ "$TRUST_PROXY" = "true" ]; then
    caddy start --adapter caddyfile --config /opt/app/reverse-proxy/Caddyfile.trust-proxy &
  else
    caddy start --adapter caddyfile --config /opt/app/reverse-proxy/Caddyfile &
  fi
else
  echo "Caddy is disabled. Skipping..."
fi

# Run the frontend server
echo "Starting frontend server..."
cd /opt/app/frontend

# Check if server.js exists
if [ ! -f "server.js" ]; then
  echo "ERROR: server.js not found in /opt/app/frontend"
  ls -la /opt/app/frontend/
  exit 1
fi

PORT=3333 HOSTNAME=0.0.0.0 node server.js &
FRONTEND_PID=$!

# Wait a moment for frontend to start
sleep 3

# Check if frontend process is still running
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
  echo "ERROR: Frontend process died immediately"
  exit 1
fi

echo "All services started successfully! 🚀"
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"

# Monitor processes and restart if needed
while true; do
  if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "ERROR: Backend process died"
    exit 1
  fi
  
  if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "ERROR: Frontend process died"
    exit 1
  fi
  
  sleep 10
done
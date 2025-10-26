#!/bin/bash

# Green Releaf METRC Sync System - Production Startup Script
# This script sets up and starts the application and scheduler in production

echo "🚀 Starting Green Releaf METRC Sync System..."
echo "=============================================="

# Create logs directory if it doesn't exist
mkdir -p logs

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2 process manager..."
    npm install -g pm2
fi

# Check if we're in production environment
if [ "$NODE_ENV" != "production" ]; then
    echo "⚠️  Warning: NODE_ENV is not set to 'production'"
    echo "   Setting NODE_ENV=production for this session"
    export NODE_ENV=production
fi

echo "📊 Environment: $NODE_ENV"
echo "🕐 Timezone: $(date)"
echo ""

# Stop any existing PM2 processes
echo "🛑 Stopping existing processes..."
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true

# Start the application and scheduler
echo "🚀 Starting application and scheduler..."
pm2 start ecosystem.config.js

# Show status
echo ""
echo "📊 Process Status:"
pm2 status

echo ""
echo "📋 Available Commands:"
echo "  pm2 status          - Check process status"
echo "  pm2 logs            - View all logs"
echo "  pm2 logs metrc-scheduler - View scheduler logs"
echo "  pm2 logs green-releaf-app - View app logs"
echo "  pm2 restart all     - Restart all processes"
echo "  pm2 stop all         - Stop all processes"
echo "  pm2 delete all       - Delete all processes"

echo ""
echo "✅ Green Releaf METRC Sync System is now running!"
echo "🌐 Application: http://localhost:3000"
echo "⏰ Scheduler: Running METRC sync jobs during business hours (8 AM - 6 PM EST, Mon-Fri)"

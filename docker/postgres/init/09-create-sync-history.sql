-- Create sync_history table for tracking all sync operations
CREATE TABLE IF NOT EXISTS sync_history (
    id SERIAL PRIMARY KEY,
    license_number VARCHAR(50) NOT NULL,
    sync_type VARCHAR(100) NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'started',
    -- 'started', 'completed', 'failed'
    user_id INTEGER REFERENCES users(id),
    script_name VARCHAR(255),
    duration_ms INTEGER,
    script_output TEXT,
    script_error_output TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sync_history_sync_type ON sync_history(sync_type);
CREATE INDEX IF NOT EXISTS idx_sync_history_status ON sync_history(status);
CREATE INDEX IF NOT EXISTS idx_sync_history_start_time ON sync_history(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_sync_history_license ON sync_history(license_number);
CREATE INDEX IF NOT EXISTS idx_sync_history_script_name ON sync_history(script_name);

-- Create index for filtering completed/failed syncs
CREATE INDEX IF NOT EXISTS idx_sync_history_status_completed_failed 
    ON sync_history(start_time DESC) 
    WHERE status IN ('completed', 'failed');


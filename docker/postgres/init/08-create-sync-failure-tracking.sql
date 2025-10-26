-- Create sync failure tracking table
CREATE TABLE IF NOT EXISTS sync_failure_tracking (
    id SERIAL PRIMARY KEY,
    script_name VARCHAR(255) NOT NULL,
    license_number VARCHAR(50) NOT NULL,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_failure_time TIMESTAMP WITH TIME ZONE,
    last_success_time TIMESTAMP WITH TIME ZONE,
    last_error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one record per script per license
    UNIQUE(script_name, license_number)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sync_failure_tracking_script ON sync_failure_tracking(script_name);
CREATE INDEX IF NOT EXISTS idx_sync_failure_tracking_license ON sync_failure_tracking(license_number);
CREATE INDEX IF NOT EXISTS idx_sync_failure_tracking_failures ON sync_failure_tracking(consecutive_failures);
CREATE INDEX IF NOT EXISTS idx_sync_failure_tracking_last_failure ON sync_failure_tracking(last_failure_time);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sync_failure_tracking_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sync_failure_tracking_updated_at
    BEFORE UPDATE ON sync_failure_tracking
    FOR EACH ROW
    EXECUTE FUNCTION update_sync_failure_tracking_updated_at();

-- Insert initial tracking records for all sync scripts
INSERT INTO sync_failure_tracking (script_name, license_number, consecutive_failures)
VALUES 
    ('sync-outgoing-transfers', 'CUL000063', 0),
    ('sync-active-packages', 'CUL000063', 0),
    ('sync-transferred-packages', 'CUL000063', 0),
    ('sync-intransit-packages', 'CUL000063', 0),
    ('sync-items', 'CUL000063', 0),
    ('sync-strains', 'CUL000063', 0)
ON CONFLICT (script_name, license_number) DO NOTHING;

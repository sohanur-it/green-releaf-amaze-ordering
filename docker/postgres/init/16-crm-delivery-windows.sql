-- CRM Delivery Windows & Zones
-- Adds delivery zone tracking and delivery window management for buyer locations
-- This enables Module 5 to validate delivery times and filter by delivery zones

-- =====================================================
-- 1. Add Delivery Zone to Buyer Locations
-- =====================================================

ALTER TABLE "ORDERS-buyer_locations"
    ADD COLUMN IF NOT EXISTS delivery_zone VARCHAR(100);

COMMENT ON COLUMN "ORDERS-buyer_locations".delivery_zone IS 'Internal tracking field for delivery zone assignment. Used for filtering and sorting in fulfillment queue.';

-- Create index for delivery zone filtering
CREATE INDEX IF NOT EXISTS idx_buyer_locations_delivery_zone 
    ON "ORDERS-buyer_locations"(delivery_zone) 
    WHERE delivery_zone IS NOT NULL;

-- =====================================================
-- 2. Create Delivery Windows Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-location_delivery_windows" (
    id SERIAL PRIMARY KEY,
    fk_location_id INTEGER NOT NULL REFERENCES "ORDERS-buyer_locations"(entry_id) ON DELETE CASCADE,
    days_of_week INTEGER[] NOT NULL, -- Array of day numbers: 0=Sunday, 1=Monday, ..., 6=Saturday
    start_time TIME NOT NULL, -- e.g., '08:00:00' for 8am
    end_time TIME NOT NULL, -- e.g., '21:00:00' for 9pm
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0, -- For ordering multiple windows (lower = higher priority)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Validation: end_time must be after start_time
    CONSTRAINT chk_delivery_window_time CHECK (end_time > start_time),
    
    -- Validation: days_of_week array must not be empty
    -- Day range validation (0-6) will be handled at application level
    CONSTRAINT chk_delivery_window_days CHECK (
        array_length(days_of_week, 1) > 0
    )
);

COMMENT ON TABLE "ORDERS-location_delivery_windows" IS 'Stores delivery time windows for buyer locations. Supports multiple windows per location (e.g., Mon-Fri 8am-9pm, Sat-Sun 7am-11pm). Used by Module 5 to validate estimated arrival times.';
COMMENT ON COLUMN "ORDERS-location_delivery_windows".days_of_week IS 'Array of day numbers: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday';
COMMENT ON COLUMN "ORDERS-location_delivery_windows".start_time IS 'Start time for this delivery window (local time)';
COMMENT ON COLUMN "ORDERS-location_delivery_windows".end_time IS 'End time for this delivery window (local time)';
COMMENT ON COLUMN "ORDERS-location_delivery_windows".is_active IS 'Whether this window is currently active. Inactive windows are ignored during validation.';
COMMENT ON COLUMN "ORDERS-location_delivery_windows".sort_order IS 'Ordering for multiple windows. Lower numbers appear first.';

-- =====================================================
-- 3. Create Indexes for Performance
-- =====================================================

-- Index for finding windows by location
CREATE INDEX IF NOT EXISTS idx_delivery_windows_location 
    ON "ORDERS-location_delivery_windows"(fk_location_id, is_active);

-- Index for finding active windows (used in validation queries)
CREATE INDEX IF NOT EXISTS idx_delivery_windows_active 
    ON "ORDERS-location_delivery_windows"(is_active, fk_location_id) 
    WHERE is_active = true;

-- GIN index for array searches (finding windows by day of week)
CREATE INDEX IF NOT EXISTS idx_delivery_windows_days_gin 
    ON "ORDERS-location_delivery_windows" USING GIN(days_of_week);

-- =====================================================
-- 4. Helper Function: Check if DateTime Falls Within Any Active Window
-- =====================================================

CREATE OR REPLACE FUNCTION check_delivery_window(
    p_location_id INTEGER,
    p_delivery_datetime TIMESTAMPTZ
) RETURNS TABLE(
    is_valid BOOLEAN,
    matching_window_id INTEGER,
    window_start_time TIME,
    window_end_time TIME,
    days_of_week INTEGER[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        true AS is_valid,
        w.id AS matching_window_id,
        w.start_time AS window_start_time,
        w.end_time AS window_end_time,
        w.days_of_week
    FROM "ORDERS-location_delivery_windows" w
    WHERE w.fk_location_id = p_location_id
        AND w.is_active = true
        AND (
            -- Check if the day of week matches
            EXTRACT(DOW FROM p_delivery_datetime)::INTEGER = ANY(w.days_of_week)
        )
        AND (
            -- Check if time falls within window (normal case: start <= time <= end)
            (w.end_time >= w.start_time 
             AND p_delivery_datetime::TIME >= w.start_time 
             AND p_delivery_datetime::TIME <= w.end_time)
            OR
            -- Handle overnight windows (e.g., 22:00-02:00 where end < start)
            (w.end_time < w.start_time 
             AND (p_delivery_datetime::TIME >= w.start_time 
                  OR p_delivery_datetime::TIME <= w.end_time))
        )
    ORDER BY w.sort_order ASC
    LIMIT 1;
    
    -- If no rows returned, return a single row with is_valid = false
    IF NOT FOUND THEN
        RETURN QUERY SELECT 
            false AS is_valid,
            NULL::INTEGER AS matching_window_id,
            NULL::TIME AS window_start_time,
            NULL::TIME AS window_end_time,
            NULL::INTEGER[] AS days_of_week;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_delivery_window IS 'Checks if a delivery datetime falls within any active delivery window for a location. Returns validation result and matching window details.';

-- =====================================================
-- 5. Helper Function: Get All Active Windows for Location
-- =====================================================

CREATE OR REPLACE FUNCTION get_location_delivery_windows(
    p_location_id INTEGER
) RETURNS TABLE(
    id INTEGER,
    days_of_week INTEGER[],
    start_time TIME,
    end_time TIME,
    is_active BOOLEAN,
    sort_order INTEGER,
    days_display TEXT -- Human-readable days (e.g., "Mon-Fri")
) AS $$
BEGIN
    RETURN QUERY
    WITH window_days AS (
        SELECT 
            w.id,
            w.days_of_week,
            w.start_time,
            w.end_time,
            w.is_active,
            w.sort_order,
            -- Convert days array to readable text
            CASE 
                WHEN w.days_of_week = ARRAY[1,2,3,4,5] THEN 'Mon-Fri'
                WHEN w.days_of_week = ARRAY[0,6] THEN 'Sat-Sun'
                WHEN w.days_of_week = ARRAY[0,1,2,3,4,5,6] THEN 'Every Day'
                WHEN w.days_of_week = ARRAY[1] THEN 'Monday'
                WHEN w.days_of_week = ARRAY[2] THEN 'Tuesday'
                WHEN w.days_of_week = ARRAY[3] THEN 'Wednesday'
                WHEN w.days_of_week = ARRAY[4] THEN 'Thursday'
                WHEN w.days_of_week = ARRAY[5] THEN 'Friday'
                WHEN w.days_of_week = ARRAY[6] THEN 'Saturday'
                WHEN w.days_of_week = ARRAY[0] THEN 'Sunday'
                ELSE NULL -- Will be handled below
            END AS simple_display,
            w.days_of_week AS days_array
        FROM "ORDERS-location_delivery_windows" w
        WHERE w.fk_location_id = p_location_id
    )
    SELECT 
        wd.id,
        wd.days_of_week,
        wd.start_time,
        wd.end_time,
        wd.is_active,
        wd.sort_order,
        COALESCE(
            wd.simple_display,
            array_to_string(
                ARRAY(
                    SELECT CASE d
                        WHEN 0 THEN 'Sun'
                        WHEN 1 THEN 'Mon'
                        WHEN 2 THEN 'Tue'
                        WHEN 3 THEN 'Wed'
                        WHEN 4 THEN 'Thu'
                        WHEN 5 THEN 'Fri'
                        WHEN 6 THEN 'Sat'
                        ELSE 'Unknown'
                    END
                    FROM unnest(wd.days_array) AS d
                    ORDER BY d
                ), 
                ', '
            )
        ) AS days_display
    FROM window_days wd
    ORDER BY wd.sort_order ASC, wd.start_time ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_location_delivery_windows IS 'Returns all delivery windows for a location with human-readable day display.';


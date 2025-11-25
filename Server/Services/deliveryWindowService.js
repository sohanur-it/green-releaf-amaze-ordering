// Server/Services/deliveryWindowService.js
// Service for managing delivery windows and zones for buyer locations

const { query, pool } = require('../config/database');

class DeliveryWindowService {
    /**
     * Get all delivery windows for a location
     */
    async getLocationWindows(locationId) {
        try {
            const result = await query(`
                SELECT * FROM get_location_delivery_windows($1)
                ORDER BY sort_order ASC, start_time ASC
            `, [locationId]);
            return result.rows;
        } catch (error) {
            console.error(`Error getting delivery windows for location ${locationId}:`, error);
            throw error;
        }
    }

    /**
     * Check if a delivery datetime falls within any active window for a location
     * Returns validation result and matching window details
     */
    async validateDeliveryTime(locationId, deliveryDateTime) {
        try {
            const result = await query(`
                SELECT * FROM check_delivery_window($1, $2)
            `, [locationId, deliveryDateTime]);
            
            if (result.rows.length === 0) {
                return {
                    isValid: false,
                    matchingWindow: null,
                    message: 'No delivery windows found for this location'
                };
            }

            const validation = result.rows[0];
            return {
                isValid: validation.is_valid,
                matchingWindow: validation.is_valid ? {
                    id: validation.matching_window_id,
                    startTime: validation.window_start_time,
                    endTime: validation.window_end_time,
                    daysOfWeek: validation.days_of_week
                } : null,
                message: validation.is_valid 
                    ? 'Delivery time is within an active delivery window'
                    : 'Delivery time falls outside all active delivery windows'
            };
        } catch (error) {
            console.error(`Error validating delivery time for location ${locationId}:`, error);
            throw error;
        }
    }

    /**
     * Create a new delivery window for a location
     */
    async createWindow(locationId, windowData) {
        const { daysOfWeek, startTime, endTime, isActive = true, sortOrder = 0 } = windowData;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Validate days of week (must be 0-6)
            const invalidDays = daysOfWeek.filter(day => day < 0 || day > 6);
            if (invalidDays.length > 0) {
                throw new Error(`Invalid day numbers: ${invalidDays.join(', ')}. Days must be 0-6 (0=Sunday, 6=Saturday)`);
            }

            // Validate time range
            if (startTime >= endTime && !this.isOvernightWindow(startTime, endTime)) {
                throw new Error('End time must be after start time (unless overnight window)');
            }

            const result = await client.query(`
                INSERT INTO "ORDERS-location_delivery_windows"
                (fk_location_id, days_of_week, start_time, end_time, is_active, sort_order, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                RETURNING *
            `, [locationId, daysOfWeek, startTime, endTime, isActive, sortOrder]);

            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`Error creating delivery window for location ${locationId}:`, error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update an existing delivery window
     */
    async updateWindow(windowId, windowData) {
        const { daysOfWeek, startTime, endTime, isActive, sortOrder } = windowData;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const updates = [];
            const values = [];
            let paramCount = 1;

            if (daysOfWeek !== undefined) {
                // Validate days of week
                const invalidDays = daysOfWeek.filter(day => day < 0 || day > 6);
                if (invalidDays.length > 0) {
                    throw new Error(`Invalid day numbers: ${invalidDays.join(', ')}. Days must be 0-6`);
                }
                updates.push(`days_of_week = $${paramCount++}`);
                values.push(daysOfWeek);
            }

            if (startTime !== undefined) {
                updates.push(`start_time = $${paramCount++}`);
                values.push(startTime);
            }

            if (endTime !== undefined) {
                updates.push(`end_time = $${paramCount++}`);
                values.push(endTime);
            }

            if (isActive !== undefined) {
                updates.push(`is_active = $${paramCount++}`);
                values.push(isActive);
            }

            if (sortOrder !== undefined) {
                updates.push(`sort_order = $${paramCount++}`);
                values.push(sortOrder);
            }

            if (updates.length === 0) {
                throw new Error('No fields to update');
            }

            updates.push(`updated_at = NOW()`);
            values.push(windowId);

            const result = await client.query(`
                UPDATE "ORDERS-location_delivery_windows"
                SET ${updates.join(', ')}
                WHERE id = $${paramCount}
                RETURNING *
            `, values);

            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`Error updating delivery window ${windowId}:`, error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Delete a delivery window
     */
    async deleteWindow(windowId) {
        try {
            const result = await query(`
                DELETE FROM "ORDERS-location_delivery_windows"
                WHERE id = $1
                RETURNING id
            `, [windowId]);
            return result.rows[0];
        } catch (error) {
            console.error(`Error deleting delivery window ${windowId}:`, error);
            throw error;
        }
    }

    /**
     * Get delivery zone for a location
     */
    async getDeliveryZone(locationId) {
        try {
            const result = await query(`
                SELECT delivery_zone
                FROM "ORDERS-buyer_locations"
                WHERE entry_id = $1
            `, [locationId]);
            return result.rows[0]?.delivery_zone || null;
        } catch (error) {
            console.error(`Error getting delivery zone for location ${locationId}:`, error);
            throw error;
        }
    }

    /**
     * Get all unique delivery zones (for filtering)
     */
    async getAllDeliveryZones() {
        try {
            const result = await query(`
                SELECT DISTINCT delivery_zone
                FROM "ORDERS-buyer_locations"
                WHERE delivery_zone IS NOT NULL
                ORDER BY delivery_zone ASC
            `);
            return result.rows.map(row => row.delivery_zone);
        } catch (error) {
            console.error('Error getting all delivery zones:', error);
            throw error;
        }
    }

    /**
     * Helper: Check if a window is overnight (e.g., 22:00-02:00)
     */
    isOvernightWindow(startTime, endTime) {
        // Simple check: if end < start, it's likely overnight
        // But we'll let the database constraint handle validation
        return false; // We don't need special handling here
    }
}

module.exports = new DeliveryWindowService();



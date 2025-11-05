/**
 * Deal Flow Automation Service
 * 
 * Automatically updates buyer deal flow stages based on invoice activity:
 * - Active: Invoice in last 30 days
 * - Warm: Invoice in 30-60 day range
 * - Cold: No activity in 60+ days
 */

const { query } = require('../config/database');
const { Pool } = require('pg');
const path = require('path');

class DealFlowAutomationService {
    constructor() {
        // Determine environment
        const nodeEnv = process.env.NODE_ENV || 'development';
        let envPath;

        if (nodeEnv === 'production') {
            envPath = path.join(__dirname, '../../config/production.env');
        } else {
            envPath = path.join(__dirname, '../../config/local.env');
        }

        // Load environment variables
        require('dotenv').config({ path: envPath });

        const isDevelopment = nodeEnv !== 'production';

        this.pool = new Pool({
            user: process.env.DB_USER || 'postgres',
            host: process.env.DB_HOST || 'localhost',
            database: process.env.DB_DATABASE || 'green_releaf_dev',
            password: process.env.DB_PASSWORD || 'postgres',
            port: parseInt(process.env.DB_PORT, 10) || 5432,
            ...(isDevelopment ? {} : {
                ssl: { rejectUnauthorized: false }
            })
        });
    }

    /**
     * Get or create deal flow stages
     * Returns map of stage names to entry_id
     */
    async getDealFlowStages() {
        try {
            // Check if Active/Warm/Cold stages exist
            const stages = await query(`
                SELECT entry_id, name
                FROM "ORDERS-deal_flows"
                WHERE name IN ('Active', 'Warm', 'Cold')
            `);

            const stageMap = {};
            stages.rows.forEach(stage => {
                stageMap[stage.name] = stage.entry_id;
            });

            // Create missing stages
            if (!stageMap['Active']) {
                const active = await query(`
                    INSERT INTO "ORDERS-deal_flows" (name, description)
                    VALUES ('Active', 'Buyer has invoice activity in the last 30 days')
                    RETURNING entry_id
                `);
                stageMap['Active'] = active.rows[0].entry_id;
            }

            if (!stageMap['Warm']) {
                const warm = await query(`
                    INSERT INTO "ORDERS-deal_flows" (name, description)
                    VALUES ('Warm', 'Buyer has invoice activity in the 30-60 day range')
                    RETURNING entry_id
                `);
                stageMap['Warm'] = warm.rows[0].entry_id;
            }

            if (!stageMap['Cold']) {
                const cold = await query(`
                    INSERT INTO "ORDERS-deal_flows" (name, description)
                    VALUES ('Cold', 'Buyer has no invoice activity in the last 60+ days')
                    RETURNING entry_id
                `);
                stageMap['Cold'] = cold.rows[0].entry_id;
            }

            return stageMap;
        } catch (error) {
            console.error('Error getting deal flow stages:', error);
            throw error;
        }
    }

    /**
     * Calculate days since last paid invoice
     * @param {number} buyerId - Buyer ID
     * @returns {number|null} - Days since last paid invoice, or null if no paid invoices
     */
    async getDaysSinceLastInvoice(buyerId, client = null) {
        const queryFunc = client ? client.query.bind(client) : query;

        try {
            const result = await queryFunc(`
                SELECT MAX(paid_at) as last_paid_date
                FROM "ORDERS-invoices"
                WHERE fk_buyer_id = $1
                  AND status = 'Paid'
                  AND paid_at IS NOT NULL
            `, [buyerId]);

            if (result.rows.length === 0 || !result.rows[0].last_paid_date) {
                return null; // No paid invoices
            }

            const lastPaidDate = new Date(result.rows[0].last_paid_date);
            const now = new Date();
            const diffTime = now - lastPaidDate;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            return diffDays;
        } catch (error) {
            console.error(`Error calculating days since last invoice for buyer ${buyerId}:`, error);
            return null;
        }
    }

    /**
     * Determine deal flow stage based on days since last invoice
     * @param {number|null} daysSince - Days since last paid invoice
     * @returns {string} - 'Active', 'Warm', or 'Cold'
     */
    determineStage(daysSince) {
        if (daysSince === null) {
            return 'Cold'; // No paid invoices = Cold
        }

        if (daysSince <= 30) {
            return 'Active';
        } else if (daysSince <= 60) {
            return 'Warm';
        } else {
            return 'Cold';
        }
    }

    /**
     * Update buyer's deal flow stage
     * @param {number} buyerId - Buyer ID
     * @param {Object} client - Optional database client (for transactions)
     * @returns {Object} - { success, old_stage, new_stage, days_since }
     */
    async updateBuyerDealFlowStage(buyerId, client = null) {
        const queryFunc = client ? client.query.bind(client) : query;
        const shouldCommit = !client;

        if (!client) {
            client = await this.pool.connect();
            await client.query('BEGIN');
        }

        try {
            // Get current deal flow
            const current = await queryFunc(`
                SELECT fk_deal_flow_id, df.name as deal_flow_name
                FROM "ORDERS-buyers" b
                LEFT JOIN "ORDERS-deal_flows" df ON b.fk_deal_flow_id = df.entry_id
                WHERE b.entry_id = $1
            `, [buyerId]);

            if (current.rows.length === 0) {
                if (shouldCommit) await client.query('ROLLBACK');
                return { success: false, error: 'Buyer not found' };
            }

            const oldStageName = current.rows[0].deal_flow_name || null;

            // Calculate days since last invoice
            const daysSince = await this.getDaysSinceLastInvoice(buyerId, client);
            const newStageName = this.determineStage(daysSince);

            // Get stage IDs
            const stages = await this.getDealFlowStages();
            const newStageId = stages[newStageName];

            // Only update if stage changed
            if (oldStageName !== newStageName) {
                await queryFunc(`
                    UPDATE "ORDERS-buyers"
                    SET fk_deal_flow_id = $1,
                        updated_at = NOW()
                    WHERE entry_id = $2
                `, [newStageId, buyerId]);

                console.log(`✅ Updated buyer ${buyerId}: ${oldStageName || 'None'} → ${newStageName} (${daysSince !== null ? daysSince + ' days' : 'no invoices'})`);

                if (shouldCommit) await client.query('COMMIT');

                return {
                    success: true,
                    buyer_id: buyerId,
                    old_stage: oldStageName,
                    new_stage: newStageName,
                    days_since: daysSince,
                    changed: true
                };
            } else {
                if (shouldCommit) await client.query('COMMIT');

                return {
                    success: true,
                    buyer_id: buyerId,
                    old_stage: oldStageName,
                    new_stage: newStageName,
                    days_since: daysSince,
                    changed: false
                };
            }
        } catch (error) {
            if (shouldCommit) await client.query('ROLLBACK');
            console.error(`Error updating deal flow stage for buyer ${buyerId}:`, error);
            throw error;
        } finally {
            if (shouldCommit) client.release();
        }
    }

    /**
     * Update deal flow stage for a buyer after invoice payment
     * Called from invoice state machine when invoice reaches 'Paid'
     * @param {number} buyerId - Buyer ID
     * @param {Object} client - Database client (from transaction)
     */
    async updateAfterPayment(buyerId, client) {
        try {
            const result = await this.updateBuyerDealFlowStage(buyerId, client);
            return result;
        } catch (error) {
            console.error('Error updating deal flow after payment:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Batch update all buyers' deal flow stages
     * Called by daily cron job at 2 AM
     * @returns {Object} - Summary of updates
     */
    async batchUpdateAllBuyers() {
        try {
            console.log('🔄 Starting batch deal flow stage update...');

            // Get all buyers
            const buyers = await query(`
                SELECT entry_id
                FROM "ORDERS-buyers"
                ORDER BY entry_id
            `);

            if (buyers.rows.length === 0) {
                return {
                    success: true,
                    total: 0,
                    updated: 0,
                    unchanged: 0,
                    errors: []
                };
            }

            console.log(`📊 Processing ${buyers.rows.length} buyers...`);

            let updated = 0;
            let unchanged = 0;
            const errors = [];

            for (const buyer of buyers.rows) {
                try {
                    const result = await this.updateBuyerDealFlowStage(buyer.entry_id);

                    if (result.success) {
                        if (result.changed) {
                            updated++;
                        } else {
                            unchanged++;
                        }
                    } else {
                        errors.push({
                            buyer_id: buyer.entry_id,
                            error: result.error
                        });
                    }
                } catch (error) {
                    errors.push({
                        buyer_id: buyer.entry_id,
                        error: error.message
                    });
                    console.error(`❌ Error processing buyer ${buyer.entry_id}:`, error.message);
                }
            }

            console.log(`✅ Batch update complete: ${updated} updated, ${unchanged} unchanged, ${errors.length} errors`);

            return {
                success: true,
                total: buyers.rows.length,
                updated,
                unchanged,
                errors: errors.length > 0 ? errors : undefined
            };
        } catch (error) {
            console.error('❌ Batch deal flow update failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new DealFlowAutomationService();


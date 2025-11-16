const discountBuilderService = require('../Services/discountBuilderService');
const { pool } = require('../config/database');
const { Pool } = require('pg');
const path = require('path');

class DiscountUiController {
    constructor() {
        this.fallbackPool = null;
        this.renderBuilder = this.renderBuilder.bind(this);
        this.renderAssignments = this.renderAssignments.bind(this);
    }

    async #getClient() {
        try {
            return await pool.connect();
        } catch (error) {
            console.warn('[discounts] Primary DB connection failed, attempting production fallback:', error.message);
            if (!this.fallbackPool) {
                const prodEnvPath = path.join(__dirname, '../../config/production.env');
                require('dotenv').config({ path: prodEnvPath });
                this.fallbackPool = new Pool({
                    user: process.env.DB_USER,
                    host: process.env.DB_HOST,
                    database: process.env.DB_DATABASE,
                    password: process.env.DB_PASSWORD,
                    port: parseInt(process.env.DB_PORT, 10),
                    ssl: { rejectUnauthorized: false }
                });
            }
            return await this.fallbackPool.connect();
        }
    }

    async renderBuilder(req, res) {
        let schemaMissing = true;
        let connectionError = null;

        try {
            schemaMissing = !(await this.#isSchemaReady());
            console.log('[discounts] schemaMissing?', schemaMissing);
        } catch (error) {
            console.error('[discounts] schema check failed:', error);
            connectionError = error;
        }

        let buyers = [];
        let discounts = [];
        let categories = [];
        let products = [];

        if (!schemaMissing && !connectionError) {
            try {
                [buyers, discounts, categories, products] = await Promise.all([
                    this.#fetchBuyerOptions(),
                    discountBuilderService.listDiscountCodes(),
                    this.#fetchCategories(),
                    this.#fetchProductOptions()
                ]);
            } catch (error) {
                console.error('[discounts] failed loading builder data:', error);
                connectionError = error;
            }
        } else if (schemaMissing) {
            console.warn('[discounts] Discount tables missing in current environment. Skipping queries.');
        }

        res.render('admin/discounts/index', {
            title: 'Discount Builder',
            layout: 'layouts/main',
            mode: 'builder',
            discounts,
            buyers,
            schemaMissing,
            categories,
            products,
            connectionError: connectionError ? connectionError.message : null,
            hideSidebar: true
        });
    }

    async renderAssignments(req, res) {
        let schemaMissing = true;
        let connectionError = null;

        try {
            schemaMissing = !(await this.#isSchemaReady());
            console.log('[discounts] (assignments) schemaMissing?', schemaMissing);
        } catch (error) {
            console.error('[discounts] schema check failed (assignments):', error);
            connectionError = error;
        }

        let buyers = [];
        let discounts = [];
        let categories = [];
        let products = [];

        if (!schemaMissing && !connectionError) {
            try {
                [buyers, discounts, categories, products] = await Promise.all([
                    this.#fetchBuyerOptions(),
                    discountBuilderService.listDiscountCodes(),
                    this.#fetchCategories(),
                    this.#fetchProductOptions()
                ]);
            } catch (error) {
                console.error('[discounts] failed loading assignment data:', error);
                connectionError = error;
            }
        } else if (schemaMissing) {
            console.warn('[discounts] Discount tables missing in current environment. Skipping queries (assignments).');
        }

        res.render('admin/discounts/index', {
            title: 'Buyer Discount Assignments',
            layout: 'layouts/main',
            mode: 'assignments',
            discounts,
            buyers,
            schemaMissing,
            categories,
            products,
            connectionError: connectionError ? connectionError.message : null,
            hideSidebar: true
        });
    }

    async #fetchBuyerOptions() {
        const client = await this.#getClient();
        try {
            const result = await client.query(`
                SELECT entry_id, name
                FROM "ORDERS-buyers"
                ORDER BY name ASC
                LIMIT 500
            `);
            return result.rows;
        } finally {
            client.release();
        }
    }

    async #fetchCategories() {
        const client = await this.#getClient();
        try {
            const result = await client.query(`
                SELECT DISTINCT category_name
                FROM "ORDERS-products"
                WHERE category_name IS NOT NULL
                ORDER BY category_name ASC
            `);
            return result.rows.map((row) => row.category_name);
        } finally {
            client.release();
        }
    }

    async #fetchProductOptions() {
        const client = await this.#getClient();
        try {
            const result = await client.query(`
                SELECT entry_id AS product_id, name
                FROM "ORDERS-products"
                ORDER BY name ASC
                LIMIT 200
            `);
            return result.rows;
        } finally {
            client.release();
        }
    }

    async #isSchemaReady() {
        const client = await this.#getClient();
        try {
            const result = await client.query(`
            SELECT 
                to_regclass('"ORDERS-discount-codes"') AS codes,
                to_regclass('"ORDERS-discount-rules"') AS rules,
                to_regclass('"ORDERS-discount-buyer-assignments"') AS assignments
        `);
        const row = result.rows[0] || {};
        return !!(row.codes && row.rules && row.assignments);
        } finally {
            client.release();
        }
    }
}

module.exports = new DiscountUiController();


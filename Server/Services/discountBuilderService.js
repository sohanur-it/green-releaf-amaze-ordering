const { query } = require('../config/database');

class DiscountBuilderService {
    async listDiscountCodes() {
        const result = await query(`
            SELECT 
                dc.*,
                COALESCE(rule_counts.rule_count, 0) AS rule_count
            FROM "ORDERS-discount-codes" dc
            LEFT JOIN (
                SELECT fk_discount_id, COUNT(*) AS rule_count
                FROM "ORDERS-discount-rules"
                GROUP BY fk_discount_id
            ) rule_counts ON rule_counts.fk_discount_id = dc.id
            ORDER BY dc.created_at DESC
        `);
        return result.rows;
    }

    async getDiscountCodeById(discountId) {
        const codeResult = await query(`
            SELECT * FROM "ORDERS-discount-codes" WHERE id = $1
        `, [discountId]);
        if (codeResult.rows.length === 0) {
            return null;
        }
        const code = codeResult.rows[0];
        const rulesResult = await query(`
            SELECT *
            FROM "ORDERS-discount-rules"
            WHERE fk_discount_id = $1
            ORDER BY created_at ASC
        `, [discountId]);
        const conflictsResult = await query(`
            SELECT fk_conflicting_discount_id
            FROM "ORDERS-discount-conflicts"
            WHERE fk_discount_id = $1
        `, [discountId]);
        code.rules = rulesResult.rows;
        code.conflicts = conflictsResult.rows.map((row) => row.fk_conflicting_discount_id);
        return code;
    }

    async createDiscountCode(payload, userId) {
        const result = await query(`
            INSERT INTO "ORDERS-discount-codes" (
                display_name,
                code_name,
                internal_notes,
                stacking_behavior,
                minimum_quantity,
                is_active,
                created_by,
                updated_by
            ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, true), $7, $7)
            RETURNING *
        `, [
            payload.display_name,
            payload.code_name,
            payload.internal_notes || null,
            payload.stacking_behavior || 'Current_Price',
            payload.minimum_quantity || null,
            payload.is_active,
            userId
        ]);
        return result.rows[0];
    }

    async updateDiscountCode(discountId, payload, userId) {
        const result = await query(`
            UPDATE "ORDERS-discount-codes"
            SET 
                display_name = COALESCE($2, display_name),
                code_name = COALESCE($3, code_name),
                internal_notes = $4,
                stacking_behavior = COALESCE($5, stacking_behavior),
                minimum_quantity = $6,
                is_active = COALESCE($7, is_active),
                updated_by = $8,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `, [
            discountId,
            payload.display_name || null,
            payload.code_name || null,
            payload.internal_notes || null,
            payload.stacking_behavior || null,
            payload.minimum_quantity || null,
            payload.is_active,
            userId
        ]);
        return result.rows[0];
    }

    async deleteDiscountCode(discountId) {
        await query(`DELETE FROM "ORDERS-discount-codes" WHERE id = $1`, [discountId]);
    }

    async addRule(discountId, payload) {
        const result = await query(`
            INSERT INTO "ORDERS-discount-rules" (
                fk_discount_id,
                applies_to,
                category_name,
                fk_master_product_id,
                action,
                value,
                metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [
            discountId,
            payload.applies_to,
            payload.category_name || null,
            payload.fk_master_product_id || null,
            payload.action,
            payload.value,
            payload.metadata || null
        ]);
        return result.rows[0];
    }

    async updateRule(ruleId, payload) {
        const result = await query(`
            UPDATE "ORDERS-discount-rules"
            SET 
                applies_to = COALESCE($2, applies_to),
                category_name = $3,
                fk_master_product_id = $4,
                action = COALESCE($5, action),
                value = COALESCE($6, value),
                metadata = $7,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `, [
            ruleId,
            payload.applies_to || null,
            payload.category_name || null,
            payload.fk_master_product_id || null,
            payload.action || null,
            payload.value || null,
            payload.metadata || null
        ]);
        return result.rows[0];
    }

    async deleteRule(ruleId) {
        await query(`DELETE FROM "ORDERS-discount-rules" WHERE id = $1`, [ruleId]);
    }

    async updateConflicts(discountId, conflictIds = []) {
        await query(`DELETE FROM "ORDERS-discount-conflicts" WHERE fk_discount_id = $1`, [discountId]);
        if (!conflictIds.length) return;
        const values = conflictIds
            .filter((conflictId) => Number.isInteger(conflictId))
            .map((conflictId) => `(${discountId}, ${conflictId})`);
        if (!values.length) return;
        await query(`
            INSERT INTO "ORDERS-discount-conflicts" (fk_discount_id, fk_conflicting_discount_id)
            VALUES ${values.join(', ')}
            ON CONFLICT DO NOTHING
        `);
    }

    async getBuyerAssignments(buyerId) {
        const result = await query(`
            SELECT 
                assignments.*,
                codes.display_name,
                codes.code_name,
                codes.stacking_behavior
            FROM "ORDERS-discount-buyer-assignments" assignments
            INNER JOIN "ORDERS-discount-codes" codes ON codes.id = assignments.fk_discount_id
            WHERE assignments.fk_buyer_id = $1
            ORDER BY assignments.priority ASC
        `, [buyerId]);
        return result.rows;
    }

    async assignDiscountToBuyer(buyerId, discountId, userId) {
        const priorityResult = await query(`
            SELECT COALESCE(MAX(priority), 0) + 1 AS next_priority
            FROM "ORDERS-discount-buyer-assignments"
            WHERE fk_buyer_id = $1
        `, [buyerId]);
        const nextPriority = priorityResult.rows[0].next_priority || 1;
        const result = await query(`
            INSERT INTO "ORDERS-discount-buyer-assignments" (
                fk_buyer_id,
                fk_discount_id,
                priority,
                is_active,
                assigned_by
            ) VALUES ($1, $2, $3, true, $4)
            ON CONFLICT (fk_buyer_id, fk_discount_id) DO UPDATE
            SET is_active = true,
                priority = LEAST("ORDERS-discount-buyer-assignments".priority, $3)
            RETURNING *
        `, [buyerId, discountId, nextPriority, userId]);
        return result.rows[0];
    }

    async reorderAssignments(buyerId, ordering = []) {
        await query('BEGIN');
        try {
            for (let i = 0; i < ordering.length; i++) {
                const assignmentId = ordering[i];
                await query(`
                    UPDATE "ORDERS-discount-buyer-assignments"
                    SET priority = $1
                    WHERE id = $2 AND fk_buyer_id = $3
                `, [i + 1, assignmentId, buyerId]);
            }
            await query('COMMIT');
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    }

    async removeAssignment(assignmentId) {
        await query(`
            DELETE FROM "ORDERS-discount-buyer-assignments"
            WHERE id = $1
        `, [assignmentId]);
    }

    /**
     * Simplified pricing simulator.
     * payload: { buyerId?, discountIds?, cartItems: [{product_id, category_name, unit_price, quantity}] }
     */
    async simulatePricing(payload) {
        const items = payload.cartItems || [];
        if (!items.length) {
            return {
                subtotal: 0,
                totalDiscounts: 0,
                grandTotal: 0,
                breakdown: [],
                notes: []
            };
        }

        let discountsInPlay = [];
        if (payload.discountIds?.length) {
            const placeholders = payload.discountIds.map((_, idx) => `$${idx + 1}`).join(', ');
            const result = await query(`
                SELECT * FROM "ORDERS-discount-codes"
                WHERE id IN (${placeholders})
                ORDER BY created_at ASC
            `, payload.discountIds);
            discountsInPlay = await Promise.all(result.rows.map(async (code) => {
                const rules = await query(`
                    SELECT * FROM "ORDERS-discount-rules"
                    WHERE fk_discount_id = $1
                    ORDER BY created_at ASC
                `, [code.id]);
                code.rules = rules.rows;
                return code;
            }));
        } else if (payload.buyerId) {
            const assignments = await this.getBuyerAssignments(payload.buyerId);
            for (const assignment of assignments) {
                const code = await this.getDiscountCodeById(assignment.fk_discount_id);
                if (code) {
                    code.priority = assignment.priority;
                    discountsInPlay.push(code);
                }
            }
            discountsInPlay.sort((a, b) => (a.priority || 0) - (b.priority || 0));
        }

        if (!discountsInPlay.length) {
            const subtotal = items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
            return { subtotal, totalDiscounts: 0, grandTotal: subtotal, breakdown: [] };
        }

        let breakdown = [];
        let globalNotes = [];
        const workingItems = items.map(item => ({
            ...item,
            original_total: item.unit_price * item.quantity,
            running_total: item.unit_price * item.quantity,
            discounts: [],
            _notes: [],
            _specificityAddedProduct: false,
            _specificityAddedCategory: false,
            _specificityAddedEntire: false
        }));

        for (const discount of discountsInPlay) {
            const conflictIds = Array.isArray(discount.conflicts) ? discount.conflicts.map(Number) : [];
            for (const rule of discount.rules) {
                if (!rule) continue;
                for (const item of workingItems) {
                    // If this discount conflicts with any discount already applied to this item, skip
                    if (conflictIds.length) {
                        const alreadyAppliedIds = (item.discounts || []).map(d => Number(d.discount_id));
                        const hasConflict = alreadyAppliedIds.some(id => conflictIds.includes(id));
                        if (hasConflict) {
                            continue;
                        }
                    }
                    // Specificity: if a Specific_Product rule applies, ignore Entire_Order and Specific_Category for that item
                    const productRuleApplies = rule.applies_to === 'Specific_Product' && this.#ruleApplies(rule, item);
                    if (productRuleApplies) {
                        // mark note for this item
                        if (!item._specificityAddedProduct) {
                            item._notes.push('💡 Specificity: Product-specific discount');
                            item._specificityAddedProduct = true;
                        }
                        // apply product rule and skip others for that item within this loop
                    } else {
                        // If any existing product-specific discount already applied to this item, skip non-product rules
                        const hasProductSpecific = item.discounts.some(d => d.rule_applies_to === 'Specific_Product');
                        if (hasProductSpecific && rule.applies_to !== 'Specific_Product') {
                            continue;
                        }
                        // If category rule applies, note specificity and allow; later global rules are ignored
                        const categoryRuleApplies = rule.applies_to === 'Specific_Category' && this.#ruleApplies(rule, item);
                        if (categoryRuleApplies && !item._specificityAddedCategory) {
                            item._notes.push('💡 Specificity: Category-specific discount');
                            item._specificityAddedCategory = true;
                        }
                        // If category-specific already applied, skip Entire_Order rules
                        const hasCategorySpecific = item.discounts.some(d => d.rule_applies_to === 'Specific_Category');
                        if (hasCategorySpecific && rule.applies_to === 'Entire_Order') {
                            continue;
                        }
                        // Entire order specificity (only if no more specific already noted)
                        if (rule.applies_to === 'Entire_Order' && !item._specificityAddedEntire && !item._specificityAddedProduct && !item._specificityAddedCategory && this.#ruleApplies(rule, item)) {
                            item._notes.push('💡 Specificity: Entire-order discount');
                            item._specificityAddedEntire = true;
                        }
                        if (!this.#ruleApplies(rule, item)) continue;
                    }
                    const before = item.running_total;
                    const after = this.#applyRule(discount, rule, item);
                    if (after < before) {
                        const diff = before - after;
                        item.running_total = after;
                        const desc = this.#formatDiscountLine(discount, rule, before, diff, after);
                        item.discounts.push({
                            discount_id: discount.id,
                            rule_id: rule.id,
                            rule_applies_to: rule.applies_to,
                            amount: diff,
                            description: desc
                        });
                        item._notes.push(desc);
                    }
                }
            }
            breakdown.push({
                discount_id: discount.id,
                discount_name: discount.display_name,
                stacking_behavior: discount.stacking_behavior,
                applied_amount: workingItems.reduce((sum, item) => {
                    const d = item.discounts.filter(x => x.discount_id === discount.id);
                    return sum + d.reduce((dsum, entry) => dsum + entry.amount, 0);
                }, 0)
            });
        }

        const subtotal = workingItems.reduce((sum, item) => sum + item.original_total, 0);
        const totalDiscounts = workingItems.reduce((sum, item) => sum + (item.original_total - item.running_total), 0);
        const grandTotal = subtotal - totalDiscounts;

        // Build human-friendly breakdown notes per item
        const itemNotes = [];
        for (const wi of workingItems) {
            if ((wi.discounts || []).length > 0) {
                const finalUnit = wi.quantity ? (wi.running_total / wi.quantity) : wi.running_total;
                const lines = [...wi._notes];
                lines.push(`Final: $${finalUnit.toFixed(2)} × ${wi.quantity} units = $${wi.running_total.toFixed(2)}`);
                itemNotes.push({
                    product_name: wi.name || wi.product_name || `Product ${wi.product_id || ''}`,
                    base_unit_price: (wi.original_total / wi.quantity),
                    notes: lines
                });
            }
        }

        return {
            subtotal,
            totalDiscounts,
            grandTotal,
            items: workingItems,
            breakdown,
            notes: Array.from(new Set(globalNotes)),
            itemNotes
        };
    }

    #ruleApplies(rule, item) {
        switch (rule.applies_to) {
            case 'Entire_Order':
                return true;
            case 'Specific_Category':
                return !!item.category_name && !!rule.category_name &&
                    item.category_name.toLowerCase() === rule.category_name.toLowerCase();
            case 'Specific_Product':
                return item.product_id && rule.fk_master_product_id &&
                    Number(item.product_id) === Number(rule.fk_master_product_id);
            default:
                return false;
        }
    }

    #applyRule(discount, rule, item) {
        const minQty = discount.minimum_quantity || 0;
        if (minQty && item.quantity < minQty) {
            return item.running_total;
        }

        const base = discount.stacking_behavior === 'Best_Price'
            ? item.original_total
            : item.running_total;

        let newTotal = base;
        if (rule.action === 'Percentage_Off') {
            const reduction = (base * parseFloat(rule.value || 0)) / 100;
            newTotal = Math.max(0, base - reduction);
        } else if (rule.action === 'Fixed_Amount_Off') {
            const reduction = parseFloat(rule.value || 0) * item.quantity;
            newTotal = Math.max(0, base - reduction);
        } else if (rule.action === 'Set_Fixed_Price') {
            const unitPrice = parseFloat(rule.value || 0);
            newTotal = unitPrice * item.quantity;
        }

        if (discount.stacking_behavior === 'Best_Price') {
            return Math.min(item.running_total, newTotal);
        }
        return Math.min(item.running_total, newTotal);
    }

    #formatDiscountLine(discount, rule, before, diff, after) {
        // Example: Lee Test: -5% (from current) = -$1.50 → $28.50
        const name = discount.display_name || `Discount ${discount.id}`;
        let actionText = '';
        if (rule.action === 'Percentage_Off') {
            actionText = `-${parseFloat(rule.value || 0)}% (from current)`;
        } else if (rule.action === 'Fixed_Amount_Off') {
            actionText = `-$${parseFloat(rule.value || 0).toFixed(2)} (per unit)`;
        } else if (rule.action === 'Set_Fixed_Price') {
            actionText = `set price $${parseFloat(rule.value || 0).toFixed(2)}`;
        } else {
            actionText = rule.action;
        }
        return `${name}: ${actionText} = -$${diff.toFixed(2)} → $${after.toFixed(2)}`;
    }

    /**
     * Apply discount builder discounts to invoice line items
     * @param {number} invoiceId - Invoice ID
     * @param {number} buyerId - Buyer ID
     * @param {object} client - Optional database client for transaction
     */
    async applyDiscountsToInvoice(invoiceId, buyerId, client = null) {
        const queryFunc = client ? client.query.bind(client) : query;
        
        try {
            // Get all line items for this invoice
            const lineItemsResult = await queryFunc(`
                SELECT 
                    li.id,
                    li.fk_master_product_id,
                    li.quantity_ordered as quantity,
                    li.unit_price,
                    li.line_total,
                    p.category_name
                FROM "ORDERS-invoice-line-items" li
                INNER JOIN "ORDERS-products" p ON li.fk_master_product_id = p.entry_id
                WHERE li.fk_invoice_id = $1
                ORDER BY li.line_item_order
            `, [invoiceId]);

            if (lineItemsResult.rows.length === 0) {
                return { success: true, applied: 0 };
            }

            // Prepare cart items for pricing simulation
            const cartItems = lineItemsResult.rows.map(li => ({
                product_id: li.fk_master_product_id,
                category_name: li.category_name || null,
                unit_price: parseFloat(li.unit_price || 0),
                quantity: parseInt(li.quantity || 0, 10)
            }));

            // Simulate pricing to get discounted totals
            const pricingResult = await this.simulatePricing({ buyerId, cartItems });

            if (!pricingResult.items || pricingResult.items.length === 0) {
                return { success: true, applied: 0 };
            }

            // Map product_id to discounted item (for pricing calculation)
            const discountedMap = new Map();
            pricingResult.items.forEach(item => {
                discountedMap.set(Number(item.product_id), item);
            });

            // Update each line item with discounted totals
            // Note: We need to calculate the discount proportionally if there are multiple line items
            // for the same product (e.g., different batches or added separately)
            let totalDiscountsApplied = 0;
            
            // Group line items by product_id to calculate proportional discounts
            const lineItemsByProduct = new Map();
            for (const lineItem of lineItemsResult.rows) {
                const productId = Number(lineItem.fk_master_product_id);
                if (!lineItemsByProduct.has(productId)) {
                    lineItemsByProduct.set(productId, []);
                }
                lineItemsByProduct.get(productId).push(lineItem);
            }

            // Apply discounts proportionally to all line items for each product
            for (const [productId, lineItems] of lineItemsByProduct.entries()) {
                const discounted = discountedMap.get(productId);
                if (!discounted) {
                    // No discount for this product, skip
                    continue;
                }

                // Calculate total original value for all line items of this product
                const totalOriginalValue = lineItems.reduce((sum, li) => {
                    return sum + (parseFloat(li.unit_price) * parseInt(li.quantity, 10));
                }, 0);

                // Get the discounted total from pricing simulation
                const discountedTotal = parseFloat(discounted.running_total || totalOriginalValue);
                const totalDiscountAmount = totalOriginalValue - discountedTotal;

                if (totalDiscountAmount > 0 && totalOriginalValue > 0) {
                    // Apply discount proportionally to each line item
                    for (const lineItem of lineItems) {
                        const originalLineTotal = parseFloat(lineItem.unit_price) * parseInt(lineItem.quantity, 10);
                        const lineDiscountAmount = (originalLineTotal / totalOriginalValue) * totalDiscountAmount;
                        const discountedLineTotal = originalLineTotal - lineDiscountAmount;

                        await queryFunc(`
                            UPDATE "ORDERS-invoice-line-items"
                            SET 
                                line_discount_amount = $1,
                                line_total = $2,
                                updated_at = NOW()
                            WHERE id = $3
                        `, [lineDiscountAmount, discountedLineTotal, lineItem.id]);
                        totalDiscountsApplied += lineDiscountAmount;
                    }
                }
            }

            // Recalculate invoice totals using discountService
            const discountService = require('./discountService');
            await discountService.recalculateInvoiceTotals(invoiceId, client);

            return { 
                success: true, 
                applied: totalDiscountsApplied,
                totalDiscounts: pricingResult.totalDiscounts
            };
        } catch (error) {
            console.error('Error applying discount builder discounts to invoice:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new DiscountBuilderService();


(() => {
    console.log('[discounts] bootstrap init');
    const appData = window.DISCOUNT_APP_DATA || { mode: 'builder', discounts: [], buyers: [] };
    const flashBox = document.getElementById('discountFlash');
    let flashTimer = null;
    const discountModal = document.getElementById('discountModal');
    const newDiscountForm = document.getElementById('newDiscountForm');
    const ruleModal = document.getElementById('ruleModal');
    const ruleForm = document.getElementById('ruleForm');
    const state = {
        mode: appData.mode,
        discounts: appData.discounts || [],
        buyers: appData.buyers || [],
        selectedDiscount: null,
        selectedBuyerId: null,
        simCart: [],
        assignmentCart: [],
        deleteArmed: false,
        ruleModalDiscount: null
    };

    const flash = (type, message) => {
        if (!flashBox) {
            console[type === 'error' ? 'error' : 'log']('[discounts]', message);
            return;
        }
        flashBox.className = `inline-flash inline-flash--${type}`;
        flashBox.textContent = message;
        flashBox.style.display = 'block';
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => {
            flashBox.style.display = 'none';
        }, 4500);
    };

    const openModal = (modal) => {
        if (!modal) return;
        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.classList.add('active'));
        document.body.classList.add('modal-open');
    };

    const closeModal = (modal) => {
        if (!modal) return;
        modal.classList.remove('active');
        setTimeout(() => {
            modal.style.display = 'none';
            if (!document.querySelector('.modal-overlay.active')) {
                document.body.classList.remove('modal-open');
            }
        }, 200);
    };

    document.addEventListener('click', (event) => {
        if (event.target?.matches?.('[data-close-modal]')) {
            closeModal(event.target.closest('.modal-overlay'));
        }
        if (event.target?.classList?.contains('modal-overlay')) {
            closeModal(event.target);
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        console.log('[discounts] DOM ready, mode:', state.mode, 'schemaMissing:', appData.schemaMissing, 'connectionError:', appData.connectionError);
        if (appData.schemaMissing || appData.connectionError) {
            console.warn('[discounts] Initialization skipped due to schema/connection flag.');
            return;
        }
        document.getElementById('discountThemeToggle')?.addEventListener('click', () => {
            const html = document.documentElement;
            const isDark = html.classList.contains('dark-theme');
            const next = isDark ? 'light' : 'dark';
            if (window.applyTheme) window.applyTheme(next);
            if (window.updateThemeIcon) window.updateThemeIcon(next);
            localStorage.setItem('theme', next);
        });
        if (state.mode === 'builder') {
            initBuilderMode();
        } else {
            initAssignmentMode();
        }
    });

    /** Builder Mode **/
    function initBuilderMode() {
        console.log('[discounts] init builder mode');
        renderDiscountList();
        document.getElementById('discountSearch')?.addEventListener('input', renderDiscountList);
        document.getElementById('createDiscountBtn')?.addEventListener('click', () => {
            newDiscountForm?.reset();
            if (newDiscountForm) {
                newDiscountForm.is_active.value = 'true';
            }
            openModal(discountModal);
        });
        newDiscountForm?.addEventListener('submit', submitNewDiscount);
        ruleForm?.addEventListener('submit', submitRule);
        const ruleApplies = document.getElementById('ruleAppliesTo');
        ruleApplies?.addEventListener('change', handleRuleAppliesChange);
        populateRuleDropdowns();
        document.getElementById('saveDiscountBtn')?.addEventListener('click', saveDiscount);
        document.getElementById('deleteDiscountBtn')?.addEventListener('click', deleteDiscount);
        document.getElementById('addRuleBtn')?.addEventListener('click', openRuleModal);
        document.getElementById('saveConflictsBtn')?.addEventListener('click', saveConflicts);
        document.getElementById('discountActiveToggle')?.addEventListener('change', (e) => {
            if (state.selectedDiscount) {
                state.selectedDiscount.is_active = e.target.checked;
            }
            const txt = document.getElementById('activeStatusText');
            if (txt) {
                txt.textContent = e.target.checked ? 'Active' : 'Inactive';
            }
        });
        document.getElementById('fillSampleCart')?.addEventListener('click', () => {
            state.simCart = getSampleCart();
            renderSimCart('simCart', state.simCart);
            // auto-run simulation after filling sample items
            triggerSimulateDebounced();
        });
        document.getElementById('clearCartBtn')?.addEventListener('click', () => {
            state.simCart = [];
            renderSimCart('simCart', state.simCart);
        });
        // When a buyer is selected, load their real products (do not auto-fill cart or auto-run)
        document.getElementById('simBuyerSelect')?.addEventListener('change', async (e) => {
            const buyerId = parseInt(e.target.value, 10) || null;
            state.selectedBuyerId = buyerId;
            if (buyerId) {
                await loadBuyerProductsForBuilder(buyerId);
                // no auto-run
            } else {
                // reset
                state.simCart = [];
                renderSimCart('simCart', state.simCart);
                updateTotals({ subtotal: 0, totalDiscounts: 0, grandTotal: 0, breakdown: [] }, {
                    subtotalId: 'subtotalDisplay',
                    discountId: 'discountDisplay',
                    totalId: 'grandTotalDisplay',
                    breakdownId: 'calcBreakdown'
                });
            }
        });
        // Manual add item flow
        document.getElementById('addItemBtn')?.addEventListener('click', openAddItemModal);
        document.getElementById('addItemForm')?.addEventListener('submit', onAddItemSubmit);
        document.getElementById('simRefreshBtn')?.addEventListener('click', refreshSimulatorData);
    }

    function renderDiscountList() {
        const listEl = document.getElementById('discountList');
        if (!listEl) return;
        const search = (document.getElementById('discountSearch')?.value || '').toLowerCase();
        const items = state.discounts.filter((discount) =>
            discount.display_name.toLowerCase().includes(search) ||
            discount.code_name.toLowerCase().includes(search)
        );
        if (!items.length) {
            listEl.innerHTML = '<li class="empty-state">No discounts found.</li>';
            return;
        }
        listEl.innerHTML = items.map(discount => {
            const ruleCount = typeof discount.rule_count === 'number'
                ? `${discount.rule_count} ${discount.rule_count === 1 ? 'rule' : 'rules'}`
                : '';
            const isActive = discount.is_active !== false;
            const hasConflicts = Array.isArray(discount.conflicts) && discount.conflicts.length > 0;
            return `
                <li class="discount-list-item ${state.selectedDiscount?.id === discount.id ? 'active' : ''}"
                    data-discount-id="${discount.id}">
                    <div class="dl-item-main">
                        <div class="dl-item-title">${escapeHtml(discount.code_name)}</div>
                        <div class="dl-item-sub">${escapeHtml(discount.display_name || '')}</div>
                        <div class="dl-item-status">
                            <span class="status-dot ${isActive ? 'active' : 'inactive'}"></span> ${isActive ? 'Active' : 'Inactive'}
                            ${hasConflicts ? `<span class="no-stack-badge" title="Cannot stack with selected discounts">No Stack</span>` : ''}
                        </div>
                    </div>
                    <div class="dl-item-meta">${ruleCount}</div>
                </li>
            `;
        }).join('');
        listEl.querySelectorAll('[data-discount-id]').forEach((node) => {
            node.addEventListener('click', () => loadDiscountDetails(parseInt(node.dataset.discountId, 10)));
        });
    }

    async function loadDiscountDetails(id) {
        try {
            const response = await fetch(`/api/v1/discounts/codes/${id}`);
            const data = await response.json();
            if (!data.success) throw new Error(data.error || 'Unable to load discount');
            state.selectedDiscount = data.discount;
            populateForm(state.selectedDiscount);
            populateRules(state.selectedDiscount.rules || []);
            populateConflicts(state.selectedDiscount);
            renderDiscountList();
        } catch (error) {
            console.error(error);
            flash('error', 'Failed to load discount details.');
        }
    }

    function populateForm(discount) {
        const form = document.getElementById('discountForm');
        if (!form || !discount) return;
        form.display_name.value = discount.display_name || '';
        form.code_name.value = discount.code_name || '';
        form.internal_notes.value = discount.internal_notes || '';
        form.stacking_behavior.value = discount.stacking_behavior || 'Current_Price';
        form.minimum_quantity.value = discount.minimum_quantity || '';
        const toggle = document.getElementById('discountActiveToggle');
        if (toggle) toggle.checked = discount.is_active !== false;
        const txt = document.getElementById('activeStatusText');
        if (txt) {
            txt.textContent = (discount.is_active !== false) ? 'Active' : 'Inactive';
        }
        document.getElementById('editorTitle').textContent = discount.display_name || 'Editor';
        // auto-generate slug when display_name changes (only if code_name untouched)
        form.display_name.oninput = () => {
            const currentCode = form.code_name.value.trim();
            const slugged = slugify(form.display_name.value);
            if (!state.selectedDiscount || (currentCode === '' || currentCode === state.selectedDiscount.code_name)) {
                form.code_name.value = slugged;
            }
        };
    }

    function populateRules(rules) {
        const container = document.getElementById('ruleList');
        if (!container) return;
        if (!rules.length) {
            container.classList.add('empty-state');
            container.textContent = 'No rules defined. Click "Add Rule Group" to create one.';
            return;
        }
        container.classList.remove('empty-state');
        container.innerHTML = rules.map((rule, idx) => {
            const idxLabel = `Rule ${idx + 1}`;
            const applies = rule.applies_to.replace(/_/g, ' ');
            const action = rule.action.replace(/_/g, ' ');
            let ifLine = 'IF: Any Product';
            if (rule.applies_to === 'Specific_Category') {
                ifLine = `IF: ${rule.category_name || 'Category'}`;
            } else if (rule.applies_to === 'Specific_Product') {
                ifLine = `IF: ${rule.product_name || `Product #${rule.fk_master_product_id}`}`;
            }
            const thenLine = `THEN: ${action === 'Percentage Off' ? `${parseFloat(rule.value)}% off` : action === 'Fixed Amount Off' ? `$${parseFloat(rule.value).toFixed(2)} off` : `Set price $${parseFloat(rule.value).toFixed(2)}`}`;
            return `
            <div class="rule-group" data-rule-id="${rule.id}">
                <div class="rule-header">
                    <div class="rule-header-title">${escapeHtml(idxLabel)}</div>
                    <button class="rule-delete" title="Delete rule" data-delete-rule="${rule.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="rule-body">
                    <div class="rule-if">${escapeHtml(ifLine)}</div>
                    <div class="rule-then">${escapeHtml(thenLine)}</div>
                </div>
            </div>`;
        }).join('');
        container.querySelectorAll('[data-delete-rule]').forEach((btn) => {
            btn.addEventListener('click', () => deleteRule(parseInt(btn.dataset.deleteRule, 10)));
        });
    }

    function populateConflicts(discount) {
        const select = document.getElementById('conflictSelect');
        if (!select) return;
        select.innerHTML = state.discounts
            .filter((d) => d.id !== discount.id)
            .map((d) => `<option value="${d.id}">${d.display_name}</option>`)
            .join('');
        (discount.conflicts || []).forEach((conflictId) => {
            const option = select.querySelector(`option[value="${conflictId}"]`);
            if (option) option.selected = true;
        });
    }

    async function submitNewDiscount(event) {
        event.preventDefault();
        setGlobalLoading(true);
        const payload = Object.fromEntries(new FormData(newDiscountForm).entries());
        payload.minimum_quantity = payload.minimum_quantity ? parseInt(payload.minimum_quantity, 10) : null;
        payload.is_active = payload.is_active !== 'false';
        try {
            const res = await fetch('/api/v1/discounts/codes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to create discount');
            state.discounts.unshift(data.discount);
            renderDiscountList();
            closeModal(discountModal);
            flash('success', 'Discount created successfully.');
            await loadDiscountDetails(data.discount.id);
        } catch (error) {
            console.error(error);
            flash('error', error.message || 'Failed to create discount');
        } finally {
            setGlobalLoading(false);
        }
    }

    async function saveDiscount() {
        if (!state.selectedDiscount) {
            flash('error', 'Select a discount to save.');
            return;
        }
        setGlobalLoading(true);
        const form = document.getElementById('discountForm');
        const payload = {
            display_name: form.display_name.value,
            code_name: form.code_name.value,
            internal_notes: form.internal_notes.value,
            stacking_behavior: form.stacking_behavior.value,
            minimum_quantity: form.minimum_quantity.value ? parseInt(form.minimum_quantity.value, 10) : null,
            is_active: document.getElementById('discountActiveToggle').checked
        };
        try {
            const res = await fetch(`/api/v1/discounts/codes/${state.selectedDiscount.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            state.selectedDiscount = data.discount;
            const idx = state.discounts.findIndex((d) => d.id === data.discount.id);
            if (idx >= 0) state.discounts[idx] = data.discount;
            renderDiscountList();
            flash('success', 'Discount saved.');
        } catch (error) {
            console.error(error);
            flash('error', error.message || 'Failed to save discount');
        } finally {
            setGlobalLoading(false);
        }
    }

    async function deleteDiscount() {
        if (!state.selectedDiscount) {
            flash('error', 'Select a discount first.');
            return;
        }
        if (!state.deleteArmed) {
            state.deleteArmed = true;
            flash('info', 'Click delete again within 3s to confirm.');
            setTimeout(() => {
                state.deleteArmed = false;
            }, 3000);
            return;
        }
        state.deleteArmed = false;
        setGlobalLoading(true);
        try {
            const res = await fetch(`/api/v1/discounts/codes/${state.selectedDiscount.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            state.discounts = state.discounts.filter((d) => d.id !== state.selectedDiscount.id);
            state.selectedDiscount = null;
            renderDiscountList();
            document.getElementById('discountForm').reset();
            document.getElementById('ruleList').textContent = 'Select a discount to view rules.';
            flash('success', 'Discount deleted.');
        } catch (error) {
            console.error(error);
            flash('error', error.message || 'Failed to delete discount');
        } finally {
            setGlobalLoading(false);
        }
    }

    function openRuleModal() {
        if (!state.selectedDiscount) {
            flash('error', 'Select a discount first.');
            return;
        }
        state.ruleModalDiscount = state.selectedDiscount.id;
        ruleForm?.reset();
        document.getElementById('ruleDiscountId').value = state.selectedDiscount.id;
        openModal(ruleModal);
    }

    function handleRuleAppliesChange(event) {
        const value = event.target.value;
        document.getElementById('ruleCategoryField').style.display = value === 'Specific_Category' ? 'block' : 'none';
        document.getElementById('ruleProductField').style.display = value === 'Specific_Product' ? 'block' : 'none';
    }

    async function populateRuleDropdowns() {
        const categorySelect = document.querySelector('#ruleCategoryField select');
        const productSelect = document.querySelector('#ruleProductField select');
        if (categorySelect) {
            const categories = appData.categories || [];
            categorySelect.innerHTML = '<option value="">Select category…</option>' + categories.map((cat) => `<option value="${cat}">${cat}</option>`).join('');
        }
        if (productSelect) {
            const products = appData.products || [];
            productSelect.innerHTML = '<option value="">Select product…</option>' + products.map((product) => `<option value="${product.product_id}">${product.name || product.product_id}</option>`).join('');
        }
    }

    async function submitRule(event) {
        event.preventDefault();
        setGlobalLoading(true);
        if (!state.ruleModalDiscount || !state.selectedDiscount) {
            flash('error', 'Select a discount before adding rules.');
            setGlobalLoading(false);
            return;
        }
        const formData = new FormData(ruleForm);
        const payload = Object.fromEntries(formData.entries());
        payload.value = parseFloat(payload.value);
        payload.discount_id = state.ruleModalDiscount;
        if (Number.isNaN(payload.value)) {
            flash('error', 'Rule value must be a number.');
            return;
        }
        if (payload.category_name === '') {
            payload.category_name = null;
        }
        if (payload.fk_master_product_id) {
            const parsed = parseInt(payload.fk_master_product_id, 10);
            if (Number.isNaN(parsed)) {
                flash('error', 'Product ID must be a number.');
                return;
            }
            payload.fk_master_product_id = parsed;
        } else {
            payload.fk_master_product_id = null;
        }
        if (payload.metadata) {
            try {
                payload.metadata = JSON.parse(payload.metadata);
            } catch (err) {
                flash('error', 'Metadata must be valid JSON.');
                return;
            }
        } else {
            payload.metadata = null;
        }
        try {
            const res = await fetch(`/api/v1/discounts/codes/${payload.discount_id}/rules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            state.selectedDiscount.rules = state.selectedDiscount.rules || [];
            state.selectedDiscount.rules.push(data.rule);
            populateRules(state.selectedDiscount.rules);
            closeModal(ruleModal);
            flash('success', 'Rule added.');
        } catch (error) {
            console.error(error);
            flash('error', error.message || 'Failed to add rule');
        } finally {
            setGlobalLoading(false);
        }
    }

    async function deleteRule(ruleId) {
        if (!confirm('Delete this rule?')) return;
        try {
            const res = await fetch(`/api/v1/discounts/rules/${ruleId}`, { method: 'DELETE' });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            state.selectedDiscount.rules = (state.selectedDiscount.rules || []).filter((r) => r.id !== ruleId);
            populateRules(state.selectedDiscount.rules);
        } catch (error) {
            console.error(error);
            flash('error', error.message || 'Failed to delete rule');
        }
    }

    async function saveConflicts() {
        if (!state.selectedDiscount) return flash('error', 'Select a discount first.');
        setGlobalLoading(true);
        const select = document.getElementById('conflictSelect');
        const conflicts = Array.from(select?.selectedOptions || []).map((option) => parseInt(option.value, 10));
        try {
            const res = await fetch(`/api/v1/discounts/codes/${state.selectedDiscount.id}/conflicts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conflicts })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            flash('success', 'Conflicts updated.');
        } catch (error) {
            console.error(error);
            flash('error', error.message || 'Failed to save conflicts');
        } finally {
            setGlobalLoading(false);
        }
    }

    async function runBuilderSimulation() {
        // Use buyer assignments if a buyer is selected; otherwise fall back to single selected discount
        const usingBuyerAssignments = !!state.selectedBuyerId;
        if (!usingBuyerAssignments && !state.selectedDiscount) {
            flash('error', 'Select a buyer (preferred) or select a discount.');
            return;
        }
        if (!state.simCart.length) {
            flash('error', 'Add at least one cart item.');
            return;
        }
        try {
            const res = await fetch('/api/v1/discounts/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(usingBuyerAssignments ? {
                    buyerId: state.selectedBuyerId,
                    cartItems: state.simCart
                } : {
                    discountIds: [state.selectedDiscount.id],
                    cartItems: state.simCart
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            updateTotals(data.result, {
                subtotalId: 'subtotalDisplay',
                discountId: 'discountDisplay',
                totalId: 'grandTotalDisplay',
                breakdownId: 'calcBreakdown'
            });
            renderCalcNotes(data.result, 'calcBreakdown');
        } catch (error) {
            console.error(error);
            flash('error', error.message || 'Simulation failed');
        }
    }

    /** Assignment Mode **/
    function initAssignmentMode() {
        renderBuyerList();
        document.getElementById('buyerSearch')?.addEventListener('input', renderBuyerList);
        document.getElementById('assignDiscountBtn')?.addEventListener('click', assignDiscountToBuyer);
        document.getElementById('assignmentSimulateBtn')?.addEventListener('click', runAssignmentSimulation);
        document.getElementById('assignmentSampleCart')?.addEventListener('click', () => {
            state.assignmentCart = getSampleCart();
            renderSimCart('assignmentCart', state.assignmentCart);
        });
        document.getElementById('assignmentBuyerSelect')?.addEventListener('change', (e) => {
            state.selectedBuyerId = parseInt(e.target.value, 10) || null;
            if (state.selectedBuyerId) {
                loadBuyerProducts(state.selectedBuyerId);
            }
        });
    }

    function setGlobalLoading(isLoading) {
        const el = document.getElementById('discountGlobalLoading');
        if (!el) return;
        el.style.display = isLoading ? 'flex' : 'none';
    }

    function renderBuyerList() {
        const listEl = document.getElementById('buyerList');
        if (!listEl) return;
        const search = (document.getElementById('buyerSearch')?.value || '').toLowerCase();
        const buyers = state.buyers.filter((buyer) =>
            buyer.name.toLowerCase().includes(search)
        );
        if (!buyers.length) {
            listEl.innerHTML = '<li class="empty-state">No buyers found.</li>';
            return;
        }
        listEl.innerHTML = buyers.map((buyer) => `
            <li class="buyer-list-item ${state.selectedBuyerId === buyer.entry_id ? 'active' : ''}"
                data-buyer-id="${buyer.entry_id}">
                ${buyer.name}
            </li>
        `).join('');
        listEl.querySelectorAll('[data-buyer-id]').forEach((node) => {
            node.addEventListener('click', () => selectBuyer(parseInt(node.dataset.buyerId, 10)));
        });
    }

    async function selectBuyer(buyerId) {
        state.selectedBuyerId = buyerId;
        document.getElementById('assignmentBuyerSelect').value = buyerId;
        renderBuyerList();
        await loadBuyerAssignments(buyerId);
    }

    async function loadBuyerProducts(buyerId) {
        try {
            const res = await fetch(`/api/v1/discounts/buyers/${buyerId}/products?limit=50`);
            const data = await res.json();
            if (!data.success) return;
            // Replace Fill with Sample to use buyer products
            state.assignmentCart = (data.products || []).slice(0, 4).map((p, idx) => ({
                product_id: p.product_id,
                name: p.name,
                category_name: p.category_name || null,
                unit_price: parseFloat(p.unit_price || 0),
                quantity: [5, 8, 10, 15][idx] || 5
            }));
            renderSimCart('assignmentCart', state.assignmentCart);
        } catch (err) {
            console.warn('[discounts] could not load buyer products', err);
        }
    }

    async function loadBuyerAssignments(buyerId) {
        try {
            const res = await fetch(`/api/v1/discounts/buyers/${buyerId}/assignments`);
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            const container = document.getElementById('assignmentList');
            if (!container) return;
            const assignments = data.assignments || [];
            if (!assignments.length) {
                container.classList.add('empty-state');
                container.textContent = 'No discounts assigned yet.';
                return;
            }
            container.classList.remove('empty-state');
            container.innerHTML = assignments.map((assignment) => `
                <div class="assignment-card" data-assignment-id="${assignment.id}">
                    <div>
                        <strong>${assignment.display_name}</strong>
                        <div class="label-suffix">${assignment.code_name}</div>
                    </div>
                    <div class="assignment-actions">
                        <button class="btn btn-xs btn-outline-secondary" data-move="up">▲</button>
                        <button class="btn btn-xs btn-outline-secondary" data-move="down">▼</button>
                        <button class="btn btn-xs btn-outline-danger" data-remove="${assignment.id}">Remove</button>
                    </div>
                </div>
            `).join('');
            container.querySelectorAll('[data-remove]').forEach((btn) => {
                btn.addEventListener('click', () => removeAssignment(parseInt(btn.dataset.remove, 10)));
            });
            container.querySelectorAll('[data-move]').forEach((btn) => {
                btn.addEventListener('click', () => reorderAssignment(btn.closest('.assignment-card'), btn.dataset.move));
            });
        } catch (error) {
            console.error(error);
            flash('error', error.message || 'Failed to load assignments');
        }
    }

    async function assignDiscountToBuyer() {
        if (!state.selectedBuyerId) return flash('error', 'Select a buyer first.');
        const select = document.getElementById('assignDiscountSelect');
        const discountId = parseInt(select.value, 10);
        if (!discountId) return flash('error', 'Select a discount to assign.');
        try {
            const res = await fetch(`/api/v1/discounts/buyers/${state.selectedBuyerId}/assignments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ discount_id: discountId })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            await loadBuyerAssignments(state.selectedBuyerId);
            flash('success', 'Discount assigned.');
        } catch (error) {
            console.error(error);
            flash('error', error.message || 'Failed to assign discount');
        }
    }

    function reorderAssignment(card, direction) {
        const container = document.getElementById('assignmentList');
        if (!container || !card) return;
        if (direction === 'up' && card.previousElementSibling) {
            container.insertBefore(card, card.previousElementSibling);
        } else if (direction === 'down' && card.nextElementSibling) {
            container.insertBefore(card.nextElementSibling, card);
        }
        saveAssignmentOrdering();
    }

    async function saveAssignmentOrdering() {
        if (!state.selectedBuyerId) return;
        const ids = Array.from(document.querySelectorAll('#assignmentList [data-assignment-id]'))
            .map((node) => parseInt(node.dataset.assignmentId, 10));
        try {
            await fetch(`/api/v1/discounts/buyers/${state.selectedBuyerId}/assignments/reorder`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ordering: ids })
            });
        } catch (error) {
            console.error(error);
            flash('error', 'Failed to save ordering');
        }
    }

    async function removeAssignment(assignmentId) {
        if (!confirm('Remove this discount from buyer?')) return;
        try {
            const res = await fetch(`/api/v1/discounts/buyers/${state.selectedBuyerId}/assignments/${assignmentId}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            await loadBuyerAssignments(state.selectedBuyerId);
        } catch (error) {
            console.error(error);
            flash('error', error.message || 'Failed to remove assignment');
        }
    }

    async function runAssignmentSimulation() {
        if (!state.assignmentCart.length) {
            flash('error', 'Add sample cart items.');
            return;
        }
        const buyerId = state.selectedBuyerId || parseInt(document.getElementById('assignmentBuyerSelect').value, 10);
        if (!buyerId) {
            flash('error', 'Select a buyer.');
            return;
        }
        try {
            const res = await fetch('/api/v1/discounts/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    buyerId,
                    cartItems: state.assignmentCart
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            updateTotals(data.result, {
                subtotalId: 'assignmentSubtotal',
                discountId: 'assignmentDiscounts',
                totalId: 'assignmentGrandTotal',
                breakdownId: 'assignmentCalcBreakdown'
            });
            renderCalcNotes(data.result, 'assignmentCalcBreakdown');
        } catch (error) {
            console.error(error);
            flash('error', error.message || 'Simulation failed');
        }
    }

    /** Shared helpers **/
    function renderSimCart(elementId, cart) {
        const container = document.getElementById(elementId);
        if (!container) return;
        if (!cart.length) {
            container.classList.add('empty-state');
            container.textContent = 'Cart is empty';
            return;
        }
        container.classList.remove('empty-state');
        container.innerHTML = cart.map((item, idx) => `
            <div class="cart-row sim-cart-item" data-index="${idx}">
                <div class="item-info">
                    <strong>${escapeHtml(item.name || `Product ${item.product_id || ''}`)}</strong><br>
                    $${Number(item.unit_price || 0).toFixed(2)}/unit
                </div>
                <div class="item-actions">
                    <input type="number" min="1" class="qty-input" value="${Number(item.quantity || 1)}" />
                    <button class="remove-btn" title="Remove">×</button>
                </div>
            </div>
        `).join('');
        // Bind qty change and remove
        container.querySelectorAll('.qty-input').forEach((input) => {
            input.addEventListener('change', (e) => {
                const wrap = e.target.closest('.sim-cart-item');
                const index = parseInt(wrap?.dataset.index || '-1', 10);
                const val = Math.max(1, parseInt(e.target.value || '1', 10));
                if (index >= 0 && state.simCart[index]) {
                    state.simCart[index].quantity = val;
                }
                triggerSimulateDebounced();
            });
        });
        container.querySelectorAll('.remove-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const wrap = e.target.closest('.sim-cart-item');
                const index = parseInt(wrap?.dataset.index || '-1', 10);
                if (index >= 0) {
                    state.simCart.splice(index, 1);
                    renderSimCart(elementId, state.simCart);
                    triggerSimulateDebounced();
                }
            });
        });
    }

    function updateTotals(result, selectors) {
        document.getElementById(selectors.subtotalId).textContent = formatCurrency(result.subtotal);
        document.getElementById(selectors.discountId).textContent = `-${formatCurrency(result.totalDiscounts)}`;
        document.getElementById(selectors.totalId).textContent = formatCurrency(result.grandTotal);
        const container = document.getElementById(selectors.breakdownId);
        if (!container) return;
        // If we have rich notes from the simulator, render ONLY the styled block to match the spec
        if ((Array.isArray(result.itemNotes) && result.itemNotes.length) || (Array.isArray(result.notes) && result.notes.length)) {
            container.innerHTML = '';
            renderCalcNotes(result, selectors.breakdownId);
            return;
        }
        if (!result.breakdown?.length) {
            container.classList.add('empty-state');
            container.textContent = 'No discounts applied.';
            return;
        }
        container.classList.remove('empty-state');
        container.innerHTML = result.breakdown.map((entry) => `
            <div class="breakdown-row">
                <strong>${entry.discount_name}</strong>
                <span>${formatCurrency(entry.applied_amount)}</span>
            </div>
        `).join('');
    }

    function renderCalcNotes(result, breakdownId) {
        const container = document.getElementById(breakdownId);
        if (!container) return;
        // Reset any prior notes completely
        container.innerHTML = '';
        const makeBlock = (lines, titlePrefix = '', baseUnitPrice = null) => {
            const local = lines.slice();
            const block = document.createElement('div');
            block.className = 'calc-notes';
            let titleHtml = '';
            // Optional specificity title
            if (local[0] && /specificity/i.test(local[0])) {
                titleHtml = `<div class="calc-notes-title calc-note-line--hint">💡 ${escapeHtml(local.shift())}</div>`;
            }
            // Pull final line
            let finalIdx = local.findIndex((l) => /^final:/i.test(l.trim()));
            let finalLine = '';
            if (finalIdx >= 0) {
                finalLine = local.splice(finalIdx, 1)[0];
            }
            const bodyHtml = local.map((n) => `<div class="calc-note-line calc-note-line--discount">${escapeHtml(n)}</div>`).join('');
            let finalHtml = '';
            if (finalLine) {
                const afterColon = finalLine.split(/final:\s*/i)[1] || '';
                finalHtml = `<div class="calc-note-line calc-note-line--final">Final: <span class="calc-final-badge">${escapeHtml(afterColon.trim())}</span></div>`;
            }
            const header = titlePrefix ? `<div class="calc-notes-title">${escapeHtml(titlePrefix)}</div>` : '';
            const baseLine = baseUnitPrice != null ? `<div class="calc-note-line calc-note-line--base">Base Price: $${Number(baseUnitPrice).toFixed(2)}</div>` : '';
            block.innerHTML = `${header}${baseLine}${titleHtml}${bodyHtml}${finalHtml}`;
            return block;
        };
        // Prefer per-item notes; fall back to global notes
        if (Array.isArray(result.itemNotes) && result.itemNotes.length) {
            result.itemNotes.forEach((entry) => {
                const title = `${entry.product_name}`;
                container.appendChild(makeBlock(entry.notes || [], title, entry.base_unit_price));
            });
        } else if (Array.isArray(result.notes) && result.notes.length) {
            container.appendChild(makeBlock(result.notes || [], '', null));
        }
    }

    function getSampleCart() {
        return [
            { product_id: 101, name: 'Sample Flower 3.5g', category_name: 'Flower', unit_price: 30, quantity: 5 },
            { product_id: 205, name: 'Sample Edible 100mg', category_name: 'Edibles', unit_price: 20, quantity: 2 }
        ];
    }

    // Load real products for builder simulator when a buyer is selected (do not auto-fill cart)
    async function loadBuyerProductsForBuilder(buyerId) {
        try {
            const res = await fetch(`/api/v1/discounts/buyers/${buyerId}/products?limit=200`);
            const data = await res.json();
            if (!data.success) {
                flash('error', data.error || 'Failed to load buyer products');
                return;
            }
            const products = data.products || [];
            state.availableProducts = products;
            // populate add-item modal select if open
            const select = document.getElementById('addItemProductSelect');
            if (select) {
                select.innerHTML = '<option value="">Select a product…</option>' + products
                    .map(p => `<option value="${p.entry_id || p.product_id}" data-price="${p.default_price ?? p.unit_price ?? 0}" data-name="${escapeHtml(p.name || '')}" data-category="${escapeHtml(p.category_name || '')}">${escapeHtml(p.name || `Product ${p.entry_id || p.product_id}`)} - $${Number(p.default_price ?? p.unit_price ?? 0).toFixed(2)}</option>`)
                    .join('');
            }
        } catch (err) {
            console.error('[discounts] loadBuyerProductsForBuilder error', err);
            flash('error', 'Could not load products for buyer.');
        }
    }

    function openAddItemModal() {
        if (!state.selectedBuyerId) {
            flash('error', 'Select a buyer first.');
            return;
        }
        // ensure options present
        const products = state.availableProducts || [];
        if (!products.length) {
            flash('info', 'No products available for this buyer.');
        }
        const select = document.getElementById('addItemProductSelect');
        if (select && !select.options.length) {
            select.innerHTML = '<option value="">Select a product…</option>' + products
                .map(p => `<option value="${p.entry_id || p.product_id}" data-price="${p.default_price ?? p.unit_price ?? 0}" data-name="${escapeHtml(p.name || '')}" data-category="${escapeHtml(p.category_name || '')}">${escapeHtml(p.name || `Product ${p.entry_id || p.product_id}`)} - $${Number(p.default_price ?? p.unit_price ?? 0).toFixed(2)}</option>`)
                .join('');
        }
        openModal(document.getElementById('addItemModal'));
    }

    function onAddItemSubmit(e) {
        e.preventDefault();
        const productSelect = document.getElementById('addItemProductSelect');
        const qtyInput = document.getElementById('addItemQty');
        const productId = parseInt(productSelect?.value || '', 10);
        const quantity = Math.max(1, parseInt(qtyInput?.value || '1', 10));
        if (!productId || !quantity) {
            flash('error', 'Choose a product and quantity.');
            return;
        }
        const selectedOpt = productSelect.selectedOptions[0];
        const unitPrice = parseFloat(selectedOpt.getAttribute('data-price') || '0');
        const name = selectedOpt.getAttribute('data-name') || `Product ${productId}`;
        const categoryName = selectedOpt.getAttribute('data-category') || null;
        // Merge duplicate products by product_id and unit price
        const existingIdx = state.simCart.findIndex(
            (it) => Number(it.product_id) === productId && Number(it.unit_price) === Number(unitPrice)
        );
        if (existingIdx >= 0) {
            state.simCart[existingIdx].quantity += quantity;
        } else {
            state.simCart.push({
                product_id: productId,
                name,
                category_name: categoryName,
                unit_price: unitPrice,
                quantity
            });
        }
        renderSimCart('simCart', state.simCart);
        // auto-run simulation
        triggerSimulateDebounced();
        closeModal(document.getElementById('addItemModal'));
    }

    // Debounced simulate to keep UI responsive
    let simulateTimer = null;
    function triggerSimulateDebounced() {
        if (!state.selectedBuyerId) return;
        clearTimeout(simulateTimer);
        simulateTimer = setTimeout(() => {
            runBuilderSimulation();
        }, 200);
    }

    async function refreshSimulatorData() {
        try {
            // Reload discount codes list
            const res = await fetch('/api/v1/discounts/codes');
            const data = await res.json();
            if (data?.success && Array.isArray(data.discounts)) {
                state.discounts = data.discounts;
                renderDiscountList();
            }
            // Reload products for buyer
            if (state.selectedBuyerId) {
                await loadBuyerProductsForBuilder(state.selectedBuyerId);
            }
            // Rerun simulation if cart has items
            if (state.simCart.length && state.selectedBuyerId) {
                await runBuilderSimulation();
            }
            flash('success', 'Simulator refreshed.');
        } catch (err) {
            console.error('[discounts] refresh failed', err);
            flash('error', 'Failed to refresh simulator.');
        }
    }
    function formatCurrency(value) {
        return `$${(value || 0).toFixed(2)}`;
    }

    function slugify(str) {
        return (str || '')
            .toString()
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function escapeHtml(str) {
        const s = (str ?? '').toString();
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
})();


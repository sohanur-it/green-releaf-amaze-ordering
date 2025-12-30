// Server/Controllers/purgeArchiveController.js
// Module 20: Purge Archive Policy

const purgeArchiveService = require('../Services/purgeArchiveService');

class PurgeArchiveController {
    /**
     * POST /api/v1/admin/archive/purge/scanning-sessions
     * Purge scanning sessions from archive (super_admin only)
     */
    async purgeScanningSessions(req, res) {
        try {
            const { session_ids, purge_reason, approval_reference, approval_document_path } = req.body;
            const userId = req.user.id;

            if (!Array.isArray(session_ids) || session_ids.length === 0) {
                return res.status(400).json({ error: 'session_ids array is required' });
            }

            if (!purge_reason || purge_reason.trim().length < 100) {
                return res.status(400).json({ error: 'purge_reason is required (minimum 100 characters)' });
            }

            // Require confirmation phrase
            if (req.body.confirmation_phrase !== 'DELETE PERMANENTLY') {
                return res.status(400).json({ error: 'Confirmation phrase must be exactly "DELETE PERMANENTLY"' });
            }

            const result = await purgeArchiveService.purgeScanningSessions(
                session_ids,
                userId,
                purge_reason,
                approval_reference,
                approval_document_path
            );
            
            res.json(result);
        } catch (error) {
            console.error('Error purging scanning sessions:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * POST /api/v1/admin/archive/purge/cancelled-shipments
     * Purge cancelled shipment packages from archive (super_admin only)
     */
    async purgeCancelledShipments(req, res) {
        try {
            const { package_ids, purge_reason, approval_reference, approval_document_path } = req.body;
            const userId = req.user.id;

            if (!Array.isArray(package_ids) || package_ids.length === 0) {
                return res.status(400).json({ error: 'package_ids array is required' });
            }

            if (!purge_reason || purge_reason.trim().length < 100) {
                return res.status(400).json({ error: 'purge_reason is required (minimum 100 characters)' });
            }

            // Require confirmation phrase
            if (req.body.confirmation_phrase !== 'DELETE PERMANENTLY') {
                return res.status(400).json({ error: 'Confirmation phrase must be exactly "DELETE PERMANENTLY"' });
            }

            const result = await purgeArchiveService.purgeCancelledShipments(
                package_ids,
                userId,
                purge_reason,
                approval_reference,
                approval_document_path
            );
            
            res.json(result);
        } catch (error) {
            console.error('Error purging cancelled shipments:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * GET /api/v1/admin/archive/purge-log
     * Get purge log history
     */
    async getPurgeLog(req, res) {
        try {
            const { archive_type, user_id, date_from, date_to } = req.query;

            const filters = {
                archive_type: archive_type || null,
                user_id: user_id ? parseInt(user_id) : null,
                date_from: date_from || null,
                date_to: date_to || null
            };

            const result = await purgeArchiveService.getPurgeLog(filters);
            res.json(result);
        } catch (error) {
            console.error('Error getting purge log:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = new PurgeArchiveController();




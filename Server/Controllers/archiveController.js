// Server/Controllers/archiveController.js
// Module 20: Archive Management

const archiveService = require('../Services/archiveService');
const restoreArchiveService = require('../Services/restoreArchiveService');

class ArchiveController {
    /**
     * GET /api/v1/admin/archive/stats
     * Get archive statistics
     */
    async getArchiveStats(req, res) {
        try {
            const stats = await archiveService.getArchiveStats();
            res.json({
                success: true,
                stats: stats
            });
        } catch (error) {
            console.error('Error getting archive stats:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * POST /api/v1/admin/archive/restore/scanning-sessions
     * Restore scanning sessions from archive
     */
    async restoreScanningSessions(req, res) {
        try {
            const { session_ids } = req.body;
            const userId = req.user.id;

            if (!Array.isArray(session_ids) || session_ids.length === 0) {
                return res.status(400).json({ error: 'session_ids array is required' });
            }

            const result = await restoreArchiveService.restoreScanningSessions(session_ids, userId);
            res.json(result);
        } catch (error) {
            console.error('Error restoring scanning sessions:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * POST /api/v1/admin/archive/restore/manifest-packages
     * Restore manifest packages from archive
     */
    async restoreManifestPackages(req, res) {
        try {
            const { package_ids } = req.body;
            const userId = req.user.id;

            if (!Array.isArray(package_ids) || package_ids.length === 0) {
                return res.status(400).json({ error: 'package_ids array is required' });
            }

            const result = await restoreArchiveService.restoreManifestPackages(package_ids, userId);
            res.json(result);
        } catch (error) {
            console.error('Error restoring manifest packages:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * POST /api/v1/admin/archive/restore/cancelled-shipments
     * Restore cancelled shipment packages from archive
     */
    async restoreCancelledShipments(req, res) {
        try {
            const { package_ids } = req.body;
            const userId = req.user.id;

            if (!Array.isArray(package_ids) || package_ids.length === 0) {
                return res.status(400).json({ error: 'package_ids array is required' });
            }

            const result = await restoreArchiveService.restoreCancelledShipments(package_ids, userId);
            res.json(result);
        } catch (error) {
            console.error('Error restoring cancelled shipments:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * GET /api/v1/admin/archive/search
     * Search archived records
     */
    async searchArchive(req, res) {
        try {
            const { archive_type, invoice_id, package_label, date_from, date_to } = req.query;

            if (!archive_type) {
                return res.status(400).json({ error: 'archive_type is required' });
            }

            const filters = {
                invoice_id: invoice_id ? parseInt(invoice_id) : null,
                package_label: package_label || null,
                date_from: date_from || null,
                date_to: date_to || null
            };

            const result = await restoreArchiveService.searchArchive(archive_type, filters);
            res.json(result);
        } catch (error) {
            console.error('Error searching archive:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = new ArchiveController();




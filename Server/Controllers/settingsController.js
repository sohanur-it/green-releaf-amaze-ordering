// Server/Controllers/settingsController.js

const UserModel = require('../Models/userModel');

class SettingsController {
    /**
     * Show settings page
     */
    static async showSettings(req, res) {
        try {
            const userId = req.session.userId;
            if (!userId) {
                return res.redirect('/auth/login');
            }

            const user = await UserModel.findById(userId);
            
            res.render('admin/settings', {
                title: 'Settings',
                layout: 'layouts/main',
                user: user,
                success: req.query.success,
                error: req.query.error
            });
        } catch (error) {
            console.error('Error loading settings:', error);
            res.render('admin/settings', {
                title: 'Settings',
                layout: 'layouts/main',
                user: null,
                error: 'Failed to load settings'
            });
        }
    }

    /**
     * Handle password change
     */
    static async changePassword(req, res) {
        try {
            const userId = req.session.userId;
            if (!userId) {
                return res.redirect('/auth/login');
            }

            const { currentPassword, newPassword, confirmPassword } = req.body;

            // Validate input
            if (!currentPassword || !newPassword || !confirmPassword) {
                return res.redirect('/admin/settings?error=All fields are required');
            }

            if (newPassword !== confirmPassword) {
                return res.redirect('/admin/settings?error=New passwords do not match');
            }

            if (newPassword.length < 8) {
                return res.redirect('/admin/settings?error=Password must be at least 8 characters long');
            }

            // Get current user
            const user = await UserModel.findById(userId);
            if (!user) {
                return res.redirect('/admin/settings?error=User not found');
            }

            // Verify current password
            const isPasswordValid = await UserModel.verifyPassword(currentPassword, user.password_hash);
            if (!isPasswordValid) {
                return res.redirect('/admin/settings?error=Current password is incorrect');
            }

            // Update password
            await UserModel.updatePassword(userId, newPassword);

            res.redirect('/admin/settings?success=Password updated successfully');
        } catch (error) {
            console.error('Error changing password:', error);
            res.redirect('/admin/settings?error=An error occurred while changing password');
        }
    }
}

module.exports = SettingsController;


/**
 * Email Service
 * 
 * Handles email notifications for invoice state changes
 * Currently a placeholder - integrate with SendGrid, AWS SES, or similar service
 */

class EmailService {
    constructor() {
        this.enabled = process.env.EMAIL_SERVICE_ENABLED === 'true';
        this.fromEmail = process.env.EMAIL_FROM || 'noreply@greenreleaf.com';
        this.fromName = process.env.EMAIL_FROM_NAME || 'Green Releaf';
    }

    /**
     * Send email notification
     * @param {Object} options - Email options
     * @param {string} options.to - Recipient email
     * @param {string} options.subject - Email subject
     * @param {string} options.template - Template name (e.g., 'order_approved')
     * @param {Object} options.data - Template data
     * @returns {Promise<Object>} - Result
     */
    async sendEmail(options) {
        if (!this.enabled) {
            console.log(`[Email] Service disabled. Would send to ${options.to}: ${options.subject}`);
            return { success: true, skipped: true, reason: 'email_service_disabled' };
        }

        try {
            // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
            // Example with SendGrid:
            // const sgMail = require('@sendgrid/mail');
            // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            // 
            // const msg = {
            //     to: options.to,
            //     from: { email: this.fromEmail, name: this.fromName },
            //     subject: options.subject,
            //     templateId: this.getTemplateId(options.template),
            //     dynamicTemplateData: options.data
            // };
            // 
            // await sgMail.send(msg);

            console.log(`[Email] Would send email to ${options.to}: ${options.subject}`);
            return { success: true, message: 'Email queued (service not configured)' };
        } catch (error) {
            console.error('[Email] Error sending email:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get template ID for email service
     * @param {string} templateName - Template name
     * @returns {string} - Template ID
     */
    getTemplateId(templateName) {
        const templates = {
            'pending_approval': process.env.EMAIL_TEMPLATE_PENDING_APPROVAL,
            'order_approved': process.env.EMAIL_TEMPLATE_ORDER_APPROVED,
            'order_cancelled': process.env.EMAIL_TEMPLATE_ORDER_CANCELLED,
            'order_shipped': process.env.EMAIL_TEMPLATE_ORDER_SHIPPED,
            'order_delivered': process.env.EMAIL_TEMPLATE_ORDER_DELIVERED
        };
        return templates[templateName] || null;
    }

    /**
     * Send SMS notification (optional)
     * @param {string} phoneNumber - Recipient phone number
     * @param {string} message - SMS message
     * @returns {Promise<Object>} - Result
     */
    async sendSMS(phoneNumber, message) {
        if (!this.enabled || process.env.SMS_SERVICE_ENABLED !== 'true') {
            return { success: true, skipped: true, reason: 'sms_service_disabled' };
        }

        try {
            // TODO: Integrate with SMS service (Twilio, AWS SNS, etc.)
            console.log(`[SMS] Would send SMS to ${phoneNumber}: ${message}`);
            return { success: true, message: 'SMS queued (service not configured)' };
        } catch (error) {
            console.error('[SMS] Error sending SMS:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new EmailService();


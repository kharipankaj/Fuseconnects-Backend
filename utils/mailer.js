const SibApiV3Sdk = require('sib-api-v3-sdk');

const getEnv = (...keys) => {
    for (const key of keys) {
        const value = process.env[key];
        if (typeof value === 'string' && value.trim()) {
            return value.replace(/^["']|["']$/g, '').trim();
        }
    }
    return '';
};

const isBrevoConfigured = () => {
    return !!(
        getEnv('BREVO_API_KEY', 'SIB_API_KEY') &&
        getEnv('FROM_EMAIL')
    );
};

// Initialize Brevo API client
let emailApi = null;

const initializeBrevoClient = () => {
    const apiKey = getEnv('BREVO_API_KEY', 'SIB_API_KEY');
    if (!apiKey) return false;

    try {
        const client = SibApiV3Sdk.ApiClient.instance;
        client.authentications['api-key'].apiKey = apiKey;
        emailApi = new SibApiV3Sdk.TransactionalEmailsApi();
        console.log('Brevo API client initialized successfully');
        return true;
    } catch (error) {
        console.error('Failed to initialize Brevo client:', error.message);
        return false;
    }
};

if (isBrevoConfigured()) {
    initializeBrevoClient();
} else {
    console.warn('Brevo API not configured - missing environment variables:');
    console.warn('  Required: BREVO_API_KEY (or SIB_API_KEY) and FROM_EMAIL');
}

const sendOtpEmail = async (email, otp) => {
    if (!isBrevoConfigured()) {
        console.error('Brevo API is not configured. Missing environment variables:');
        console.error('  - BREVO_API_KEY (or SIB_API_KEY):', getEnv('BREVO_API_KEY', 'SIB_API_KEY') ? 'SET' : 'MISSING');
        console.error('  - FROM_EMAIL:', getEnv('FROM_EMAIL') ? 'SET' : 'MISSING');
        return {
            success: false,
            error: 'Email service not configured. Please set BREVO_API_KEY and FROM_EMAIL environment variables.'
        };
    }

    if (!emailApi) {
        return {
            success: false,
            error: 'Email API client not initialized'
        };
    }

    const fromEmail = getEnv('FROM_EMAIL');
    const fromName = getEnv('FROM_NAME') || 'Fuseconnects';

    const emailRequest = {
        sender: {
            email: fromEmail,
            name: fromName
        },
        to: [
            {
                email: email
            }
        ],
        subject: 'Your OTP for Password Reset - Fuseconnects',
        htmlContent: `
            <html>
                <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
                    <div style="background-color: white; padding: 30px; border-radius: 8px; max-width: 500px; margin: 0 auto;">
                        <h2 style="color: #333; margin-bottom: 20px;">Password Reset OTP</h2>
                        <p style="color: #666; margin-bottom: 15px;">Your OTP for password reset is:</p>
                        <div style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
                            <h1 style="color: #007bff; margin: 0; letter-spacing: 2px;">${otp}</h1>
                        </div>
                        <p style="color: #999; font-size: 14px; margin-top: 20px;">⏱️ This OTP expires in <strong>5 minutes</strong>.</p>
                        <p style="color: #999; font-size: 14px;">If you didn't request this, please ignore this email.</p>
                    </div>
                </body>
            </html>
        `,
        textContent: `Your OTP is ${otp}. It expires in 5 minutes.`
    };

    try {
        console.log(`Sending OTP email to: ${email}`);
        const response = await emailApi.sendTransacEmail(emailRequest);
        console.log('OTP email sent successfully. Message ID:', response.messageId, 'to:', email);
        return { success: true };
    } catch (error) {
        console.error('Error sending OTP email to', email, ':', error.message);
        console.error('Error details:', error);
        return { success: false, error: error.message };
    }
};

module.exports = { sendOtpEmail };

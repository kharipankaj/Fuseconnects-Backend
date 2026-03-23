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

const sendVerificationEmail = async (email, token, username) => {
    if (!isBrevoConfigured()) {
        return { success: false, error: 'Email service not configured' };
    }

    if (!emailApi) {
        return { success: false, error: 'Email API client not initialized' };
    }

    const fromEmail = getEnv('FROM_EMAIL');
    const fromName = getEnv('FROM_NAME') || 'Fuseconnects';
    const frontend = getEnv('FRONTEND_URL') || 'http://localhost:3000';
    const verifyUrl = `${frontend.replace(/\/$/, '')}/verify-email?token=${token}&username=${encodeURIComponent(username)}`;

    const emailRequest = {
        sender: {
            email: fromEmail,
            name: fromName
        },
        to: [ { email } ],
        subject: 'Verify your email for Fuseconnects',
        htmlContent: `
            <html>
                <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
                    <div style="background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #333; margin-bottom: 20px;">Welcome to Fuseconnects</h2>
                        <p style="color: #666; margin-bottom: 15px;">Hi ${username},</p>
                        <p style="color: #666; margin-bottom: 15px;">Please verify your email address by clicking the button below:</p>
                        <div style="text-align:center; margin: 20px 0;">
                            <a href="${verifyUrl}" style="background-color:#007bff;color:white;padding:12px 20px;border-radius:6px;text-decoration:none;">Verify Email</a>
                        </div>
                        <p style="color:#999; font-size:13px;">If the button does not work, copy and paste this link into your browser:</p>
                        <p style="font-size:12px; color:#666; word-break:break-all;">${verifyUrl}</p>
                        <p style="color: #999; font-size: 13px; margin-top:20px;">If you didn't create an account, you can ignore this message.</p>
                    </div>
                </body>
            </html>
        `,
        textContent: `Hi ${username}, please verify your email by visiting ${verifyUrl}`
    };

    try {
        console.log(`Sending verification email to: ${email}`);
        const response = await emailApi.sendTransacEmail(emailRequest);
        console.log('Verification email sent. Message ID:', response.messageId, 'to:', email);
        return { success: true };
    } catch (error) {
        console.error('Error sending verification email to', email, ':', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = { sendOtpEmail, sendVerificationEmail };

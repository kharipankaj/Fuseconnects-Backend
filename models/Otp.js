const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const otpSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    email: {
        type: String,
        required: true,
        lowercase: true
    },
    otp: {
        type: String,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true,
        index: { expires: 0 } 
    },
    attempts: {
        type: Number,
        default: 0
    },
    resetToken: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

otpSchema.pre('save', async function (next) {
    if (!this.isModified('otp')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.otp = await bcrypt.hash(this.otp, salt);
        next();
    } catch (err) {
        next(err);
    }
});

otpSchema.methods.compareOtp = function (candidateOtp) {
    return bcrypt.compare(candidateOtp, this.otp);
};

module.exports = mongoose.model('Otp', otpSchema);

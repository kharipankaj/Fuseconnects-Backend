const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const refreshTokenSchema = new mongoose.Schema({
    tokenHash: {
        type: String,
        required: true
    },
    device: {
        type: String,
        default: "web"
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
});

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true,
        trim: true
    },
    refreshTokens: [refreshTokenSchema],

    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    mobile: {
        type: String,
        required: false,
        validate: {
            validator: function(v) {
                // Allow null or empty string
                if (!v) return true;
                // If provided, must match 10 digits
                return /^[0-9]{10}$/.test(v);
            },
            message: 'Mobile must be 10 digits if provided'
        },
        sparse: true,
        default: null
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        match: /^\S+@\S+\.\S+$/,
        unique: false
    },

    createdAt: {
        type: Date,
        default: Date.now
    },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    followerCount: {
        type: Number,
        default: 0
    },
    followingCount: {
        type: Number,
        default: 0
    },
    bio: {
        type: String,
        trim: true
    },
    displayPicture: {
        type: String,
        default: 'https://res.cloudinary.com/dhiw3k8to/image/upload/v1758988596/myUploads/fzf1dskuqnzrt92rt6px.jpg'
    },
    postCount: {
        type: Number,
        default: 0
    },
    SparkCount: {
        type: Number,
        default: 0
    },
    birthday: {
        type: Date
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'other'],
        default: 'other'
    },
    currentRoom: {
        type: String
    },
    savedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],
    savedSparks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Spark' }],
    isPrivate: {
        type: Boolean,
        default: false
    },
    followRequests: [{
        requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
        requestedAt: { type: Date, default: Date.now }
    }],
    referralToken: {
        type: String,
        unique: true
    },
    credits: {
        type: Number,
        default: 80
    },
    isPremium: {
        type: Boolean,
        default: false
    },
    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    referrals: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    creditHistory: [{
        type: {
            type: String,
            enum: ['earned', 'spent']
        },
        amount: Number,
        reason: String,
        date: {
            type: Date,
            default: Date.now
        }
    }],
    usedReferralCodes: [{ type: String }],
    notifications: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Notification'
    }],
    unreadNotificationCount: {
        type: Number,
        default: 0
    },
    highlights: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Highlight'
    }],
    anonId: {
        type: String,
        unique: true
    },
    freeBotReplies: {
        type: Number,
        default: 50
    },
    city: {
        type: String,
        trim: true
    },
    tokens: {
        type: Number,
        default: 0
    },
    lastCreditReset: {
        type: Date,
        default: Date.now
    },
    role: {
        type: String,
        enum: ['user', 'helper', 'moderator', 'admin'],
        default: 'user'
    },
});

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (err) {
        next(err);
    }
});

userSchema.methods.comparePassword = function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;

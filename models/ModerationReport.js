const mongoose = require('mongoose');

const actionSchema = new mongoose.Schema({
    action: { type: String }, // e.g. soft-hide, delete, mute, suspend, ban, dismiss
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    performedAt: { type: Date, default: Date.now },
    reason: String,
    meta: Object
});

const moderationReportSchema = new mongoose.Schema({
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reportedMessageId: { type: String },
    platform: { type: String, default: 'unknown' },
    reason: { type: String },
    tags: [String],
    status: { type: String, enum: ['open', 'in-review', 'actioned', 'dismissed'], default: 'open' },
    actions: [actionSchema],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ModerationReport', moderationReportSchema);
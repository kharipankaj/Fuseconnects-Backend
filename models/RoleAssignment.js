const mongoose = require('mongoose');

const roleAssignmentSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['helper', 'moderator', 'admin'], required: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedAt: { type: Date, default: Date.now },
    revoked: { type: Boolean, default: false },
    revokedAt: { type: Date }
});

module.exports = mongoose.model('RoleAssignment', roleAssignmentSchema);

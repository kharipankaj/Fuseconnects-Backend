const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    roomId: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    name: {
        type: String,
        required: false,
        index: true
    },
    city: {
        type: String,
        required: false
    },
    active: {
        type: Boolean,
        default: true
    },
    users: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    followers: [{
        type: String
    }],
    messages: [{
        sender: {
            type: String,
            default: 'AnonID'
        },
        message: String,
        time: {
            type: Date,
            default: Date.now
        }
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Room = mongoose.model('Room', roomSchema);

module.exports = Room;

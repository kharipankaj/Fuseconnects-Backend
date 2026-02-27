
const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    name: {
        type: String,
        required: false,
        index: true
    },
     members: {
        type: Number,
        default: 0
    },
    anonIds: [{
        type: String,
        index: true
    }],
    city: {
        type: String,
        required: false
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
    slowMode: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const GeneralRoom = mongoose.model('GeneralRoom', roomSchema);

module.exports = GeneralRoom;


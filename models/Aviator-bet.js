const mongoose = require('mongoose');


const betSchema = new mongoose.Schema({
  playerId: { type: String, required: true },
  username: { type: String, required: true },
  roundId: { type: String, required: true },
  betAmount: { type: Number, required: true },
  cashedOutAt: { type: Number, default: null },
  profit: { type: Number, default: 0 },
  won: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

betSchema.index({ playerId: 1, createdAt: -1 });
betSchema.index({ roundId: 1 });
betSchema.index({ won: 1, profit: -1 });
const Bet = mongoose.model('Bet', betSchema);
module.exports = { Bet };

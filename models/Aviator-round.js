const mongoose = require('mongoose');

const roundSchema = new mongoose.Schema({
  roundId: { 
    type: String, 
    required: true, 
    unique: true 
},
  crashPoint: { 
    type: Number, 
    required: true 
},
  startTime: { 
    type: Date, 
    required: true 
},
  endTime: { 
    type: Date 
},
  bets: [
    {
      playerId: String,
      username: String,
      betAmount: Number,
      cashedOutAt: Number, // multiplier when cashed out, null if crashed
      profit: Number,
    },
  ],
  status: { type: String, enum: ['waiting', 'flying', 'crashed'], default: 'waiting' },
  createdAt: { type: Date, default: Date.now },
});

roundSchema.index({ roundId: 1 });
roundSchema.index({ status: 1, createdAt: -1 });
const AviatorRound = mongoose.model('Aviator-round', roundSchema);
module.exports = { AviatorRound };

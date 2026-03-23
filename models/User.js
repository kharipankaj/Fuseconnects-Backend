const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },

  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    lowercase: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [20, 'Username cannot exceed 20 characters']
  },
  email: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true,
    sparse: true
  },
  mobile: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },

  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  role: {
    type: String,
    enum: ['user', 'moderator', 'admin'],
    default: 'user'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  balance: {
    type: Number,
    default: 1000,
    min: 0
  },
  totalBets: {
    type: Number,
    default: 0
  },
  totalWins: {
    type: Number,
    default: 0
  },
  gamesPlayed: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  refreshTokens: [{
    tokenHash: {
      type: String,
      required: true
    },
    device: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  tokenLastRefreshedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Indexes
userSchema.index({ balance: 1 });
userSchema.index({ 'refreshTokens.tokenHash': 1 }, { sparse: true });
module.exports = mongoose.model('User', userSchema);


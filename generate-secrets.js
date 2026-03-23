const crypto = require('crypto');

const generateSecret = () => {
  return crypto.randomBytes(32).toString('hex');
};

console.log('JWT_SECRET=' + generateSecret());
console.log('REFRESH_TOKEN_SECRET=' + generateSecret());
console.log('');
console.log('Run: node generate-secrets.js');
console.log('Copy output to Backend/.env');


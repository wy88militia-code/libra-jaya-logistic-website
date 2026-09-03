import crypto from 'node:crypto';
console.log(`OFFSITE_BACKUP_ENCRYPTION_KEY_B64=${crypto.randomBytes(32).toString('base64')}`);

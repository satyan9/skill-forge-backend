/**
 * send-test-notification.js
 * Run: node send-test-notification.js
 * 
 * Sends a real test notification to the first user found in the DB.
 * This triggers MongoDB Change Stream → SSE → browser bell updates LIVE.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type:    { type: String, enum: ['success', 'info', 'warning', 'error', 'achievement'], default: 'info' },
    title:   { type: String, required: true },
    message: { type: String, required: true },
    read:    { type: Boolean, default: false },
    link:    { type: String, default: null },
    meta:    { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
const Notification = mongoose.model('Notification', notificationSchema);
const User = mongoose.model('User', new mongoose.Schema({ name: String, email: String }));

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // Find the first user
  const user = await User.findOne().lean();
  if (!user) {
    console.error('❌ No users found in DB. Please register first.');
    process.exit(1);
  }

  console.log(`👤 Sending notification to: ${user.name} (${user.email})`);

  const notif = await Notification.create({
    userId:  user._id,
    type:    'achievement',
    title:   '🏆 Skillpilot Notification Test',
    message: `Hey ${user.name.split(' ')[0]}! Your real-time notification system is working perfectly. This was pushed via MongoDB → Change Stream → SSE!`,
    link:    '/profile',
  });

  console.log('🔔 Notification created:', notif._id.toString());
  console.log('   → Check the bell icon in your browser — it should update instantly!');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

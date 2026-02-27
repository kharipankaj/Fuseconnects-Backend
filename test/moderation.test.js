const request = require('supertest');
const jwt = require('jsonwebtoken');
const connectDB = require('../db');
const mongoose = require('mongoose');
const User = require('../models/User');
const ModerationReport = require('../models/ModerationReport');
const { app } = require('../server');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

describe('Moderation endpoints', () => {
  let helper, moderator, admin, target;
  let helperToken, moderatorToken, adminToken;

  beforeAll(async () => {
    if (!process.env.MONGO_URL) {
      throw new Error('MONGO_URL must be set for tests');
    }
    await connectDB();

    // cleanup collections to keep tests idempotent
    await User.deleteMany({ username: /test_mod_/ });
    await ModerationReport.deleteMany({ platform: 'test-mod' });

    helper = new User({ username: 'test_mod_helper', firstName: 'Helper', email: 'h@example.com', password: 'password123', mobile: '9999999999' });
    helper.role = 'helper';
    await helper.save();

    moderator = new User({ username: 'test_mod_moderator', firstName: 'Moderator', email: 'm@example.com', password: 'password123', mobile: '9999999998' });
    moderator.role = 'moderator';
    await moderator.save();

    admin = new User({ username: 'test_mod_admin', firstName: 'Admin', email: 'a@example.com', password: 'password123', mobile: '9999999997' });
    admin.role = 'admin';
    await admin.save();

    target = new User({ username: 'test_mod_target', firstName: 'Target', email: 't@example.com', password: 'password123', mobile: '9999999996' });
    await target.save();

    helperToken = jwt.sign({ id: helper._id, username: helper.username }, JWT_SECRET);
    moderatorToken = jwt.sign({ id: moderator._id, username: moderator.username }, JWT_SECRET);
    adminToken = jwt.sign({ id: admin._id, username: admin.username }, JWT_SECRET);
  }, 20000);

  afterAll(async () => {
    // cleanup created docs
    try {
      await User.deleteMany({ username: /test_mod_/ });
      await ModerationReport.deleteMany({ platform: 'test-mod' });
    } catch (err) {
      // ignore
    }
    await mongoose.disconnect();
  });

  test('helper can create a report', async () => {
    const payload = {
      reportedUser: target._id.toString(),
      reportedMessageRef: { roomName: 'room_test', message: 'bad', time: new Date().toISOString() },
      platform: 'test-mod',
      reason: 'spam',
      tags: ['spam']
    };

    const res = await request(app)
      .post('/moderation/report')
      .set('Cookie', `accessToken=${helperToken}`)
      .send(payload)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.report).toBeDefined();
    expect(res.body.report.reason).toBe('spam');
  });

  test('moderator can list reports with pagination and filtering', async () => {
    const res = await request(app)
      .get('/moderation/reports?status=open&page=1&limit=5')
      .set('Cookie', `accessToken=${moderatorToken}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.reports)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  test('moderator can take action on a report and it updates target user logs', async () => {
    // find one report
    const list = await ModerationReport.findOne({ platform: 'test-mod' });
    expect(list).toBeTruthy();

    const res = await request(app)
      .post(`/moderation/reports/${list._id}/action`)
      .set('Cookie', `accessToken=${moderatorToken}`)
      .send({ action: 'warning', reason: 'test warning' })
      .expect(200);

    expect(res.body.ok).toBe(true);

    const updated = await User.findById(target._id);
    expect(updated.moderationLogs.some(l => l.action === 'warning')).toBe(true);
  });
});

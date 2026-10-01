// ═══════════════════════════════════════════════════════════════
// ICT 11 C Attendance Backend
// Express + Supabase + Facebook Messenger Webhook
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// ─── Startup environment validation ────────────────────────────
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_KEY'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:');
  missing.forEach((key) => console.error(`   - ${key}`));
  console.error('\n👉 Add them in Render → Your Service → Environment.');
  process.exit(1);
}

console.log('✅ Environment variables loaded');
console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL}`);
console.log(
  `   SUPABASE_KEY: ${
    process.env.SUPABASE_KEY
      ? '****' + process.env.SUPABASE_KEY.slice(-4)
      : 'MISSING'
  }`
);
console.log(
  `   FB_VERIFY_TOKEN: ${process.env.FB_VERIFY_TOKEN ? 'set' : 'missing (webhook disabled)'}`
);
console.log(
  `   FB_PAGE_ACCESS_TOKEN: ${
    process.env.FB_PAGE_ACCESS_TOKEN ? 'set' : 'missing (bot disabled)'
  }`
);

// ─── Initialize Supabase ──────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    global: { headers: { 'x-application-name': 'ict11c-backend' } },
  }
);

// ─── Initialize Express ───────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Backend is running',
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE SYNC ENDPOINT
// Receives attendance records from the Flutter app.
// ═══════════════════════════════════════════════════════════════
app.post('/api/sync', async (req, res) => {
  try {
    const {
      classId,
      className,
      date,
      presentStudents,
      absentCount,
      lateCount,
      excusedCount,
      totalStudents,
      checkerName,
      submittedAt,
      idempotencyKey,
    } = req.body;

    // Basic validation
    if (!classId || !date || !Array.isArray(presentStudents)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: classId, date, presentStudents[]',
      });
    }

    console.log(
      `📥 Sync received: ${classId} · ${date} · ${presentStudents.length} present`
    );

    // Idempotency: if key exists, return existing record
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from('attendance')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing) {
        console.log(`♻️ Duplicate submission skipped (key: ${idempotencyKey})`);
        return res.status(200).json({
          success: true,
          message: 'Already synced',
          id: existing.id,
          duplicate: true,
        });
      }
    }

    // Insert into Supabase
    const { data, error } = await supabase
      .from('attendance')
      .insert([
        {
          class_id: classId,
          class_name: className || 'ICT 11 C',
          date: date,
          present_students: presentStudents,
          present_count: presentStudents.length,
          absent_count: absentCount ?? 0,
          late_count: lateCount ?? 0,
          excused_count: excusedCount ?? 0,
          total_students: totalStudents ?? presentStudents.length,
          checker_name: checkerName || 'Unknown',
          submitted_at: submittedAt || new Date().toISOString(),
          idempotency_key: idempotencyKey || null,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Saved to Supabase: id=${data.id}`);

    // Fire-and-forget: send Messenger report (if bot configured)
    if (process.env.FB_PAGE_ACCESS_TOKEN) {
      sendAttendanceReportToTeacher({
        classId,
        className: className || 'ICT 11 C',
        date,
        presentStudents,
        absentCount: absentCount ?? 0,
        lateCount: lateCount ?? 0,
        checkerName: checkerName || 'Unknown',
        totalStudents: totalStudents ?? presentStudents.length,
      }).catch((err) =>
        console.error('⚠️ Messenger send failed:', err.message)
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Record synced',
      id: data.id,
    });
  } catch (error) {
    console.error('❌ Sync error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// FACEBOOK MESSENGER WEBHOOK
// ═══════════════════════════════════════════════════════════════

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN =
    process.env.FB_VERIFY_TOKEN || 'ict11c_secret_token_123';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified by Facebook');
    res.status(200).send(challenge);
  } else {
    console.warn('❌ Webhook verification failed');
    res.sendStatus(403);
  }
});

// Webhook event receiver (POST)
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object !== 'page') {
    return res.sendStatus(404);
  }

  // Acknowledge immediately (Facebook requires < 20s)
  res.status(200).send('EVENT_RECEIVED');

  try {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging?.[0];
      if (!webhookEvent) continue;

      // Capture sender PSID
      const senderPsid = webhookEvent.sender?.id;
      if (!senderPsid) continue;

      // Handle incoming message
      if (webhookEvent.message) {
        const messageText = webhookEvent.message.text;
        console.log(`💬 Message from ${senderPsid}: ${messageText}`);

        // Store teacher PSID if new
        await captureTeacherPsid(senderPsid, webhookEvent);

        // Respond to teacher commands
        await handleTeacherCommand(senderPsid, messageText);
      }

      // Handle delivery receipts
      if (webhookEvent.delivery) {
        console.log(`📬 Delivered to ${senderPsid}`);
      }

      // Handle read receipts
      if (webhookEvent.read) {
        console.log(`👁️ Read by ${senderPsid}`);
      }
    }
  } catch (err) {
    console.error('❌ Webhook processing error:', err.message);
  }
});

// ═══════════════════════════════════════════════════════════════
// MESSENGER HELPERS
// ═══════════════════════════════════════════════════════════════

async function captureTeacherPsid(psid, event) {
  try {
    const { error } = await supabase.from('teachers').upsert(
      {
        psid: psid,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'psid', ignoreDuplicates: false }
    );
    if (error && error.code !== '42P01') {
      // 42P01 = table doesn't exist yet
      console.warn('⚠️ Could not save teacher PSID:', error.message);
    }
  } catch (err) {
    console.warn('⚠️ captureTeacherPsid error:', err.message);
  }
}

async function handleTeacherCommand(psid, text) {
  if (!text) return;

  const lower = text.trim().toLowerCase();
  let reply = null;

  if (lower === 'help' || lower === 'start') {
    reply =
      '👋 Hi! I am the ICT 11 C attendance bot.\n\n' +
      'Commands:\n' +
      '• today — today\'s report\n' +
      '• absent — list of absentees\n' +
      '• student <name> — a student\'s history\n' +
      '• at-risk — students below 80%\n' +
      '• help — show this message';
  } else if (lower === 'today') {
    reply = await buildTodayReport();
  } else if (lower === 'absent') {
    reply = await buildAbsentReport();
  } else if (lower === 'at-risk') {
    reply = '⚠️ At-risk feature coming soon.';
  } else if (lower.startsWith('student ')) {
    const name = text.slice(8).trim();
    reply = `🔍 Looking up attendance for "${name}"... (feature coming soon)`;
  } else {
    reply = '🤔 I didn\'t understand that. Type "help" to see commands.';
  }

  if (reply) {
    await sendMessengerMessage(psid, reply);
  }
}

async function buildTodayReport() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('date', today)
    .eq('class_id', 'ICT11C')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return `📋 No attendance submitted yet for ${today}.`;
  }

  const total = data.total_students || 24;
  const pct = ((data.present_count / total) * 100).toFixed(1);

  let msg = `📋 ATTENDANCE · ${data.class_name || 'ICT 11 C'}\n`;
  msg += `${data.date}\n\n`;
  msg += `✅ Present: ${data.present_count} / ${total} (${pct}%)\n`;
  msg += `❌ Absent: ${data.absent_count}\n`;
  msg += `⏰ Late: ${data.late_count}\n\n`;
  msg += `👤 Checker: ${data.checker_name}\n`;
  msg += `🕓 Submitted: ${new Date(data.submitted_at).toLocaleString(
    'en-PH',
    { timeZone: 'Asia/Manila' }
  )}`;

  return msg;
}

async function buildAbsentReport() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('date', today)
    .eq('class_id', 'ICT11C')
    .maybeSingle();

  if (error || !data) {
    return `📋 No attendance submitted yet for ${today}.`;
  }

  return `❌ ${data.absent_count} absent today. Full list coming soon.`;
}

async function sendMessengerMessage(psid, text) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) {
    console.warn('⚠️ FB_PAGE_ACCESS_TOKEN not set — cannot send message');
    return;
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/me/messages`,
      {
        recipient: { id: psid },
        messaging_type: 'RESPONSE',
        message: { text },
      },
      { params: { access_token: token } }
    );
    console.log(`✅ Message sent to ${psid}`);
  } catch (err) {
    console.error(
      '❌ Send API error:',
      err.response?.data || err.message
    );
  }
}

async function sendAttendanceReportToTeacher({
  classId,
  className,
  date,
  presentStudents,
  absentCount,
  lateCount,
  checkerName,
  totalStudents,
}) {
  // Fetch all registered teachers
  const { data: teachers, error } = await supabase
    .from('teachers')
    .select('psid');

  if (error || !teachers || teachers.length === 0) {
    console.log('ℹ️ No teachers registered yet — skipping Messenger send');
    return;
  }

  const pct = ((presentStudents.length / totalStudents) * 100).toFixed(1);

  let msg = `📋 ATTENDANCE · ${className}\n`;
  msg += `${date}\n\n`;
  msg += `✅ Present: ${presentStudents.length} / ${totalStudents} (${pct}%)\n`;
  msg += `❌ Absent: ${absentCount}\n`;
  msg += `⏰ Late: ${lateCount}\n\n`;
  msg += `─── PRESENT ───\n`;

  presentStudents.forEach((name, i) => {
    msg += `${String(i + 1).padStart(2, ' ')}. ${name} ✓\n`;
  });

  msg += `\n👤 Checker: ${checkerName}`;

  for (const teacher of teachers) {
    await sendMessengerMessage(teacher.psid, msg);
  }
}

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`   Health:  GET  /health`);
  console.log(`   Sync:    POST /api/sync`);
  console.log(`   Webhook: GET  /webhook`);
  console.log(`   Webhook: POST /webhook`);
});
// ═══════════════════════════════════════════════════════════════
// ICT 11 C Attendance Backend
// Express + Supabase + Facebook Messenger Webhook
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// ═══════════════════════════════════════════════════════════════
// 🔍 DIAGNOSTIC BLOCK — runs first, before anything else
// ═══════════════════════════════════════════════════════════════
console.log('═══════════════════════════════════════════════════════');
console.log('🔍 ENVIRONMENT DIAGNOSTIC');
console.log('═══════════════════════════════════════════════════════');

// 1. Show all env vars containing "supa" (case-insensitive)
const supaKeys = Object.keys(process.env).filter((k) =>
  k.toLowerCase().includes('supa')
);
console.log(`\n1️⃣ Env vars matching "supa": ${supaKeys.length}`);
if (supaKeys.length === 0) {
  console.log('   ❌ NONE FOUND — the variable was never passed to the container');
} else {
  supaKeys.forEach((k) => {
    const val = process.env[k] || '';
    const preview = val.length > 40 ? val.slice(0, 40) + '...' : val;
    console.log(`   • "${k}" (length ${val.length}) = ${preview}`);
  });
}

// 2. Show all env vars containing "SUPA" as exact uppercase
const exactSupa = Object.keys(process.env).filter((k) =>
  k.startsWith('SUPA')
);
console.log(`\n2️⃣ Env vars starting with "SUPA": ${exactSupa.length}`);
exactSupa.forEach((k) => console.log(`   • "${k}"`));

// 3. Show every env var name (just names, no values — safe to log)
console.log(`\n3️⃣ Total env vars available: ${Object.keys(process.env).length}`);
console.log('   First 15 names:');
Object.keys(process.env)
  .slice(0, 15)
  .forEach((k) => console.log(`   • ${k}`));

// 4. Specific checks
console.log('\n4️⃣ Specific variable checks:');
console.log(
  `   process.env.SUPABASE_URL       = ${
    process.env.SUPABASE_URL ? '✅ SET' : '❌ UNDEFINED'
  }`
);
console.log(
  `   process.env.SUPABASE_KEY       = ${
    process.env.SUPABASE_KEY ? '✅ SET' : '❌ UNDEFINED'
  }`
);
console.log(
  `   process.env.FB_VERIFY_TOKEN    = ${
    process.env.FB_VERIFY_TOKEN ? '✅ SET' : '❌ UNDEFINED'
  }`
);
console.log(
  `   process.env.FB_PAGE_ACCESS_TOKEN = ${
    process.env.FB_PAGE_ACCESS_TOKEN ? '✅ SET' : '❌ UNDEFINED'
  }`
);

console.log('\n═══════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_KEY'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:');
  missing.forEach((key) => console.error(`   - ${key}`));
  console.error('\n👉 Add them in Render → Your Service → Environment.');
  console.error(
    '👉 Then click "Save Changes" and "Manual Deploy → Deploy latest commit".\n'
  );
  process.exit(1);
}

console.log('✅ Environment variables validated');
console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL}`);
console.log(
  `   SUPABASE_KEY: ****${process.env.SUPABASE_KEY.slice(-4)}\n`
);

// ═══════════════════════════════════════════════════════════════
// SUPABASE CLIENT
// ═══════════════════════════════════════════════════════════════
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    global: { headers: { 'x-application-name': 'ict11c-backend' } },
  }
);

// ═══════════════════════════════════════════════════════════════
// EXPRESS APP
// ═══════════════════════════════════════════════════════════════
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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
// ATTENDANCE SYNC
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

    if (!classId || !date || !Array.isArray(presentStudents)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: classId, date, presentStudents[]',
      });
    }

    console.log(
      `📥 Sync: ${classId} · ${date} · ${presentStudents.length} present`
    );

    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from('attendance')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing) {
        console.log(`♻️ Duplicate skipped (key: ${idempotencyKey})`);
        return res.status(200).json({
          success: true,
          message: 'Already synced',
          id: existing.id,
          duplicate: true,
        });
      }
    }

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
// FACEBOOK WEBHOOK
// ═══════════════════════════════════════════════════════════════
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

app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object !== 'page') {
    return res.sendStatus(404);
  }

  res.status(200).send('EVENT_RECEIVED');

  try {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging?.[0];
      if (!webhookEvent) continue;

      const senderPsid = webhookEvent.sender?.id;
      if (!senderPsid) continue;

      if (webhookEvent.message) {
        const messageText = webhookEvent.message.text;
        console.log(`💬 Message from ${senderPsid}: ${messageText}`);
        await captureTeacherPsid(senderPsid, webhookEvent);
        await handleTeacherCommand(senderPsid, messageText);
      }

      if (webhookEvent.delivery) {
        console.log(`📬 Delivered to ${senderPsid}`);
      }

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
    console.warn('⚠️ FB_PAGE_ACCESS_TOKEN not set');
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
  const { data: teachers, error } = await supabase
    .from('teachers')
    .select('psid');

  if (error || !teachers || teachers.length === 0) {
    console.log('ℹ️ No teachers registered — skipping Messenger send');
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
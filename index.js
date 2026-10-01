const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Supabase using the variables you just set in Render
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 1. Health Check (for your app's "Test Connection" button)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// 2. Sync Endpoint (Receives attendance from your Flutter app)
app.post('/api/sync', async (req, res) => {
  try {
    const { classId, date, presentStudents, checkerName } = req.body;

    // Save to Supabase
    const { data, error } = await supabase
      .from('attendance')
      .insert([
        { 
          class_id: classId, 
          date: date, 
          present_students: presentStudents, 
          checker_name: checkerName 
        }
      ]);

    if (error) throw error;

    console.log('Saved to Supabase:', data);
    
    // TODO: Trigger the Facebook Message here
    // await sendFacebookMessage(classId, date, presentStudents.length);

    res.status(200).json({ success: true, message: 'Record synced' });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Facebook Webhook Verification
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'ict11c_secret_token_123';
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

// 4. Facebook Webhook Event Receiver (Teacher replies)
app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    body.entry.forEach(entry => {
      const webhookEvent = entry.messaging[0];
      console.log('Received message from teacher:', webhookEvent);
      // You can add logic here to let the teacher reply or correct attendance
    });
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
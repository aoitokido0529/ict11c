const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Health check endpoint (for your "Test Connection" button)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// Sync endpoint (your app sends attendance here)
app.post('/api/sync', (req, res) => {
  console.log('Received sync data:', req.body);
  // TODO: Save to Supabase database here
  res.status(200).json({ success: true, message: 'Record synced' });
});

// Facebook Webhook endpoint
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = 'ict11c_secret_token_123';
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
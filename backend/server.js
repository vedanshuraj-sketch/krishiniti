require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const cropLotRoutes = require('./routes/cropLots');
const marketRoutes = require('./routes/market');
const recommendationRoutes = require('./routes/recommendation');

const app = express();
app.use(cors());
app.use(express.json());

// Health check — confirm the Backend itself is up before chasing anything else
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'krishiniti-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/crop-lots', cropLotRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/recommendation', recommendationRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`KRISHINITI backend running on port ${PORT}`);
  console.log(`AI/ML API configured at: ${process.env.AI_ML_API_URL}`);
});

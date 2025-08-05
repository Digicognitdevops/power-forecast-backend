import express from 'express';
import mongoose from 'mongoose';
import moment from 'moment';
import * as tf from '@tensorflow/tfjs';
import cors from 'cors';

const app = express();
app.use(express.json());

app.use(cors());

// ===== Mongo Schemas =====
const stationSchema = new mongoose.Schema({
  name: String,
  location: String,
});
const Station = mongoose.model('Station', stationSchema);

const demandSchema = new mongoose.Schema({
  station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station' },
  date: Date,
  time: String,
  actualDemand: Number,
  forecastedDemand: Number,
  temperature: Number,
  humidity: Number,
  dayOfWeek: Number,
  hour: Number,
  accuracy: Number
});
const Demand = mongoose.model('Demand', demandSchema);

// ===== ML Model =====
class EnergyForecastModel {
  constructor() {
    this.model = null;
    this.isTraining = false;
  }

  async prepareTrainingData() {
    const historical = await Demand.find().sort({ date: -1 });
    const features = historical.map(r => [
      r.temperature,
      r.humidity,
      r.dayOfWeek,
      r.hour,
      r.actualDemand ?? r.forecastedDemand
    ]);
    const targets = historical.map(r => [r.actualDemand]);
    return { features, targets };
  }

  async trainModel() {
    if (this.isTraining) return { status: 'already_training' };
    this.isTraining = true;
    console.log('🔥 Starting model training...');
    try {
      const { features, targets } = await this.prepareTrainingData();
      if (features.length < 50) throw new Error('Not enough data');

      const xs = tf.tensor2d(features);
      const ys = tf.tensor2d(targets);

      this.model = tf.sequential();
      this.model.add(tf.layers.dense({ inputShape: [5], units: 1 }));
      this.model.compile({ loss: 'meanSquaredError', optimizer: 'adam' });

      await this.model.fit(xs, ys, { epochs: 50, verbose: 0 });
      console.log('✅ Model trained');
      xs.dispose(); ys.dispose();
      this.isTraining = false;
      return { status: 'success', dataPoints: features.length, modelType: 'tfjs_linear' };
    } catch (err) {
      console.error('❌ Training failed:', err);
      this.isTraining = false;
      throw err;
    }
  }

  async predict(stationId, startDate, endDate) {
    if (!this.model) throw new Error('Model not trained');

    const start = moment(startDate);
    const end = moment(endDate);
    const predictions = [];

    for (let m = start.clone(); m.isBefore(end); m.add(1, 'hour')) {
      const temp = 30 + Math.random() * 5;  // Replace with real temp API if needed
      const humidity = 40 + Math.random() * 10;
      const dayOfWeek = m.day();
      const hour = m.hour();
      const lastDemand = 100 + Math.random() * 50; // You could also fetch the last known demand from DB

      const input = [temp, humidity, dayOfWeek, hour, lastDemand];
      const tensor = tf.tensor2d([input], [1, 5]);
      const prediction = this.model.predict(tensor);
      const forecastedDemand = (await prediction.data())[0];
      tensor.dispose(); prediction.dispose();

      predictions.push({
        timestamp: m.toISOString(),
        forecastedDemand: Math.round(forecastedDemand * 100) / 100,
        temperature: Math.round(temp * 10) / 10,
        humidity: Math.round(humidity),
        hour,
        dayOfWeek
      });
    }

    return predictions;
  }
}
const forecastModel = new EnergyForecastModel();
app.get('/health', async() => {
try {
   res.status(200).json({ message: true });
} catch (error) {
    res.status(500).json({ error: err.message });
}
})
// Train the model
app.post('/api/train-model', async (req, res) => {
  try {
    const result = await forecastModel.trainModel();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/predict', async (req, res) => {
  try {
    const { stationId, startDate, endDate } = req.body;

    if (!stationId || !startDate || !endDate)
      return res.status(400).json({ error: 'stationId, startDate, and endDate are required' });

    const station = await Station.findById(stationId);
    if (!station) return res.status(404).json({ error: 'Station not found' });

    const predictions = await forecastModel.predict(stationId, startDate, endDate);

    res.json(predictions);
  } catch (err) {
    console.error('Prediction error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Model performance endpoint
app.get('/api/model-performance', async (req, res) => {
  try {
    const recent = await Demand.find().sort({ date: -1 });
    const accuracies = recent.filter(p => p.accuracy).map(p => p.accuracy);
    const avgAccuracy = accuracies.reduce((a, b) => a + b, 0) / (accuracies.length || 1);
    res.json({
      averageAccuracy: Math.round(avgAccuracy * 100) / 100,
      totalPredictions: recent.length,
      modelStatus: forecastModel.model ? 'trained' : 'not_trained'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== MongoDB & Server Boot =====
mongoose.connect('mongodb+srv://dcadmin:dcadmin@power-forecast.hmbxdit.mongodb.net/power_forecast', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('📊 MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const PORT = 1234;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
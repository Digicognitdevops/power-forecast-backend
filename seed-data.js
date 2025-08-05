// seed.js
import mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import moment from 'moment';

// MongoDB connection
await mongoose.connect('mongodb://localhost:27017/energy_forecast');

// --- SCHEMAS ---
const stationSchema = new mongoose.Schema({
    name: String,
    location: String,
});
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

const Station = mongoose.model('Station', stationSchema);
const Demand = mongoose.model('Demand', demandSchema);

// --- CONSTANTS ---
const STATION_LIST = [
    { name: 'Muscat Central', location: 'Muscat' },
    { name: 'Salalah Grid', location: 'Salalah' },
    { name: 'Sohar Node', location: 'Sohar' },
    { name: 'Nizwa Point', location: 'Nizwa' },
    { name: 'Sur Hub', location: 'Sur' }
];

const OMAN_HOLIDAYS_2024 = [
    '2024-01-01', // New Year
    '2024-04-10', // Eid al-Fitr approx
    '2024-06-16', // Eid al-Adha approx
    '2024-07-23', // Renaissance Day
    '2024-09-16', // Prophet's Birthday approx
    '2024-11-18', // National Day
].map(d => moment(d).format('YYYY-MM-DD'));

// --- HELPERS ---
function getRandomTempHumidity(date, location) {
    const isSummer = [5, 6, 7, 8].includes(date.month());
    const temp = isSummer
        ? faker.number.float({ min: 32, max: 45 })
        : faker.number.float({ min: 22, max: 30 });
    const humidity = faker.number.float({ min: 20, max: 65 });
    return { temp, humidity };
}

function isHoliday(date) {
    return OMAN_HOLIDAYS_2024.includes(date.format('YYYY-MM-DD'));
}

// --- MAIN SEED FUNCTION ---
async function seed() {
    console.log('💥 Wiping old data...');
    await Station.deleteMany({});
    await Demand.deleteMany({});

    console.log('📡 Creating stations...');
    const stationDocs = await Station.insertMany(STATION_LIST);

    console.log('🌍 Seeding 1 year of hourly demand per station...');
    const startDate = moment('2024-01-01');
    const endDate = moment('2025-01-01');

    const hourlyData = [];

    for (let date = startDate.clone(); date.isBefore(endDate); date.add(1, 'hour')) {
        const dayOfWeek = date.day(); // 0 = Sunday
        const hour = date.hour();

        for (const station of stationDocs) {
            const { temp, humidity } = getRandomTempHumidity(date, station.location);

            // Base demand by hour and weekday
            const base = (hour >= 7 && hour <= 17) ? 120 : 80;
            const variation = faker.number.float({ min: -15, max: 20 });
            const holidayFactor = isHoliday(date) ? -20 : 0;

            const actualDemand = Math.max(30, base + variation + holidayFactor + temp * 0.8 - humidity * 0.3);
            const forecastedDemand = actualDemand + faker.number.float({ min: -5, max: 5 });
            const accuracy = 100 - Math.abs(actualDemand - forecastedDemand);

            hourlyData.push({
                station: station._id,
                date: date.toDate(),
                time: date.format('HH:mm'),
                actualDemand,
                forecastedDemand,
                temperature: temp,
                humidity,
                dayOfWeek,
                hour,
                accuracy
            });
        }

        // Optional: Batch insert every 1000 records
        if (hourlyData.length >= 1000) {
            await Demand.insertMany(hourlyData);
            hourlyData.length = 0; // clear the array
            console.log(`✅ Inserted up to ${date.format('YYYY-MM-DD HH:mm')}`);
        }
    }

    if (hourlyData.length) {
        await Demand.insertMany(hourlyData);
        console.log(`✅ Inserted remaining ${hourlyData.length} records`);
    }

    console.log('🚀 Seeding complete!');
    mongoose.disconnect();
}

await seed();

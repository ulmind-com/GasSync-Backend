import mongoose from 'mongoose';
import { GasPrice } from './src/models/GasPrice';
import { GasStation } from './src/models/GasStation';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log('Connected to MongoDB');
  
  // Find all stations and count prices
  const stations = await GasStation.find();
  console.log(`Found ${stations.length} stations in DB.`);
  
  const prices = await GasPrice.find();
  console.log(`Found ${prices.length} prices in DB.`);
  
  for (const station of stations) {
    const stationPrices = prices.filter(p => p.stationId.toString() === station._id.toString());
    if (stationPrices.length > 0) {
      console.log(`Station ${station.name} (${station.city}) has ${stationPrices.length} prices. GooglePlaceId: ${station.googlePlaceId}`);
    }
  }
  
  process.exit(0);
}

run().catch(console.error);

// ============================================================
// GasSync Backend - Database Seeder
// ============================================================

import mongoose from 'mongoose';
import GasStation from '../models/GasStation';
import GasPrice from '../models/GasPrice';
import PriceHistory from '../models/PriceHistory';
import User from '../models/User';
import { logger } from '../utils/logger';

/**
 * Seed the database with sample data for development
 */
export async function seedDatabase(): Promise<void> {
  logger.info('🌱 Starting database seed...');

  // Check if data already exists
  const stationCount = await GasStation.countDocuments();
  if (stationCount > 0) {
    logger.info('Database already has data. Skipping seed.');
    return;
  }

  // ---- Seed Gas Stations ----
  const stations = await GasStation.insertMany([
    {
      name: 'Shell - Downtown Houston',
      brand: 'Shell',
      address: '1200 Main St',
      city: 'Houston',
      state: 'TX',
      zipCode: '77002',
      location: { type: 'Point', coordinates: [-95.3632, 29.7543] },
      amenities: ['car_wash', 'convenience_store', 'atm', 'air'],
      operatingHours: { open: '05:00', close: '23:00', is24Hours: false },
    },
    {
      name: 'Chevron - Westheimer',
      brand: 'Chevron',
      address: '5400 Westheimer Rd',
      city: 'Houston',
      state: 'TX',
      zipCode: '77056',
      location: { type: 'Point', coordinates: [-95.4621, 29.7376] },
      amenities: ['convenience_store', 'atm'],
      operatingHours: { is24Hours: true },
    },
    {
      name: 'ExxonMobil - Galleria',
      brand: 'ExxonMobil',
      address: '2700 Post Oak Blvd',
      city: 'Houston',
      state: 'TX',
      zipCode: '77056',
      location: { type: 'Point', coordinates: [-95.4608, 29.7359] },
      amenities: ['convenience_store', 'car_wash'],
      operatingHours: { is24Hours: true },
    },
    {
      name: 'BP - Santa Monica Blvd',
      brand: 'BP',
      address: '8901 Santa Monica Blvd',
      city: 'Los Angeles',
      state: 'CA',
      zipCode: '90069',
      location: { type: 'Point', coordinates: [-118.3851, 34.0831] },
      amenities: ['convenience_store'],
      operatingHours: { open: '06:00', close: '22:00', is24Hours: false },
    },
    {
      name: 'Costco Gas - Burbank',
      brand: 'Costco',
      address: '1051 W Burbank Blvd',
      city: 'Burbank',
      state: 'CA',
      zipCode: '91506',
      location: { type: 'Point', coordinates: [-118.3287, 34.1782] },
      amenities: [],
      operatingHours: { open: '06:00', close: '21:30', is24Hours: false },
    },
    {
      name: 'Shell - Times Square',
      brand: 'Shell',
      address: '760 12th Ave',
      city: 'New York',
      state: 'NY',
      zipCode: '10019',
      location: { type: 'Point', coordinates: [-73.9976, 40.7627] },
      amenities: ['atm'],
      operatingHours: { is24Hours: true },
    },
    {
      name: 'Sunoco - Brooklyn',
      brand: 'Sunoco',
      address: '321 Atlantic Ave',
      city: 'Brooklyn',
      state: 'NY',
      zipCode: '11217',
      location: { type: 'Point', coordinates: [-73.9831, 40.6855] },
      amenities: ['convenience_store', 'air'],
      operatingHours: { open: '06:00', close: '23:00', is24Hours: false },
    },
    {
      name: 'Marathon - Michigan Ave',
      brand: 'Marathon',
      address: '400 N Michigan Ave',
      city: 'Chicago',
      state: 'IL',
      zipCode: '60611',
      location: { type: 'Point', coordinates: [-87.6244, 41.8891] },
      amenities: ['convenience_store', 'atm'],
      operatingHours: { is24Hours: true },
    },
    {
      name: 'Circle K - Miami Beach',
      brand: 'Circle K',
      address: '1500 Collins Ave',
      city: 'Miami Beach',
      state: 'FL',
      zipCode: '33139',
      location: { type: 'Point', coordinates: [-80.1341, 25.7867] },
      amenities: ['convenience_store', 'atm', 'air'],
      operatingHours: { is24Hours: true },
    },
    {
      name: 'Valero - I-35',
      brand: 'Valero',
      address: '8500 N Interstate 35',
      city: 'Austin',
      state: 'TX',
      zipCode: '78753',
      location: { type: 'Point', coordinates: [-97.6858, 30.3582] },
      amenities: ['convenience_store', 'car_wash'],
      operatingHours: { is24Hours: true },
    },
  ]);

  logger.info(`✅ Seeded ${stations.length} gas stations`);

  // ---- Seed Gas Prices ----
  const now = new Date();
  const prices: any[] = [];

  const basePrices: Record<string, Record<string, number>> = {
    TX: { regular: 2.89, midgrade: 3.19, premium: 3.49, diesel: 3.09 },
    CA: { regular: 4.59, midgrade: 4.89, premium: 5.19, diesel: 4.79 },
    NY: { regular: 3.79, midgrade: 4.09, premium: 4.39, diesel: 3.99 },
    IL: { regular: 3.49, midgrade: 3.79, premium: 4.09, diesel: 3.69 },
    FL: { regular: 3.19, midgrade: 3.49, premium: 3.79, diesel: 3.39 },
  };

  for (const station of stations) {
    const stateBasePrices = basePrices[station.state] || basePrices['TX'];

    for (const [fuelType, basePrice] of Object.entries(stateBasePrices)) {
      // Current price (with small random variation)
      const variation = (Math.random() - 0.5) * 0.2;
      prices.push({
        station: station._id,
        fuelType,
        price: Number((basePrice + variation).toFixed(3)),
        source: 'admin',
        state: station.state,
        city: station.city,
        zipCode: station.zipCode,
        recordedAt: now,
        isVerified: true,
      });

      // Historical prices (last 30 days)
      for (let day = 1; day <= 30; day++) {
        const date = new Date(now);
        date.setDate(date.getDate() - day);
        const historicalVariation = (Math.random() - 0.5) * 0.3;
        const trendAdjustment = day * 0.003; // prices slightly lower in the past

        prices.push({
          station: station._id,
          fuelType,
          price: Number((basePrice + historicalVariation - trendAdjustment).toFixed(3)),
          source: 'admin',
          state: station.state,
          city: station.city,
          zipCode: station.zipCode,
          recordedAt: date,
          isVerified: true,
        });
      }
    }
  }

  await GasPrice.insertMany(prices);
  logger.info(`✅ Seeded ${prices.length} gas prices`);

  // ---- Seed Price History (National + State) ----
  const historyEntries: any[] = [];
  const regions = ['US', 'TX', 'CA', 'NY', 'IL', 'FL'];
  const nationalBasePrices: Record<string, number> = {
    regular: 3.45, midgrade: 3.79, premium: 4.15, diesel: 3.65,
  };

  for (const region of regions) {
    const regionPrices = region === 'US' ? nationalBasePrices : (basePrices[region] || nationalBasePrices);

    for (const [fuelType, basePrice] of Object.entries(regionPrices)) {
      for (let day = 0; day < 90; day++) {
        const date = new Date(now);
        date.setDate(date.getDate() - day);
        date.setHours(0, 0, 0, 0);

        const variation = (Math.random() - 0.5) * 0.15;
        const trendAdjustment = day * 0.002;
        const avgPrice = Number((basePrice + variation - trendAdjustment).toFixed(3));

        historyEntries.push({
          region,
          fuelType,
          avgPrice,
          minPrice: Number((avgPrice - 0.15).toFixed(3)),
          maxPrice: Number((avgPrice + 0.15).toFixed(3)),
          sampleSize: Math.floor(Math.random() * 500) + 100,
          source: 'api_eia',
          recordedDate: date,
          weekNumber: Math.ceil((90 - day) / 7),
          monthNumber: date.getMonth() + 1,
          year: date.getFullYear(),
        });
      }
    }
  }

  await PriceHistory.insertMany(historyEntries);
  logger.info(`✅ Seeded ${historyEntries.length} price history entries`);

  // ---- Seed Admin User ----
  const adminExists = await User.findOne({ email: 'admin@gassync.app' });
  if (!adminExists) {
    await User.create({
      email: 'admin@gassync.app',
      password: 'Admin@123456',
      displayName: 'GasSync Admin',
      role: 'admin',
      preferredFuelType: 'regular',
      defaultZipCode: '77002',
      defaultState: 'TX',
      isEmailVerified: true,
    });
    logger.info('✅ Seeded admin user (admin@gassync.app / Admin@123456)');
  }

  // ---- Seed Demo User ----
  const demoExists = await User.findOne({ email: 'demo@gassync.app' });
  if (!demoExists) {
    await User.create({
      email: 'demo@gassync.app',
      password: 'Demo@123456',
      displayName: 'Demo User',
      role: 'user',
      preferredFuelType: 'regular',
      defaultZipCode: '77056',
      defaultState: 'TX',
      isEmailVerified: true,
    });
    logger.info('✅ Seeded demo user (demo@gassync.app / Demo@123456)');
  }

  logger.info('🎉 Database seeding complete!');
}

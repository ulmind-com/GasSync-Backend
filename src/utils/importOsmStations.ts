// ============================================================
// GasSync Backend - USA Gas Station Importer (OpenStreetMap)
// ============================================================
// One-time / periodic bulk import of every US gas station (amenity=fuel)
// from OpenStreetMap into the GasStation collection. FREE + legal to store
// (ODbL — attribution shown in the app). Stations are served from our DB so
// the app never calls a paid Places API for discovery.
//
// Usage:
//   npx tsx src/utils/importOsmStations.ts          # all states
//   npx tsx src/utils/importOsmStations.ts DE PA     # only these states
// ============================================================

import mongoose from 'mongoose';
import axios from 'axios';
import config from '../config/index';
import GasStation from '../models/GasStation';
import { logger } from '../utils/logger';

// Multiple Overpass mirrors for failover
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// 50 states + DC
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildAddress(tags: Record<string, string>): string {
  const line1 = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ').trim();
  return [line1, tags['addr:city'], tags['addr:state'], tags['addr:postcode']]
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join(', ');
}

function deriveAmenities(tags: Record<string, string>): string[] {
  const a: string[] = [];
  if (tags['car_wash'] === 'yes' || tags['amenity'] === 'car_wash') a.push('car_wash');
  if (tags['shop'] === 'convenience' || tags['shop']) a.push('convenience_store');
  if (tags['compressed_air'] === 'yes') a.push('air_pump');
  if (tags['toilets'] === 'yes') a.push('restroom');
  if (tags['fuel:diesel'] === 'yes') a.push('diesel');
  return a;
}

// Map one OSM element to a GasStation upsert op
function toUpsertOp(el: any, stateCode: string) {
  const tags: Record<string, string> = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;

  const brand = tags.brand || tags.operator || '';
  const name = tags.name || brand || 'Gas Station';
  const externalId = `${el.type}/${el.id}`;

  return {
    updateOne: {
      filter: { externalId },
      update: {
        $set: {
          externalId,
          name,
          brand,
          address: buildAddress(tags),
          city: tags['addr:city'] || '',
          state: (tags['addr:state'] || stateCode).slice(0, 2).toUpperCase(),
          zipCode: tags['addr:postcode'] || '',
          location: { type: 'Point', coordinates: [Number(lon), Number(lat)] },
          amenities: deriveAmenities(tags),
          operatingHours: {
            open: '06:00',
            close: '22:00',
            is24Hours: tags.opening_hours === '24/7',
          },
          phone: tags.phone || tags['contact:phone'] || null,
          isActive: true,
        },
      },
      upsert: true,
    },
  };
}

async function fetchState(stateCode: string): Promise<any[]> {
  const query = `
    [out:json][timeout:600];
    area["ISO3166-2"="US-${stateCode}"][admin_level=4]->.a;
    nwr["amenity"="fuel"](area.a);
    out center tags;
  `;

  let lastErr: any;
  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length * 2; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const res = await axios.post(endpoint, `data=${encodeURIComponent(query)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: '*/*',
          'User-Agent': 'GasSyncImporter/1.0 (contact: gassync)',
        },
        timeout: 620000,
      });
      return res.data?.elements || [];
    } catch (err: any) {
      lastErr = err;
      const wait = 5000 * (attempt + 1);
      logger.warn(`[import] ${stateCode} attempt ${attempt + 1} failed (${err?.response?.status || err?.message}); retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

export async function importUsaStations(states: string[] = US_STATES): Promise<void> {
  let grandTotal = 0;
  for (let i = 0; i < states.length; i++) {
    const stateCode = states[i];
    try {
      logger.info(`[import] (${i + 1}/${states.length}) Fetching ${stateCode} from Overpass…`);
      const elements = await fetchState(stateCode);

      const ops = elements
        .map((el) => toUpsertOp(el, stateCode))
        .filter((op): op is NonNullable<typeof op> => op !== null);

      // bulkWrite in chunks to stay within Mongo limits
      let written = 0;
      const CHUNK = 1000;
      for (let c = 0; c < ops.length; c += CHUNK) {
        const slice = ops.slice(c, c + CHUNK);
        if (slice.length) {
          await GasStation.bulkWrite(slice as any[], { ordered: false });
          written += slice.length;
        }
      }
      grandTotal += written;
      logger.info(`[import] ✅ ${stateCode}: ${written} stations upserted (running total ${grandTotal})`);
    } catch (err: any) {
      logger.error(`[import] ❌ ${stateCode} failed permanently: ${err?.message || err}`);
    }

    // Be polite to Overpass between states
    if (i < states.length - 1) await sleep(4000);
  }
  logger.info(`[import] 🎉 Done. Total stations upserted: ${grandTotal}`);
}

// Run directly
if (require.main === module) {
  (async () => {
    const argStates = process.argv.slice(2).map((s) => s.toUpperCase()).filter((s) => US_STATES.includes(s));
    const states = argStates.length ? argStates : US_STATES;
    try {
      mongoose.set('strictQuery', true);
      await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10000 });
      logger.info(`[import] Connected to MongoDB. Importing ${states.length} state(s): ${states.join(', ')}`);
      await importUsaStations(states);
    } catch (err) {
      logger.error('[import] Fatal:', err);
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
      logger.info('[import] MongoDB disconnected.');
    }
  })();
}

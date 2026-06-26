const mongoose = require('mongoose');
const axios = require('axios');
const API_KEY = 'AIzaSyCe6KCXl5MO1INT16N9I_kiMwXxwZHJc8o';
const MONGODB_URI = 'mongodb+srv://gassync1980_db_user:h7FPYFSfy3w4MKDo@cluster0.39juc9u.mongodb.net/gassync?appName=Cluster0&retryWrites=true&w=majority';

async function backfill() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  
  const bills = await db.collection('bills').find({ location: { $exists: false }, googlePlaceId: { $ne: null } }).toArray();
  console.log(`Found ${bills.length} bills to backfill...`);
  
  for (let bill of bills) {
    try {
      const res = await axios.get(`https://places.googleapis.com/v1/places/${bill.googlePlaceId}?fields=location`, {
        headers: { 'X-Goog-Api-Key': API_KEY }
      });
      const loc = res.data.location;
      if (loc) {
        await db.collection('bills').updateOne(
          { _id: bill._id },
          { $set: { location: { type: 'Point', coordinates: [loc.longitude, loc.latitude] } } }
        );
        console.log(`Updated bill ${bill._id} with location [${loc.longitude}, ${loc.latitude}]`);
      }
    } catch (e) {
      console.log(`Error updating ${bill._id}:`, e.message);
    }
  }
  
  // Create 2dsphere index
  await db.collection('bills').createIndex({ location: '2dsphere' });
  console.log('Created 2dsphere index on location field');
  
  await mongoose.disconnect();
}

backfill();

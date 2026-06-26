const axios = require('axios');

const API = 'https://gassync-backend.onrender.com/api/v1';

const stationIds = [
  'ChIJkReV7A2YAjoRaqsspNjPF2c',  // Hindustan Petroleum
  'ChIJN_46h5qZAjoRRO_UDbMijHg',  // IndianOil (3 bills in DB)
  'ChIJGZNmTMOiAjoRR3tw9XmHlyc',  // Hindustan Petroleum
  'ChIJE5XP596ZAjoR7L6sB5rSF5I',  // IndianOil SWAGAT
];

async function test() {
  for (const id of stationIds) {
    try {
      console.log(`\n========================================`);
      console.log(`Calling: /prices/by-place/${id}`);
      const res = await axios.get(`${API}/prices/by-place/${id}`, { timeout: 15000 });
      const data = res.data?.data;
      console.log(`  Status: ${res.status}`);
      console.log(`  Source: ${data?.source}`);
      console.log(`  Station: ${data?.stationName}`);
      console.log(`  Fuel Prices: ${data?.fuelPrices?.length || 0}`);
      console.log(`  Community Prices: ${data?.communityPrices?.length || 0}`);
      if (data?.communityPrices?.length > 0) {
        data.communityPrices.forEach((cp, i) => {
          console.log(`    [${i+1}] ${cp.reportedBy} — $${cp.price} — ${cp.fuelType} — ${cp.billDate}`);
        });
      } else {
        console.log(`  *** NO COMMUNITY DATA RETURNED ***`);
      }
      console.log(`  Full response message: ${res.data?.message}`);
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      if (err.response) {
        console.log(`  Response status: ${err.response.status}`);
        console.log(`  Response data:`, JSON.stringify(err.response.data).slice(0, 200));
      }
    }
  }
}

test();

const axios = require('axios');

const API = 'https://gassync-backend.onrender.com/api/v1';

async function test() {
  const placeIds = [
    'ChIJkReV7A2YAjoRaqsspNjPF2c',
    'ChIJN_46h5qZAjoRRO_UDbMijHg',
    'ChIJGZNmTMOiAjoRR3tw9XmHlyc',
    'ChIJE5XP596ZAjoR7L6sB5rSF5I',
  ];

  console.log('Testing bulk community endpoint...\n');
  
  try {
    const res = await axios.post(`${API}/prices/community/by-places`, { placeIds }, { timeout: 15000 });
    const data = res.data?.data || [];
    console.log(`Status: ${res.status}`);
    console.log(`Total community prices: ${data.length}\n`);
    
    data.forEach((cp, i) => {
      console.log(`[${i+1}] ${cp.stationName} — $${cp.price} — ${cp.fuelType}`);
      console.log(`    reportedBy: ${cp.reportedBy}`);
      console.log(`    stationId: ${cp.stationId}`);
      console.log(`    billDate: ${cp.billDate}\n`);
    });
  } catch (err) {
    console.log('ERROR:', err.message);
    if (err.response) {
      console.log('Response:', JSON.stringify(err.response.data).slice(0, 500));
    }
  }
}

test();

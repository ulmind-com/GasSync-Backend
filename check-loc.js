const axios = require('axios');
const API_KEY = 'AIzaSyCe6KCXl5MO1INT16N9I_kiMwXxwZHJc8o';

const ids = [
  'ChIJkReV7A2YAjoRaqsspNjPF2c',
  'ChIJN_46h5qZAjoRRO_UDbMijHg',
  'ChIJGZNmTMOiAjoRR3tw9XmHlyc',
  'ChIJE5XP596ZAjoR7L6sB5rSF5I'
];

async function check() {
  for (let id of ids) {
    try {
      const res = await axios.get(`https://places.googleapis.com/v1/places/${id}?fields=displayName,location,formattedAddress`, {
        headers: { 'X-Goog-Api-Key': API_KEY }
      });
      console.log(`${id}:`);
      console.log(`  Name:`, res.data.displayName?.text);
      console.log(`  Address:`, res.data.formattedAddress);
      console.log(`  Loc:`, res.data.location);
    } catch (e) {
      console.log(`${id} ERROR:`, e.response?.status);
    }
  }
}
check();

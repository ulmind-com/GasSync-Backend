const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://gassync1980_db_user:h7FPYFSfy3w4MKDo@cluster0.39juc9u.mongodb.net/gassync?appName=Cluster0&retryWrites=true&w=majority';

async function check() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('gassync');
    
    // 1. Total bills count
    const totalBills = await db.collection('bills').countDocuments();
    console.log(`\n=== TOTAL BILLS: ${totalBills} ===\n`);
    
    // 2. Bills by status
    const statusCounts = await db.collection('bills').aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray();
    console.log('Bills by status:');
    statusCounts.forEach(s => console.log(`  ${s._id}: ${s.count}`));
    
    // 3. Bills with googlePlaceId
    const withPlaceId = await db.collection('bills').countDocuments({ googlePlaceId: { $ne: null } });
    const withoutPlaceId = await db.collection('bills').countDocuments({ $or: [{ googlePlaceId: null }, { googlePlaceId: { $exists: false } }] });
    console.log(`\nWith googlePlaceId: ${withPlaceId}`);
    console.log(`Without googlePlaceId: ${withoutPlaceId}`);
    
    // 4. Bills that qualify for community (extracted/verified + pricePerGallon)
    const communityEligible = await db.collection('bills').countDocuments({
      status: { $in: ['extracted', 'verified'] },
      pricePerGallon: { $ne: null },
      googlePlaceId: { $ne: null },
    });
    console.log(`\nCommunity eligible (extracted/verified + price + placeId): ${communityEligible}`);
    
    // 5. Show all community eligible bills with details
    const eligibleBills = await db.collection('bills').find({
      status: { $in: ['extracted', 'verified'] },
      pricePerGallon: { $ne: null },
    }).project({
      _id: 1, googlePlaceId: 1, stationName: 1, pricePerGallon: 1, 
      status: 1, fuelType: 1, billDate: 1, totalAmount: 1
    }).sort({ billDate: -1 }).limit(20).toArray();
    
    console.log(`\n=== COMMUNITY ELIGIBLE BILLS (last 20) ===`);
    eligibleBills.forEach((b, i) => {
      console.log(`\n[${i+1}] ID: ${b._id}`);
      console.log(`    googlePlaceId: ${b.googlePlaceId || 'NULL/MISSING'}`);
      console.log(`    stationName: ${b.stationName}`);
      console.log(`    price: $${b.pricePerGallon}`);
      console.log(`    status: ${b.status}`);
      console.log(`    fuelType: ${b.fuelType}`);
      console.log(`    billDate: ${b.billDate}`);
    });

    // 6. Show ALL bills (even without price) to see full picture
    console.log(`\n=== ALL BILLS (last 10) ===`);
    const allBills = await db.collection('bills').find({})
      .project({
        _id: 1, googlePlaceId: 1, stationName: 1, pricePerGallon: 1, 
        status: 1, fuelType: 1, billDate: 1
      }).sort({ createdAt: -1 }).limit(10).toArray();
    
    allBills.forEach((b, i) => {
      console.log(`\n[${i+1}] ID: ${b._id}`);
      console.log(`    googlePlaceId: ${b.googlePlaceId || 'NULL/MISSING'}`);
      console.log(`    stationName: ${b.stationName || 'N/A'}`);
      console.log(`    price: ${b.pricePerGallon != null ? '$'+b.pricePerGallon : 'NULL'}`);
      console.log(`    status: ${b.status}`);
    });

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

check();

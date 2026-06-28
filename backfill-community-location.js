// ============================================================
// One-time backfill: copy station name / place / GPS from the
// originating Bill onto community GasPrice posts that are missing it.
// Community posts created from bills never stored location info, so the
// admin panel showed "Unknown Location" for all of them.
//
// Run once:  node backfill-community-location.js
// ============================================================

const { MongoClient } = require('mongodb');

const uri =
  process.env.MONGODB_URI ||
  'mongodb+srv://gassync1980_db_user:h7FPYFSfy3w4MKDo@cluster0.39juc9u.mongodb.net/gassync?appName=Cluster0&retryWrites=true&w=majority';

const round = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);
const sameDay = (a, b) => {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return Math.abs(da.getTime() - db.getTime()) <= 36 * 60 * 60 * 1000; // within ~1.5 days
};

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('gassync');
  const gasprices = db.collection('gasprices');
  const bills = db.collection('bills');

  // Community posts from bills that still have no station name.
  const posts = await gasprices
    .find({
      source: { $in: ['user_bill', 'user_report'] },
      $or: [{ stationName: { $exists: false } }, { stationName: null }],
    })
    .toArray();

  console.log(`Found ${posts.length} community posts missing location info.`);

  let updated = 0;
  let unmatched = 0;

  for (const post of posts) {
    // Find candidate bills from the same user with a price.
    const candidates = await bills
      .find({ user: post.reportedBy, pricePerGallon: { $ne: null } })
      .toArray();

    // Best match: same fuelType + same price (3dp) + close date.
    let match =
      candidates.find(
        (b) =>
          b.fuelType === post.fuelType &&
          round(b.pricePerGallon) === round(post.price) &&
          sameDay(b.billDate, post.recordedAt)
      ) ||
      // Relax the date constraint.
      candidates.find(
        (b) => b.fuelType === post.fuelType && round(b.pricePerGallon) === round(post.price)
      ) ||
      // Relax to just price.
      candidates.find((b) => round(b.pricePerGallon) === round(post.price));

    if (!match) {
      unmatched++;
      console.log(`  - No bill match for post ${post._id} (${post.fuelType} $${post.price})`);
      continue;
    }

    const set = {};
    if (match.stationName) set.stationName = match.stationName;
    if (match.stationAddress) set.stationAddress = match.stationAddress;
    if (match.googlePlaceId) set.googlePlaceId = match.googlePlaceId;
    if (
      match.location &&
      Array.isArray(match.location.coordinates) &&
      match.location.coordinates.length === 2
    ) {
      set.location = { type: 'Point', coordinates: match.location.coordinates };
    }

    if (Object.keys(set).length === 0) {
      unmatched++;
      continue;
    }

    await gasprices.updateOne({ _id: post._id }, { $set: set });
    updated++;
    console.log(`  ✓ ${post._id} -> ${set.stationName || '(no name)'} ${set.location ? '+GPS' : ''}`);
  }

  console.log(`\nDone. Updated ${updated}, unmatched ${unmatched}.`);
  await client.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

const mongoose = require('mongoose');
const mongoUri = 'mongodb+srv://gassync1980_db_user:h7FPYFSfy3w4MKDo@cluster0.39juc9u.mongodb.net/gassync?appName=Cluster0&retryWrites=true&w=majority';
async function checkDb() {
  await mongoose.connect(mongoUri);
  const users = await mongoose.connection.db.collection('users').find({}).toArray();
  users.forEach(u => console.log(u.email, u.expoPushToken));
  await mongoose.disconnect();
}
checkDb();

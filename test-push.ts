import mongoose from 'mongoose';
import { Expo } from 'expo-server-sdk';
import User from './src/models/User';

async function testPush() {
  const email = 'banerjeesoumyajit2011@gmail.com';
  const mongoUri = 'mongodb+srv://gassync1980_db_user:h7FPYFSfy3w4MKDo@cluster0.39juc9u.mongodb.net/gassync?appName=Cluster0&retryWrites=true&w=majority';

  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.log('User not found!');
      process.exit(1);
    }
    
    console.log('User found:', user.email);
    console.log('Push token:', user.expoPushToken);

    if (!user.expoPushToken) {
      console.log('User does not have an expoPushToken!');
      process.exit(1);
    }

    const expo = new Expo();
    
    if (!Expo.isExpoPushToken(user.expoPushToken)) {
      console.log('Invalid Expo push token:', user.expoPushToken);
      process.exit(1);
    }

    const messages = [{
      to: user.expoPushToken,
      sound: 'default',
      title: 'GasSync Final Test',
      body: 'Bhai, eta asol test notification! Ekebare sada logo er sathe!',
      data: { withSome: 'data' },
    }];

    // @ts-ignore
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (let chunk of chunks) {
      try {
        let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        console.log('Ticket chunk:', ticketChunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending chunk:', error);
      }
    }

    console.log('Push notification sent!');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

testPush();

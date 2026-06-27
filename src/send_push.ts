import mongoose from 'mongoose';
import { Expo } from 'expo-server-sdk';
import User from './models/User';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function sendPush() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('MONGODB_URI is not defined');
    
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const email = 'banerjeesoumyajit01@gmail.com';
    const user = await User.findOne({ email });

    if (!user) {
      console.log(`User ${email} not found.`);
      process.exit(1);
    }

    if (!user.expoPushToken) {
      console.log(`User ${email} has no expoPushToken set.`);
      process.exit(1);
    }

    console.log(`Sending push notification to token: ${user.expoPushToken}`);

    const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
    const messages = [];

    if (!Expo.isExpoPushToken(user.expoPushToken)) {
      console.error(`Push token ${user.expoPushToken} is not a valid Expo push token`);
      process.exit(1);
    }

    messages.push({
      to: user.expoPushToken,
      sound: 'default',
      title: 'Hello from GasSync!',
      body: 'This is a test push notification sent directly to your device.',
      data: { test: true },
    });

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        console.log('Push tickets:', ticketChunk);
      } catch (error) {
        console.error('Error sending push chunk:', error);
      }
    }

    console.log('Push notification sent successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

sendPush();

import { Expo } from 'expo-server-sdk';

async function sendTestPush() {
  const expo = new Expo();
  const token = 'ExponentPushToken[1XoniWH6_yj302uo1AzN5U]';
  
  const messages = [{
    to: token,
    sound: 'default',
    title: 'GasSync Updates',
    body: 'Bhai, eta test notification! Kaj korche!',
    data: { withSome: 'data' },
  }];

  try {
    // @ts-ignore
    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log('Ticket chunk:', ticketChunk);
    }
    console.log('Push notification sent successfully!');
  } catch (error) {
    console.error('Error sending:', error);
  }
}

sendTestPush();

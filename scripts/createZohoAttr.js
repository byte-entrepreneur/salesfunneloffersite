import dotenv from 'dotenv';
import { Client, Databases } from 'node-appwrite';

dotenv.config();

async function main() {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);
  const dbId = process.env.ORDERS_DATABASE_ID || 'ordersDB';
  const collId = process.env.ORDERS_COLLECTION_ID;
  if (!collId) {
    console.error('ORDERS_COLLECTION_ID missing in .env');
    process.exit(2);
  }

  try {
    console.log('Creating string attribute zohoLastResponse (length 4096) on', dbId, collId);
    await databases.createStringAttribute(dbId, collId, 'zohoLastResponse', 4096, false);
    console.log('Attribute created (or already existed).');
  } catch (err) {
    console.error('Failed to create attribute:', err.message || err);
    process.exit(1);
  }
}

main();

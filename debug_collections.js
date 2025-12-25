import { Client, Databases } from 'node-appwrite';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);

async function debugCollections() {
  try {
    console.log('=== APPWRITE DEBUG ===');
    console.log('Project ID:', process.env.APPWRITE_PROJECT_ID);
    console.log('Signups Database ID:', process.env.SIGNUPS_DATABASE_ID);
    console.log('Signups Collection ID from env:', process.env.SIGNUPS_COLLECTION_ID);
    console.log('');

    // List all collections in the signups database
    console.log('=== COLLECTIONS IN SIGNUPS DATABASE ===');
    try {
      const collections = await databases.listCollections(process.env.SIGNUPS_DATABASE_ID);
      console.log('Found', collections.collections.length, 'collections:');
      
      collections.collections.forEach((collection, index) => {
        console.log(`${index + 1}. Name: "${collection.name}", ID: "${collection.$id}"`);
        console.log(`   Created: ${collection.$createdAt}`);
        console.log(`   Attributes: ${collection.attributes.length} fields`);
        collection.attributes.forEach(attr => {
          console.log(`     - ${attr.key} (${attr.type}${attr.required ? ', required' : ''})`);
        });
        console.log('');
      });
    } catch (e) {
      console.error('Error listing collections:', e.message);
    }

    // Try to get documents from the current SIGNUPS_COLLECTION_ID setting
    console.log('=== TESTING CURRENT SIGNUPS_COLLECTION_ID ===');
    try {
      const docs = await databases.listDocuments(
        process.env.SIGNUPS_DATABASE_ID, 
        process.env.SIGNUPS_COLLECTION_ID,
        [], // queries
        25   // limit
      );
      
      console.log(`Found ${docs.documents.length} documents in "${process.env.SIGNUPS_COLLECTION_ID}"`);
      
      if (docs.documents.length > 0) {
        console.log('Sample document structure:');
        const sample = docs.documents[0];
        Object.keys(sample).forEach(key => {
          if (key.startsWith('$')) {
            console.log(`  ${key}: ${sample[key]}`);
          } else {
            const value = sample[key];
            const displayValue = typeof value === 'string' && value.length > 50 
              ? value.substring(0, 50) + '...' 
              : value;
            console.log(`  ${key}: ${displayValue}`);
          }
        });
      }
    } catch (e) {
      console.error('Error accessing current SIGNUPS_COLLECTION_ID:', e.message);
    }

    // Look for documents that might contain signup data
    console.log('=== SEARCHING FOR SIGNUP-LIKE DOCUMENTS ===');
    for (const collection of (await databases.listCollections(process.env.SIGNUPS_DATABASE_ID)).collections) {
      try {
        const docs = await databases.listDocuments(
          process.env.SIGNUPS_DATABASE_ID,
          collection.$id,
          [],
          5
        );
        
        if (docs.documents.length > 0) {
          const sample = docs.documents[0];
          const hasEmail = 'email' in sample;
          const hasName = 'name' in sample;
          const hasPageEnterAt = 'pageEnterAt' in sample;
          
          if (hasEmail || hasName || hasPageEnterAt) {
            console.log(`Collection "${collection.name}" (${collection.$id}) looks like signup data:`);
            console.log(`  - Has email: ${hasEmail}`);
            console.log(`  - Has name: ${hasName}`);
            console.log(`  - Has pageEnterAt: ${hasPageEnterAt}`);
            console.log(`  - Document count: ${docs.documents.length}`);
            console.log('');
          }
        }
      } catch (e) {
        console.log(`Could not access collection ${collection.name}: ${e.message}`);
      }
    }

  } catch (error) {
    console.error('Debug error:', error);
  }
}

debugCollections().then(() => {
  console.log('Debug complete');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
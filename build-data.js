// build-data.js - Fetches Firebase data and saves to static JSON files
const https = require('https');
const fs = require('fs');

const FIREBASE_PROJECT_ID = 'aqm5-monitor';
const FIREBASE_API_KEY = 'AIzaSyDidlQ5bxhaOOqwtxgL2ockq1nY3wmwmMw';

function fetchFirestore(path) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}?key=${FIREBASE_API_KEY}`;
    
    console.log(`Fetching: ${path}`);
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', chunk => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          console.error('Parse error:', e.message);
          reject(e);
        }
      });
    }).on('error', (e) => {
      console.error('Request error:', e.message);
      reject(e);
    });
  });
}

function parseFirestoreValue(field) {
  if (!field) return null;
  if (field.integerValue !== undefined) return parseInt(field.integerValue);
  if (field.doubleValue !== undefined) return parseFloat(field.doubleValue);
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.timestampValue !== undefined) return field.timestampValue;
  return null;
}

async function main() {
  console.log('\n=================================');
  console.log('🔥 Starting Firebase data fetch');
  console.log('=================================\n');
  
  try {
    // Fetch current reading
    console.log('📊 Step 1: Fetching current data...');
    const currentDoc = await fetchFirestore('airquality/current');
    
    if (!currentDoc.fields) {
      throw new Error('No fields in current document');
    }
    
    const currentData = {
      pm1_0: parseFirestoreValue(currentDoc.fields.pm1_0),
      pm2_5: parseFirestoreValue(currentDoc.fields.pm2_5),
      pm10: parseFirestoreValue(currentDoc.fields.pm10),
      timestamp: parseFirestoreValue(currentDoc.fields.timestamp)
    };
    
    fs.writeFileSync('current-data.json', JSON.stringify(currentData, null, 2));
    console.log('✅ Saved current-data.json');
    console.log(`   PM2.5: ${currentData.pm2_5} µg/m³`);
    
    // Fetch history (last 7 days)
    console.log('\n📈 Step 2: Fetching history data...');
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const historyResponse = await fetchFirestore('history?pageSize=10000');
    
    const historyData = [];
    if (historyResponse.documents) {
      console.log(`   Found ${historyResponse.documents.length} documents`);
      
      for (const doc of historyResponse.documents) {
        const timestamp = parseFirestoreValue(doc.fields?.timestamp);
        
        // Only include last 7 days
        if (timestamp && new Date(timestamp) > new Date(sevenDaysAgo)) {
          historyData.push({
            pm1_0: parseFirestoreValue(doc.fields?.pm1_0),
            pm2_5: parseFirestoreValue(doc.fields?.pm2_5),
            pm10: parseFirestoreValue(doc.fields?.pm10),
            timestamp: timestamp
          });
        }
      }
    }
    
    fs.writeFileSync('history-data.json', JSON.stringify(historyData, null, 2));
    console.log(`✅ Saved history-data.json`);
    console.log(`   ${historyData.length} data points (last 7 days)`);
    
    console.log('\n=================================');
    console.log('✅ Build successful!');
    console.log('=================================\n');
    
  } catch (error) {
    console.error('\n=================================');
    console.error('❌ Build failed!');
    console.error('=================================');
    console.error('Error:', error.message);
    console.error('\n');
    
    // Create empty/default files so build doesn't completely fail
    console.log('Creating fallback data files...');
    fs.writeFileSync('current-data.json', JSON.stringify({ 
      pm1_0: 0, 
      pm2_5: 0, 
      pm10: 0, 
      timestamp: new Date().toISOString() 
    }, null, 2));
    fs.writeFileSync('history-data.json', JSON.stringify([], null, 2));
    
    process.exit(1);
  }
}

main();
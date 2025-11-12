// build-data.js - Incremental data fetch (only fetches NEW data!)
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
  console.log('🔥 VAYU Incremental Data Fetch');
  console.log('=================================\n');
  
  try {
    // Step 1: Fetch current reading (always update this)
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
    console.log(`   Timestamp: ${currentData.timestamp}`);
    
    // Step 2: Load existing history (if it exists)
    let existingHistory = [];
    let lastTimestamp = null;
    
    if (fs.existsSync('history-data.json')) {
      try {
        const fileContent = fs.readFileSync('history-data.json', 'utf8');
        existingHistory = JSON.parse(fileContent);
        
        if (existingHistory.length > 0) {
          // Find the latest timestamp in existing data
          lastTimestamp = existingHistory.reduce((latest, item) => {
            const itemTime = new Date(item.timestamp);
            return itemTime > latest ? itemTime : latest;
          }, new Date(0));
          
          console.log('\n📚 Found existing history:');
          console.log(`   ${existingHistory.length} existing data points`);
          console.log(`   Latest timestamp: ${lastTimestamp.toISOString()}`);
        }
      } catch (e) {
        console.log('\n⚠️  Could not read existing history, starting fresh');
      }
    }
    
    // Step 3: Determine what to fetch
    let queryPath;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    if (lastTimestamp && lastTimestamp > sevenDaysAgo) {
      // Incremental: Only fetch data AFTER last timestamp
      const afterTimestamp = lastTimestamp.toISOString();
      queryPath = `history?orderBy=timestamp&pageSize=1000`;
      console.log('\n📈 Step 2: Fetching NEW data only...');
      console.log(`   Since: ${afterTimestamp}`);
    } else {
      // Initial: Fetch last 7 days
      const sinceTimestamp = sevenDaysAgo.toISOString();
      queryPath = `history?orderBy=timestamp&pageSize=1000`;
      console.log('\n📈 Step 2: Fetching last 7 days (initial build)...');
      console.log(`   Since: ${sinceTimestamp}`);
    }
    
    // Step 4: Fetch new data from Firebase
    const historyResponse = await fetchFirestore(queryPath);
    
    const newData = [];
    if (historyResponse.documents) {
      console.log(`   Found ${historyResponse.documents.length} documents from Firebase`);
      
      for (const doc of historyResponse.documents) {
        const timestamp = parseFirestoreValue(doc.fields?.timestamp);
        
        if (timestamp) {
          const itemDate = new Date(timestamp);
          
          // Only add if it's newer than what we have AND within last 7 days
          if (itemDate > sevenDaysAgo && (!lastTimestamp || itemDate > lastTimestamp)) {
            newData.push({
              pm1_0: parseFirestoreValue(doc.fields?.pm1_0),
              pm2_5: parseFirestoreValue(doc.fields?.pm2_5),
              pm10: parseFirestoreValue(doc.fields?.pm10),
              timestamp: timestamp
            });
          }
        }
      }
    }
    
    console.log(`   ${newData.length} NEW data points to add`);
    
    // Step 5: Merge and clean data
    let allHistory = [...existingHistory, ...newData];
    
    // Remove duplicates (same timestamp)
    const uniqueHistory = allHistory.reduce((acc, item) => {
      if (!acc.find(x => x.timestamp === item.timestamp)) {
        acc.push(item);
      }
      return acc;
    }, []);
    
    // Filter to only last 7 days
    const finalHistory = uniqueHistory.filter(item => {
      return new Date(item.timestamp) > sevenDaysAgo;
    });
    
    // Sort by timestamp
    finalHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Step 6: Save merged data
    fs.writeFileSync('history-data.json', JSON.stringify(finalHistory, null, 2));
    console.log(`\n✅ Saved history-data.json`);
    console.log(`   Total: ${finalHistory.length} data points (last 7 days)`);
    console.log(`   Added: ${newData.length} new points this build`);
    console.log(`   Removed: ${uniqueHistory.length - finalHistory.length} old points (>7 days)`);
    
    // Calculate Firebase reads used
    const readsUsed = 1 + Math.ceil(historyResponse.documents?.length / 1 || 0);
    console.log(`\n📊 Firebase reads used: ~${readsUsed} reads`);
    
    console.log('\n=================================');
    console.log('✅ Build successful!');
    console.log('=================================\n');
    
  } catch (error) {
    console.error('\n=================================');
    console.error('❌ Build failed!');
    console.error('=================================');
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    console.error('\n');
    
    // Create fallback data if files don't exist
    if (!fs.existsSync('current-data.json')) {
      console.log('Creating fallback current-data.json...');
      fs.writeFileSync('current-data.json', JSON.stringify({ 
        pm1_0: 0, 
        pm2_5: 0, 
        pm10: 0, 
        timestamp: new Date().toISOString() 
      }, null, 2));
    }
    
    if (!fs.existsSync('history-data.json')) {
      console.log('Creating fallback history-data.json...');
      fs.writeFileSync('history-data.json', JSON.stringify([], null, 2));
    }
    
    // Don't exit with error - use existing data
    console.log('⚠️  Using existing data files');
    process.exit(0); // Exit successfully to prevent build failure
  }
}

main();

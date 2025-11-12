// build-data.js - TRULY incremental (but insecure) data fetch
const https = require('https'); // Use 'https' (built-in)
const fs = require('fs');

// --- WARNING: API KEY IS HARDCODED AND PUBLIC ---
const FIREBASE_PROJECT_ID = 'aqm5-monitor';
const FIREBASE_API_KEY = 'AIzaSyDidlQ5bxhaOOqwtxgL2ockq1nY3wmwmMw';
// --------------------------------------------------

const API_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

/**
 * Fetches a single document from Firestore.
 * @param {string} path The document path (e.g., "airquality/current")
 */
function getDocument(path) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE_URL}/${path}?key=${FIREBASE_API_KEY}`;
    console.log(`Fetching doc: ${path}`);
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Firebase Error: ${parsed.error.message}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse JSON for ${path}: ${e.message}`));
        }
      });
    }).on('error', (e) => reject(new Error(`Request error for ${path}: ${e.message}`)));
  });
}

/**
 * Runs a structured query to get ONLY new history data.
 * @param {string} timestampFilter The ISO 8601 timestamp to fetch data *after*.
 */
function runHistoryQuery(timestampFilter) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE_URL}:runQuery?key=${FIREBASE_API_KEY}`;
    
    // This is the structured query.
    // It's the same as "WHERE timestamp > lastTimestamp ORDER BY timestamp"
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: 'history' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'timestamp' },
            op: 'GREATER_THAN',
            value: { timestampValue: timestampFilter }
          }
        },
        orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'ASCENDING' }],
        limit: 1000 // Max 1000 new records per run (safety)
      }
    };
    
    const postData = JSON.stringify(queryBody);
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    console.log(`Running query: history WHERE timestamp > ${timestampFilter}`);

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Firebase Query Error: ${parsed.error.message}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse JSON for history query: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`Request error for history query: ${e.message}`)));
    req.write(postData); // Send the query in the request body
    req.end();
  });
}

/**
 * Helper to get the value from Firestore's data types.
 */
function parseFirestoreValue(field) {
  if (!field) return null;
  if (field.integerValue !== undefined) return parseInt(field.integerValue);
  if (field.doubleValue !== undefined) return parseFloat(field.doubleValue);
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.timestampValue !== undefined) return field.timestampValue;
  return null;
}

/**
 * Main function to run the build.
 */
async function main() {
  console.log('\n=================================');
  console.log('🔥 VAYU Incremental Data Fetch');
  console.log('=================================\n');
  
  try {
    // Step 1: Fetch current reading (always 1 read)
    console.log('📊 Step 1: Fetching current data...');
    const currentDoc = await getDocument('airquality/current');
    
    if (!currentDoc.fields) {
      throw new Error('No fields in current document. Check API key and security rules.');
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
    
    // Step 2: Load existing history
    let existingHistory = [];
    let lastTimestamp = null;
    const sevenDaysAgo = new Date(new Date().getTime() - 7 * 24 * 60 * 60 * 1000);

    if (fs.existsSync('history-data.json')) {
      try {
        existingHistory = JSON.parse(fs.readFileSync('history-data.json', 'utf8'));
        if (existingHistory.length > 0) {
          // Get timestamp from the *last* item (assuming it's sorted)
          lastTimestamp = existingHistory[existingHistory.length - 1].timestamp;
          console.log('\n📚 Found existing history:');
          console.log(`   ${existingHistory.length} existing data points`);
          console.log(`   Latest timestamp: ${lastTimestamp}`);
        }
      } catch (e) {
        console.log('\n⚠️ Could not read existing history, starting fresh');
      }
    }
    
    // Determine the query start time
    let queryStartTime;
    if (!lastTimestamp || new Date(lastTimestamp) < sevenDaysAgo) {
      console.log('   No recent data. Setting query start to 7 days ago.');
      queryStartTime = sevenDaysAgo.toISOString();
    } else {
      queryStartTime = lastTimestamp;
    }
    
    // Step 3: Fetch ONLY NEW data from Firebase
    console.log('\n📈 Step 2: Fetching NEW data only...');
    const historyResponse = await runHistoryQuery(queryStartTime);
    
    const newData = [];
    let readsUsed = 1; // 1 for the 'current' doc

    if (Array.isArray(historyResponse)) {
      historyResponse.forEach(item => {
        if (item.document) { // Regular query result
          const doc = item.document;
          const timestamp = parseFirestoreValue(doc.fields?.timestamp);
          
          if (timestamp) {
            newData.push({
              pm1_0: parseFirestoreValue(doc.fields?.pm1_0),
              pm2_5: parseFirestoreValue(doc.fields?.pm2_5),
              pm10: parseFirestoreValue(doc.fields?.pm10),
              timestamp: timestamp
            });
          }
        }
      });
      readsUsed += newData.length || 1; // +1 even if 0 results
    }
    
    console.log(`   ${newData.length} NEW data points found and added`);
    
    // Step 4: Merge, clean, and sort
    let allHistory = [...existingHistory, ...newData];
    
    // Filter to only last 7 days (removes old data)
    const finalHistory = allHistory.filter(item => {
      return new Date(item.timestamp) > sevenDaysAgo;
    });
    
    // Sort by timestamp (important for next run)
    finalHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Step 5: Save merged data
    fs.writeFileSync('history-data.json', JSON.stringify(finalHistory, null, 2));
    console.log(`\n✅ Saved history-data.json`);
    console.log(`   Total: ${finalHistory.length} data points (last 7 days)`);
    console.log(`   Removed: ${allHistory.length - finalHistory.length} old points (>7 days)`);
    
    console.log(`\n📊 Firebase reads used this run: ~${readsUsed} reads`);
    
    console.log('\n=================================');
    console.log('✅ Build successful!');
    console.log('=================================\n');
    
  } catch (error) {
    // --- FALLBACK ON ERROR ---
    console.error('\n=================================');
    console.error('❌ Build failed!');
    console.error('=================================');
    console.error('Error:', error.message);
    
    if (!fs.existsSync('current-data.json')) {
      fs.writeFileSync('current-data.json', JSON.stringify({ pm2_5: 0, timestamp: new Date().toISOString() }, null, 2));
    }
    if (!fs.existsSync('history-data.json')) {
      fs.writeFileSync('history-data.json', JSON.stringify([], null, 2));
    }
    
    console.log('⚠️ Created/used fallback data. Site will build, but data is stale.');
    process.exit(0); 
  }
}

main();

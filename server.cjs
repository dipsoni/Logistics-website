const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Load environment variables from .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim();
        }
      }
    });
  }
}
loadEnv();

const PORT = process.env.PORT || 5173;
const HOST = '127.0.0.1';
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'admin123';
const INQUIRIES_FILE = path.join(__dirname, 'inquiries.json');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// Helper: Load inquiries from inquiries.json
function loadInquiries() {
  try {
    if (fs.existsSync(INQUIRIES_FILE)) {
      const data = fs.readFileSync(INQUIRIES_FILE, 'utf-8');
      return JSON.parse(data || '[]');
    }
  } catch (err) {
    console.error('Error reading inquiries.json:', err.message);
  }
  return [];
}

// Helper: Save new inquiry to inquiries.json
function saveInquiry(record) {
  try {
    const inquiries = loadInquiries();
    inquiries.unshift(record); // Add newest inquiry first
    fs.writeFileSync(INQUIRIES_FILE, JSON.stringify(inquiries, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing to inquiries.json:', err.message);
  }
}

// Format recipient mobile number (+91 for 10-digit Indian numbers)
function formatRecipientNumber(phone) {
  if (!phone) return '+919274508210';
  let clean = phone.replace(/[\s\-\(\)]/g, '');
  if (/^[6-9]\d{9}$/.test(clean)) {
    return '+91' + clean;
  }
  if (/^91[6-9]\d{9}$/.test(clean)) {
    return '+' + clean;
  }
  return clean;
}

// Indian Mobile Number Validation Regex
function isValidIndianMobile(mobile) {
  const cleanMobile = mobile.replace(/[\s\-\(\)]/g, '');
  const indianRegex = /^(?:\+91|91|0)?[6-9]\d{9}$/;
  return indianRegex.test(cleanMobile);
}

// REAL WHATSAPP API INTEGRATION ENGINE
function sendWhatsAppMessage(toPhone, messageText) {
  return new Promise((resolve) => {
    const provider = (process.env.WHATSAPP_PROVIDER || 'callmebot').toLowerCase();
    const formattedPhone = formatRecipientNumber(toPhone);

    console.log(`\n[WhatsApp Engine] Initializing API call via provider: '${provider}' to ${formattedPhone}...`);

    if (provider === 'callmebot') {
      const apiKey = process.env.CALLMEBOT_API_KEY;
      if (!apiKey || apiKey.includes('your_')) {
        const msg = `CALLMEBOT_API_KEY not set in .env. Send "I allow callmebot to send me messages" to +34 644 44 42 74 on WhatsApp.`;
        console.error(`[CallMeBot Error] ${msg}`);
        return resolve({ success: false, provider: 'callmebot', error: msg });
      }

      const encodedText = encodeURIComponent(messageText);
      const requestUrl = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(formattedPhone)}&text=${encodedText}&apikey=${encodeURIComponent(apiKey)}`;

      https.get(requestUrl, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          console.log(`[CallMeBot HTTP ${res.statusCode}] Response Payload:`, responseData);
          const lower = responseData.toLowerCase();
          const isOk = res.statusCode >= 200 && res.statusCode < 300 && !lower.includes('invalid') && !lower.includes('error');
          resolve({
            success: isOk,
            provider: 'callmebot',
            statusCode: res.statusCode,
            responseBody: responseData.trim(),
            error: isOk ? null : responseData.trim()
          });
        });
      }).on('error', (err) => {
        console.error('[CallMeBot Network Error]', err.message);
        resolve({ success: false, provider: 'callmebot', error: err.message });
      });
      return;
    }

    if (provider === 'meta_cloud_api' || provider === 'meta') {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      if (!token || !phoneId || token.includes('your_')) {
        const msg = `WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID missing in .env.`;
        console.error(`[Meta Cloud API Error] ${msg}`);
        return resolve({ success: false, provider: 'meta', error: msg });
      }

      const postData = JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'text',
        text: { body: messageText }
      });

      const req = https.request({
        hostname: 'graph.facebook.com',
        path: `/v18.0/${phoneId}/messages`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          console.log(`[Meta Cloud API HTTP ${res.statusCode}] Response Payload:`, responseData);
          try {
            const parsed = JSON.parse(responseData);
            const messageId = parsed.messages && parsed.messages[0] ? parsed.messages[0].id : null;
            resolve({
              success: res.statusCode >= 200 && res.statusCode < 300 && !parsed.error,
              provider: 'meta',
              statusCode: res.statusCode,
              messageId: messageId,
              responseBody: responseData,
              error: parsed.error ? parsed.error.message : null
            });
          } catch (e) {
            resolve({ success: false, provider: 'meta', statusCode: res.statusCode, responseBody: responseData });
          }
        });
      });

      req.on('error', (err) => {
        console.error('[Meta Cloud API Error]', err.message);
        resolve({ success: false, provider: 'meta', error: err.message });
      });

      req.write(postData);
      req.end();
      return;
    }

    resolve({ success: false, provider, error: `Unknown WHATSAPP_PROVIDER '${provider}'` });
  });
}

const server = http.createServer((req, res) => {
  const reqUrl = req.url.split('?')[0];

  // 1. PUBLIC INQUIRY SUBMISSION ENDPOINT
  if (req.method === 'POST' && reqUrl === '/api/inquiry') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const { name, mobile } = data;

        if (!name || typeof name !== 'string' || name.trim().length < 2) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Please enter a valid full name (minimum 2 characters).' }));
        }

        if (!mobile || typeof mobile !== 'string' || !isValidIndianMobile(mobile)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Please enter a valid 10-digit Indian mobile number.' }));
        }

        const now = new Date();
        const submissionTime = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' });
        const isoDate = now.toISOString();
        const formattedDate = isoDate.split('T')[0];

        // Create persistent record
        const inquiryRecord = {
          id: `INQ-${now.getTime()}`,
          name: name.trim(),
          mobile: mobile.trim(),
          timestamp: isoDate,
          formattedDate: formattedDate,
          formattedTime: submissionTime
        };

        // Save to inquiries.json
        saveInquiry(inquiryRecord);

        const targetRecipient = process.env.MY_MOBILE_NUMBER || '9274508210';
        const formattedRecipient = formatRecipientNumber(targetRecipient);
        const notificationText = `🔔 New Customer Inquiry\n\nName: ${name.trim()}\nMobile: ${mobile.trim()}\nTime: ${submissionTime}`;

        console.log('\n==================================================');
        console.log('📬 NEW INQUIRY SAVED & NOTIFICATION TRIGGERED:');
        console.log(notificationText);
        console.log(`Target WhatsApp Recipient: ${formattedRecipient}`);
        console.log('==================================================');

        // Dispatch Real WhatsApp Message
        const whatsappResult = await sendWhatsAppMessage(formattedRecipient, notificationText);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          message: 'Thank you! We have received your inquiry. We will contact you shortly.',
          whatsappDelivery: {
            success: whatsappResult.success,
            provider: whatsappResult.provider,
            statusCode: whatsappResult.statusCode || null,
            messageId: whatsappResult.messageId || null,
            error: whatsappResult.error || null
          }
        }));

      } catch (err) {
        console.error('[API Server Error]', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'An unexpected error occurred.' }));
      }
    });
    return;
  }

  // 2. SECURE PRIVATE ADMIN INQUIRIES API (Passcode Protected)
  if (req.method === 'GET' && reqUrl === '/api/admin/inquiries') {
    const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
    const clientPasscode = req.headers['x-admin-passcode'] || urlParams.get('passcode');

    if (clientPasscode !== ADMIN_PASSCODE) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized access. Invalid passcode.' }));
    }

    const inquiries = loadInquiries();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, inquiries }));
  }

  // 3. ROUTING: /admin -> admin.html
  let filePath = path.join(__dirname, reqUrl === '/' ? 'index.html' : reqUrl);
  if (reqUrl === '/admin' || reqUrl === '/admin/') {
    filePath = path.join(__dirname, 'admin.html');
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, indexContent) => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(indexContent, 'utf-8');
        });
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Logistics Website server running at http://${HOST}:${PORT}/`);
  console.log(`Private Admin Portal at http://${HOST}:${PORT}/admin`);
  console.log(`Inquiry API active at http://${HOST}:${PORT}/api/inquiry`);
});

const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Bearer authentication middleware
const auth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const expectedToken = process.env.BEARER_TOKEN || 'your-secret-token';

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or invalid' });
  }

  const token = authHeader.split(' ')[1];
  if (token !== expectedToken) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  next();
};

// Create a directory for PDFs
const pdfDir = path.join(__dirname, 'pdfs');
fs.mkdir(pdfDir, { recursive: true }).catch(console.error);

app.use(express.json());
app.use('/pdfs', express.static(pdfDir));

// Convert HTML to PDF
app.post('/convert', auth, async (req, res) => {
  try {
    const html = req.body.html;
    if (!html) {
      return res.status(400).json({ error: 'HTML content is required' });
    }

    const browser = await puppeteer.launch({
      args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const fileName = `output-${Date.now()}.pdf`;
    const pdfPath = path.join(pdfDir, fileName);
    await page.pdf({
      path: pdfPath,
      format: 'Legal', // Larger page size as requested
      printBackground: true,
      margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
    });
    await browser.close();

    // Schedule deletion after 24 hours (86,400,000 ms)
    setTimeout(async () => {
      try {
        await fs.unlink(pdfPath);
        console.log(`Deleted ${pdfPath}`);
      } catch (err) {
        console.error(`Failed to delete ${pdfPath}:`, err);
      }
    }, 43200000);

    // Return public URL
    const pdfUrl = `${req.protocol}://${req.get('host')}/pdfs/${fileName}`;
    res.json({ pdfUrl });
  } catch (error) {
    console.error('Error generating PDF:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to generate PDF', details: error.message });
  }
});

// Periodic cleanup of old PDFs (runs every hour)
setInterval(async () => {
  try {
    const files = await fs.readdir(pdfDir);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(pdfDir, file);
      const stats = await fs.stat(filePath);
      if (now - stats.mtimeMs > 43200000) {
        await fs.unlink(filePath);
        console.log(`Deleted old file ${file}`);
      }
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}, 3600000);
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

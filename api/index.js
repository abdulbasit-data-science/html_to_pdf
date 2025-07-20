const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;
require('dotenv').config();
// Bearer authentication middleware
const auth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const expectedToken = process.env.BEARER_TOKEN ; // Default for local testing

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or invalid' });
  }

  const token = authHeader.split(' ')[1];
  if (token !== expectedToken) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  next();
};

// Create a directory for PDFs if it doesn't exist
const pdfDir = path.join(__dirname, 'pdfs');
fs.mkdir(pdfDir, { recursive: true }).catch(console.error);

app.use(express.json());

// Apply authentication to the /convert endpoint
app.post('/convert', auth, async (req, res) => {
  try {
    const html = req.body.html;
    if (!html) {
      return res.status(400).json({ error: 'HTML content is required' });
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const fileName = `output-${Date.now()}.pdf`;
    const pdfPath = path.join(pdfDir, fileName);
    await page.pdf({
      path: pdfPath,
      format: 'Legal', // Larger page size as per previous request
      printBackground: true
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
    console.error(error);
    res.status(500).json({ error: 'Failed to generate PDF' });
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
}, 7200000); // Run every hour

app.use('/pdfs', express.static(pdfDir));

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

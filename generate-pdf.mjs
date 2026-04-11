import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'itinerary-print.html');
const pdfPath = path.join(__dirname, 'Ireland_Trip_2026_Itinerary.pdf');

// Read HTML and strip external font link to avoid network timeout
let html = readFileSync(htmlPath, 'utf-8');
html = html.replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '');
html = html.replace(/<link[^>]*fonts\.gstatic[^>]*>/g, '');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-web-security'] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'domcontentloaded' });
await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
});
await browser.close();
console.log('PDF saved to:', pdfPath);

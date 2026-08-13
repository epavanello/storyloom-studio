import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { load as loadHtml } from 'cheerio';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Chapter } from '../core/schemas';
import { safePart } from './store';

type ParsedBook = { title: string; chapters: Chapter[] };

export async function parseBook(fileName: string, bytes: Uint8Array): Promise<ParsedBook> {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'epub') return parseEpub(fileName, bytes);
  if (extension === 'pdf') return parsePdf(fileName, bytes);
  return parseText(fileName, new TextDecoder().decode(bytes));
}

function cleanText(value: string) {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function chapter(id: string, order: number, title: string, text: string): Chapter {
  const cleaned = cleanText(text);
  return { id: safePart(id || `chapter-${order + 1}`), order, title: title.trim() || `Chapter ${order + 1}`, text: cleaned, characterCount: cleaned.length };
}

function parseText(fileName: string, input: string): ParsedBook {
  const text = cleanText(input);
  const heading = /^(?:chapter|capitolo|parte|part|book|libro)\s+[\divxlcdm]+[^\n]*$/gim;
  const matches = [...text.matchAll(heading)];
  const chapters: Chapter[] = [];
  if (matches.length) {
    matches.forEach((match, index) => {
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? text.length;
      const bodyStart = start + match[0].length;
      chapters.push(chapter(`chapter-${index + 1}`, index, match[0], text.slice(bodyStart, end)));
    });
  } else {
    const target = 14_000;
    let cursor = 0;
    while (cursor < text.length) {
      let end = Math.min(cursor + target, text.length);
      if (end < text.length) {
        const paragraph = text.lastIndexOf('\n\n', end);
        if (paragraph > cursor + target * 0.6) end = paragraph;
      }
      const index = chapters.length;
      chapters.push(chapter(`section-${index + 1}`, index, `Section ${index + 1}`, text.slice(cursor, end)));
      cursor = end;
    }
  }
  return { title: fileName.replace(/\.[^.]+$/, ''), chapters };
}

async function parsePdf(fileName: string, bytes: Uint8Array): Promise<ParsedBook> {
  const document = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return parseText(fileName, pages.join('\n\n'));
}

async function parseEpub(fileName: string, bytes: Uint8Array): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(bytes);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) throw new Error('Invalid EPUB: container.xml is missing');
  const container = parser.parse(containerXml);
  const rootfile = container.container.rootfiles.rootfile;
  const opfPath = Array.isArray(rootfile) ? rootfile[0]['@_full-path'] : rootfile['@_full-path'];
  const opfText = await zip.file(opfPath)?.async('text');
  if (!opfText) throw new Error('Invalid EPUB: package document is missing');
  const opf = parser.parse(opfText).package;
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifestItems = Array.isArray(opf.manifest.item) ? opf.manifest.item : [opf.manifest.item];
  const manifest = new Map(manifestItems.map((item: Record<string, string>) => [item['@_id'], item['@_href']]));
  const spineItems = Array.isArray(opf.spine.itemref) ? opf.spine.itemref : [opf.spine.itemref];
  const chapters: Chapter[] = [];
  for (const item of spineItems) {
    const href = manifest.get(item['@_idref']) as string | undefined;
    if (!href) continue;
    const html = await zip.file(`${base}${decodeURIComponent(href).split('#')[0]}`)?.async('text');
    if (!html) continue;
    const $ = loadHtml(html);
    $('script, style, nav').remove();
    const text = cleanText($('body').text());
    if (text.length < 80) continue;
    const title = cleanText($('h1, h2, h3, title').first().text()) || `Chapter ${chapters.length + 1}`;
    chapters.push(chapter(`chapter-${chapters.length + 1}`, chapters.length, title, text));
  }
  const metadataTitle = typeof opf.metadata?.['dc:title'] === 'string' ? opf.metadata['dc:title'] : fileName.replace(/\.[^.]+$/, '');
  return { title: metadataTitle, chapters };
}

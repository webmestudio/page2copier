/**
 * A tiny PDF writer, written from scratch so the extension ships no bundled
 * PDF library at all. It does exactly one job: wrap already rendered page
 * images into a valid PDF, optionally with clickable link areas.
 *
 * Images are embedded without re-encoding. A JPEG capture is copied in as a
 * DCTDecode stream byte for byte, and a lossless capture goes in as raw RGB
 * under FlateDecode. Nothing is redrawn, so what Chrome painted is what the
 * PDF contains.
 */

const PT_PER_INCH = 72;

const encoder = new TextEncoder();

function bytes(str) {
  return encoder.encode(str);
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function pdfString(value) {
  return `(${String(value).replace(/[\\()]/g, (c) => `\\${c}`).replace(/[\r\n]/g, ' ')})`;
}

function pdfDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}'${pad(abs % 60)}'`
  );
}

export async function deflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * @param {Object} doc
 * @param {Array} doc.pages    Page descriptors, see below.
 * @param {string} doc.title
 * @param {string} doc.subject Usually the source URL.
 *
 * A page descriptor looks like:
 * {
 *   widthPt, heightPt,             // paper size in points
 *   image: {
 *     data: Uint8Array,            // JPEG bytes or raw RGB
 *     format: 'jpeg' | 'rgb',
 *     width, height,               // pixel dimensions
 *     drawX, drawY, drawW, drawH   // placement in points, PDF origin bottom left
 *   },
 *   links: [{ rect: [x1, y1, x2, y2], url }]
 * }
 */
export async function buildPdf({ pages, title = '', subject = '', creator = 'Page2Copier' }) {
  const objects = [];           // 1-indexed object bodies
  const alloc = () => {
    objects.push(null);
    return objects.length;
  };

  const catalogId = alloc();
  const pagesId = alloc();
  const infoId = alloc();

  const pageIds = [];

  for (const page of pages) {
    const pageId = alloc();
    const contentId = alloc();
    const imageId = alloc();
    pageIds.push(pageId);

    const img = page.image;
    let streamData = img.data;
    let filter;
    let colorSpace = '/DeviceRGB';
    let bpc = 8;

    if (img.format === 'jpeg') {
      filter = '/DCTDecode';
    } else {
      streamData = await deflate(img.data);
      filter = '/FlateDecode';
    }
    if (img.format === 'gray') {
      colorSpace = '/DeviceGray';
    }

    const imageDict =
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace ${colorSpace} /BitsPerComponent ${bpc} /Filter ${filter} ` +
      `/Length ${streamData.length} >>`;

    objects[imageId - 1] = concat([
      bytes(`${imageDict}\nstream\n`),
      streamData,
      bytes('\nendstream'),
    ]);

    const content =
      `q\n${fmt(img.drawW)} 0 0 ${fmt(img.drawH)} ${fmt(img.drawX)} ${fmt(img.drawY)} cm\n` +
      `/Im0 Do\nQ\n`;
    const contentBytes = bytes(content);
    objects[contentId - 1] = concat([
      bytes(`<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      bytes('\nendstream'),
    ]);

    const annotIds = [];
    for (const link of page.links || []) {
      const annotId = alloc();
      annotIds.push(annotId);
      objects[annotId - 1] = bytes(
        `<< /Type /Annot /Subtype /Link /Border [0 0 0] ` +
          `/Rect [${link.rect.map(fmt).join(' ')}] ` +
          `/A << /Type /Action /S /URI /URI ${pdfString(link.url)} >> >>`
      );
    }

    const annots = annotIds.length ? ` /Annots [${annotIds.map((id) => `${id} 0 R`).join(' ')}]` : '';
    objects[pageId - 1] = bytes(
      `<< /Type /Page /Parent ${pagesId} 0 R ` +
        `/MediaBox [0 0 ${fmt(page.widthPt)} ${fmt(page.heightPt)}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> /ProcSet [/PDF /ImageC] >> ` +
        `/Contents ${contentId} 0 R${annots} >>`
    );
  }

  objects[catalogId - 1] = bytes(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = bytes(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds
      .map((id) => `${id} 0 R`)
      .join(' ')}] >>`
  );
  objects[infoId - 1] = bytes(
    `<< /Title ${pdfString(title)} /Subject ${pdfString(subject)} ` +
      `/Producer ${pdfString(creator)} /Creator ${pdfString(creator)} ` +
      `/CreationDate ${pdfString(pdfDate())} >>`
  );

  // Serialise with a cross reference table.
  const header = concat([
    bytes('%PDF-1.7\n%'),
    new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]),
    bytes('\n'),
  ]);
  const chunks = [header];
  let offset = header.length;
  const offsets = new Array(objects.length);

  for (let i = 0; i < objects.length; i += 1) {
    const body = objects[i] || bytes('<< >>');
    const prefix = bytes(`${i + 1} 0 obj\n`);
    const suffix = bytes('\nendobj\n');
    offsets[i] = offset;
    chunks.push(prefix, body, suffix);
    offset += prefix.length + body.length + suffix.length;
  }

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  xref +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n` +
    `startxref\n${offset}\n%%EOF\n`;
  chunks.push(bytes(xref));

  return concat(chunks);
}

function fmt(n) {
  const rounded = Math.round(Number(n) * 1000) / 1000;
  return Number.isFinite(rounded) ? String(rounded) : '0';
}

export { PT_PER_INCH };

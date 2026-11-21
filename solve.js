// Fast CSV reader: a drop-in replacement for csv-reader 1.0.0.
//
// Written from scratch in this session from the parsing spec in the
// competition's RULES.txt (BOM drop, LF/CRLF record ends, stray_cr,
// quoted fields with "" escapes, quote_junk, unterminated_quote re-read
// as unquoted, short_row/long_row padding/cutting, error {code, line, row}
// ordering). It returns exactly what csv-reader 1.0.0 returns for every
// input {text, header}: {columns, rows, errors}. Fields stay strings,
// never trimmed or converted.
//
// Speed strategy (vs the reference's one-character-at-a-time loop with
// per-character string concatenation):
//   - Unquoted fields are located with String.indexOf for ',' (native
//     memchr-speed scans) and cut out with a single slice; only the short
//     segment before the next comma is checked for a line break or a stray
//     CR, so a field costs a few short native scans instead of one JS step
//     per character.
//   - A quoted field's closing quote is found with one indexOf; a field
//     with no doubled quotes and no line break inside is a single slice.
//     Doubled quotes ("" -> ") are handled by joining a few segments,
//     and line breaks inside quotes are normalised only on the rare
//     fields that actually contain one.
//   - A stray CR outside quotes only costs a slow scan on the rare field
//     that contains one; the common path never touches it.
//   - No regex, no per-character function calls in the hot paths, no
//     intermediate per-character strings.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text (the record ends). */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1; // a U+FEFF at the very start is dropped

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // scanUnquoted's result, written there instead of allocating a [value, ended] pair per field.
  let outValue = '';
  let outEnded = 0;

  // Reads unquoted characters onto `prefix` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). It writes the field to outValue and how it ended to outEnded; the caller compares value.length
  // against prefix.length to count kept chars.
  //
  // Fast path: the next comma bounds the field, so only the short segment before it is checked for a line break
  // or a stray CR (a CR right before the LF is the CRLF ending). A segment holding a stray CR falls back to the
  // slow scan, which drops it and records the error.
  function scanUnquoted(prefix) {
    const iC = text.indexOf(',', pos);
    if (iC === -1) {
      // No comma left in the text: the field runs to the next LF or the end of the text.
      const iN = text.indexOf('\n', pos);
      if (iN === -1) {
        const seg = text.slice(pos);
        if (seg.indexOf('\r') === -1) {
          pos = n;
          outValue = prefix === '' ? seg : prefix + seg; outEnded = END; return;
        }
        return scanUnquotedSlow(prefix);
      }
      const seg = text.slice(pos, iN);
      const r = seg.indexOf('\r');
      if (r === -1) {
        pos = iN + 1;
        line += 1;
        outValue = prefix === '' ? seg : prefix + seg; outEnded = LINE_BREAK; return;
      }
      if (r === seg.length - 1) {
        // CRLF: the CR is the line ending, not part of the field.
        pos = iN + 1;
        line += 1;
        const v = seg.slice(0, -1);
        outValue = prefix === '' ? v : prefix + v; outEnded = LINE_BREAK; return;
      }
      return scanUnquotedSlow(prefix);
    }
    const seg = text.slice(pos, iC);
    const iN = seg.indexOf('\n');
    const r = seg.indexOf('\r');
    if (iN === -1) {
      if (r === -1) {
        pos = iC + 1;
        outValue = prefix === '' ? seg : prefix + seg; outEnded = COMMA; return;
      }
      return scanUnquotedSlow(prefix); // a stray CR before the comma
    }
    // A line break comes before the comma, so the field ends there.
    if (r === -1 || r > iN) {
      pos = pos + iN + 1;
      line += 1;
      const v = seg.slice(0, iN);
      outValue = prefix === '' ? v : prefix + v; outEnded = LINE_BREAK; return;
    }
    if (r === iN - 1) {
      // CRLF: the CR is the line ending, not part of the field.
      pos = pos + iN + 1;
      line += 1;
      const v = seg.slice(0, iN - 1);
      outValue = prefix === '' ? v : prefix + v; outEnded = LINE_BREAK; return;
    }
    return scanUnquotedSlow(prefix); // a stray CR before the line break
  }

  // Slow unquoted scan: the field holds a stray CR, which is dropped (stray_cr) and the field goes on.
  function scanUnquotedSlow(prefix) {
    let parts = prefix !== '' ? [prefix] : null;
    let start = pos;
    for (;;) {
      const iComma = text.indexOf(',', pos);
      const iLF = text.indexOf('\n', pos);
      const iCR = text.indexOf('\r', pos);
      let m = -1;
      let kind = -1; // 0 comma, 1 LF, 2 CR
      if (iComma !== -1) {
        m = iComma;
        kind = 0;
      }
      if (iLF !== -1 && (m === -1 || iLF < m)) {
        m = iLF;
        kind = 1;
      }
      if (iCR !== -1 && (m === -1 || iCR < m)) {
        m = iCR;
        kind = 2;
      }
      if (m === -1) {
        const tail = text.slice(start);
        pos = n;
        outValue = parts === null ? tail : parts.join('') + tail; outEnded = END; return;
      }
      if (kind === 2 && text.charCodeAt(m + 1) !== 10) {
        // A CR not followed by LF is dropped (stray_cr) and the field goes on.
        if (parts === null) parts = [];
        parts.push(text.slice(start, m));
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos = m + 1;
        start = m + 1;
        continue;
      }
      const seg = text.slice(start, m);
      const value = parts === null ? seg : parts.join('') + seg;
      if (kind === 0) {
        pos = m + 1;
        outValue = value; outEnded = COMMA; return;
      }
      if (kind === 1) {
        pos = m + 1;
        line += 1;
        outValue = value; outEnded = LINE_BREAK; return;
      }
      pos = m + 2; // CRLF
      line += 1;
      outValue = value; outEnded = LINE_BREAK; return;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let lastQuoted = false;
    do {
      let value;
      if (text.charCodeAt(pos) === 34) {
        // A field that opens with a quote.
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        // Find its closing quote: the next quote that is not doubled.
        let segStart = pos + 1;
        let q = pos + 1;
        let parts = null;
        let close = -1;
        for (;;) {
          const c = text.indexOf('"', q);
          if (c === -1) break;
          if (text.charCodeAt(c + 1) === 34) {
            // Doubled quote: one quote in the value, and the field goes on.
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, c + 1));
            segStart = c + 2;
            q = c + 2;
            continue;
          }
          close = c;
          break;
        }
        if (close === -1) {
          // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1;
          line = openLine;
          scanUnquoted('"');
          value = outValue;
          ended = outEnded;
        } else {
          value = parts === null ? text.slice(segStart, close) : parts.join('') + text.slice(segStart, close);
          // Each CRLF or lone CR inside quotes is read as LF, and counts as one line break.
          if (value.indexOf('\n') !== -1 || value.indexOf('\r') !== -1) {
            if (value.indexOf('\r') !== -1) value = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
            let p = 0;
            while ((p = value.indexOf('\n', p)) !== -1) {
              line += 1;
              p += 1;
            }
          }
          pos = close + 1;
          if (pos >= n) {
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              ended = LINE_BREAK;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              ended = LINE_BREAK;
            } else {
              // What follows the closing quote is appended as it stands, up to the next comma or line break.
              const before = value.length;
              scanUnquoted(value);
              value = outValue;
              ended = outEnded;
              if (value.length > before) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
          }
        }
      } else {
        lastQuoted = false;
        scanUnquoted('');
        value = outValue;
        ended = outEnded;
      }
      fields.push(value);
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

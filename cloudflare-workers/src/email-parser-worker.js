export default {
  async email(message, env, ctx) {
    try {
      const rawEmail = await streamToString(message.raw);
      
      // Extract original From header from raw email
      const originalFrom = extractOriginalFromHeader(rawEmail);
      const from = originalFrom || message.from;
      const to = message.to;
      const rawSubject = message.headers.get('subject') || '';
      const subject = decodeMimeHeader(rawSubject);
      
      console.log('Raw subject:', rawSubject);
      console.log('Decoded subject:', subject);
      console.log('Message from:', message.from);
      console.log('Original from:', originalFrom);
      console.log('Using from:', from);

      if (!isRakutenSecurities2FAEmail(from, subject)) {
        console.log('Email is not from Rakuten Securities 2FA system');
        console.log('Subject check failed for:', subject);
        return;
      }

      const imageSequence = parseImageSequence(rawEmail);

      if (!imageSequence) {
        console.error('Failed to parse image sequence from email');
        return;
      }

      const sessionId = extractSessionId(rawEmail);
      const userId = message.to.split('@')[0];

      const payload = {
        type: '2FA_SEQUENCE',
        userId: userId,
        timestamp: new Date().toISOString(),
        sequence: imageSequence,
        sessionId: sessionId,
        emailMetadata: {
          from: from,
          to: to,
          subject: subject,
          receivedAt: new Date().toISOString()
        }
      };

      await sendToWebSocketWorker(env, payload);

      console.log('Successfully processed 2FA email:', payload);

    } catch (error) {
      console.error('Error processing email:', error);
    }
  }
};

function extractOriginalFromHeader(rawEmail) {
  try {
    // Extract From header from raw email (can span multiple lines)
    const fromMatch = rawEmail.match(/^From:\s*(.+(?:\r?\n\s+.+)*)$/m);
    if (fromMatch) {
      let fromHeader = fromMatch[1].trim();
      
      // Remove line breaks and extra spaces from multiline headers
      fromHeader = fromHeader.replace(/\r?\n\s+/g, ' ').trim();
      
      console.log('Raw From header:', fromHeader);
      
      // First try to extract email from angle brackets (most reliable)
      const rawEmailMatch = fromHeader.match(/<([^>]+)>/);
      if (rawEmailMatch) {
        console.log('Extracted email from angle brackets:', rawEmailMatch[1]);
        return rawEmailMatch[1];
      }
      
      // If no angle brackets, decode MIME and try again
      const decodedFromHeader = decodeMimeHeader(fromHeader);
      console.log('Decoded From header:', decodedFromHeader);
      
      // Try angle brackets on decoded header
      const emailMatch = decodedFromHeader.match(/<([^>]+)>/);
      if (emailMatch) {
        console.log('Extracted email from decoded angle brackets:', emailMatch[1]);
        return emailMatch[1];
      }
      
      // If no angle brackets, check if it looks like an email
      if (decodedFromHeader.includes('@') && decodedFromHeader.includes('.')) {
        console.log('Using decoded header as email:', decodedFromHeader);
        return decodedFromHeader;
      }
      
      console.log('No email found in From header');
      return null;
    }
    
    return null;
  } catch (e) {
    console.error('Error extracting original From header:', e);
    return null;
  }
}

function isRakutenSecurities2FAEmail(from, subject) {
  const validFromPatterns = [
    'service@rakuten-sec.co.jp',
    'noreply@rakuten-sec.co.jp',
    'securities-relay@bounce2.rakuten-sec.co.jp'
  ];
  
  const validSubjectPatterns = [
    'ログイン追加認証コード',
    '認証コード',
    '2段階認証',
    'Security Code',
    '2FA',
    '楽天証券',
    'ログイン',
    '追加認証'
  ];

  const fromMatch = validFromPatterns.some(pattern => 
    from.toLowerCase().includes(pattern.toLowerCase())
  );
  
  console.log('From check:', fromMatch, 'for:', from);
  
  const subjectMatch = validSubjectPatterns.some(pattern => {
    const isMatch = subject.includes(pattern);
    if (isMatch) {
      console.log('Subject pattern matched:', pattern);
    }
    return isMatch;
  });
  
  console.log('Subject check:', subjectMatch, 'for:', subject);

  return fromMatch && subjectMatch;
}

function decodeQuotedPrintable(input) {
  // This function handles the "=XX" hex format and soft line breaks "=\r\n".
  return input
    .replace(/=\r?\n/g, '') // Soft line breaks
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeISO2022JP(input) {
  try {
    // Create a proper UTF-8 decoder for ISO-2022-JP
    let result = '';
    const bytes = new Uint8Array(input.length);
    
    // Convert string to byte array
    for (let i = 0; i < input.length; i++) {
      bytes[i] = input.charCodeAt(i) & 0xFF;
    }
    
    // Try to decode using TextDecoder if available
    try {
      const decoder = new TextDecoder('iso-2022-jp');
      result = decoder.decode(bytes);
      console.log('Successfully decoded ISO-2022-JP to UTF-8:', result.substring(0, 100) + '...');
      return result;
    } catch (decoderError) {
      console.log('TextDecoder failed, using manual conversion:', decoderError);
      
      // Fallback: Manual escape sequence handling
      let decoded = input;
      
      // Handle escape sequences for ISO-2022-JP
      // ESC $ B = start Kanji mode, ESC ( B = end Kanji mode  
      decoded = decoded.replace(/\x1B\$B([^\x1B]*)\x1B\(B/g, (_, content) => {
        // Common patterns found in Rakuten emails - now with proper UTF-8 output
        const commonPatterns = {
          '3ZE7>Z7t$h$j%m%0%$%sDI2CG\'>Z%3!<%I$rAwIU$$$?$7$^$9': '楽天証券よりログイン追加認証コードを送付いたします',
          '3ZE7>Z7t$h$j': '楽天証券より',
          '%m%0%$%s': 'ログイン',
          'DI2CG\'>Z': '追加認証',
          'G\'>Z%3!<%I': '認証コード',
          '3(J8;z#1$NFbMF': '絵文字#1の内容',
          '3(J8;z#2$NFbMF': '絵文字#2の内容',
          '%*%U%m': 'オフロ',
          '%I%i%4%s': 'ドラゴン',
          '%/%m%$%+%*': 'クロイカオ',
          '%&%7': 'ウシ',
          '%1%$%3%/%^!<%/': 'ライコマーク',
          '%8%g%&%P': 'ジョウバ',
          '%K%e%&%3%/%7%s%5': 'ニョウコシスミ'
        };
        
        // Check for exact matches first
        if (commonPatterns[content]) {
          return commonPatterns[content];
        }
        
        // Check for partial matches
        for (const [encoded, decodedText] of Object.entries(commonPatterns)) {
          if (content.includes(encoded)) {
            return content.replace(new RegExp(encoded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), decodedText);
          }
        }
        
        // For debugging - return with markers
        console.log('Unknown ISO-2022-JP content:', content);
        return content; // Return as-is for now
      });
      
      return decoded;
    }
  } catch (e) {
    console.error('Error decoding ISO-2022-JP:', e);
    return input;
  }
}

function decodeMimeHeader(header) {
  if (!header) return '';
  
  try {
    // Handle MIME encoded headers like =?iso-2022-jp?B?...?=
    const mimePattern = /=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi;
    
    let decoded = header;
    let match;
    
    while ((match = mimePattern.exec(header)) !== null) {
      const [fullMatch, charset, encoding, encodedText] = match;
      
      try {
        let decodedText = '';
        
        if (encoding.toUpperCase() === 'B') {
          // Base64 decoding
          const base64Decoded = atob(encodedText);
          
          if (charset.toLowerCase().includes('iso-2022-jp')) {
            // Handle ISO-2022-JP
            decodedText = decodeISO2022JP(base64Decoded);
          } else {
            decodedText = base64Decoded;
          }
        } else if (encoding.toUpperCase() === 'Q') {
          // Quoted-printable decoding
          decodedText = decodeQuotedPrintable(encodedText.replace(/_/g, ' '));
        }
        
        decoded = decoded.replace(fullMatch, decodedText);
      } catch (e) {
        console.error('Error decoding MIME part:', e);
        // Keep original if decoding fails
      }
    }
    
    // Clean up any remaining whitespace/newlines
    decoded = decoded.replace(/\s+/g, ' ').trim();
    
    console.log('MIME decoded:', decoded);
    return decoded;
    
  } catch (e) {
    console.error('Error in decodeMimeHeader:', e);
    return header;
  }
}

function parseImageSequence(rawEmail) {
  try {
    // Find the boundary string from the main Content-Type header
    const boundaryMatch = rawEmail.match(/boundary="([^"]+)"/i);
    if (!boundaryMatch || !boundaryMatch[1]) {
      console.error("Could not find multipart boundary string. Attempting simple parse.");
      return parseWithSimpleRegex(rawEmail);
    }
    const boundary = `--${boundaryMatch[1]}`;

    // Split the email into parts using the boundary
    const parts = rawEmail.split(boundary);

    for (const part of parts) {
      // Find the part that is text/html and quoted-printable
      if (part.includes("Content-Type: text/html") && part.includes("Content-Transfer-Encoding: quoted-printable")) {
        // Get the body of this part (content after the double newline)
        const bodyMatch = part.match(/\r?\n\r?\n([\s\S]*)/);
        if (bodyMatch && bodyMatch[1]) {
          let body = bodyMatch[1];
          const decodedBody = decodeQuotedPrintable(body);
          
          // Convert ISO-2022-JP to readable text
          const readableBody = decodeISO2022JP(decodedBody);
          console.log('Decoded body:', readableBody);

          // Parse the actual format: 絵文字１の内容 ラクダ <br>
          // Now that we have proper UTF-8, look for the Japanese emoji names
          const patterns = [
            // Look for UTF-8 Japanese names with full-width numbers
            /絵文字１の内容\s+([ァ-ヴーa-zA-Z0-9\w]+)\s*<br[^>]*>\s*絵文字２の内容\s+([ァ-ヴーa-zA-Z0-9\w]+)\s*<br/i,
            /絵文字１の内容\s*=?\s*([ァ-ヴーa-zA-Z0-9\w]+)\s*<br[^>]*>\s*絵文字２の内容\s*=?\s*([ァ-ヴーa-zA-Z0-9\w]+)\s*<br/i,
            // Fallback with half-width numbers
            /絵文字#1の内容\s+([ァ-ヴーa-zA-Z0-9\w]+)\s*<br[^>]*>\s*絵文字#2の内容\s+([ァ-ヴーa-zA-Z0-9\w]+)\s*<br/i,
            /絵文字#1の内容\s*=?\s*([ァ-ヴーa-zA-Z0-9\w]+)\s*<br[^>]*>\s*絵文字#2の内容\s*=?\s*([ァ-ヴーa-zA-Z0-9\w]+)\s*<br/i,
            // Original fallback patterns
            /絵文字#1の内容\s+([%\w!-]+)\s*<br[^>]*>\s*絵文字#2の内容\s+([%\w!-]+)\s*<br/i,
            /絵文字#1の内容\s*=?\s*([^\s<]+)\s*<br[^>]*>\s*絵文字#2の内容\s*=?\s*([^\s<]+)\s*<br/i
          ];
          
          for (const pattern of patterns) {
            const sequenceMatch = readableBody.match(pattern);
            if (sequenceMatch && sequenceMatch.length === 3) {
              const sequence = [sequenceMatch[1].trim(), sequenceMatch[2].trim()];
              console.log(`Parsed sequence successfully with pattern: ${sequence}`);
              return sequence;
            }
          }
        }
      }
    }

    console.error("Could not find a suitable HTML part to parse in the email.");
    return parseWithSimpleRegex(rawEmail);

  } catch (e) {
    console.error("An exception occurred during parsing:", e);
    return parseWithSimpleRegex(rawEmail);
  }
}

// This fallback attempts to find the sequence in the whole body, for simpler emails.
function parseWithSimpleRegex(body) {
  try {
    const decodedBody = decodeQuotedPrintable(body);
    const readableBody = decodeISO2022JP(decodedBody);
    
    // Try multiple patterns - prioritize UTF-8 Japanese names with full-width numbers
    const patterns = [
      // Look for UTF-8 Japanese names with full-width numbers first
      /絵文字１の内容\s+([ァ-ヴーa-zA-Z0-9\w]+)\s*<br[^>]*>\s*絵文字２の内容\s+([ァ-ヴーa-zA-Z0-9\w]+)\s*<br/i,
      /絵文字１の内容\s*=?\s*([ァ-ヴーa-zA-Z0-9\w]+)\s*<br[^>]*>\s*絵文字２の内容\s*=?\s*([ァ-ヴーa-zA-Z0-9\w]+)\s*<br/i,
      // Fallback with half-width numbers
      /絵文字#1の内容\s+([ァ-ヴーa-zA-Z0-9\w]+)\s*<br[^>]*>\s*絵文字#2の内容\s+([ァ-ヴーa-zA-Z0-9\w]+)\s*<br/i,
      /絵文字#1の内容\s*=?\s*([ァ-ヴーa-zA-Z0-9\w]+)\s*<br[^>]*>\s*絵文字#2の内容\s*=?\s*([ァ-ヴーa-zA-Z0-9\w]+)\s*<br/i,
      // Original fallback patterns
      /絵文字#1の内容\s+([%\w!-]+)\s*<br[^>]*>\s*絵文字#2の内容\s+([%\w!-]+)\s*<br/i,
      /絵文字#1の内容\s*=?\s*([%\w!-]+)\s*<br[^>]*>\s*絵文字#2の内容\s*=?\s*([%\w!-]+)\s*<br/i,
      /絵文字#1の内容\s+([^\s<]+)\s*<br[^>]*>\s*絵文字#2の内容\s+([^\s<]+)\s*<br/i,
      /絵文字#1の内容\s*=\s*([^\s<]+)\s*<br[^>]*>\s*絵文字#2の内容\s*=\s*([^\s<]+)\s*<br/i,
      /認証画像1の絵柄\s*[：:=]?\s*([^\s<]+)\s*<br[^>]*>\s*認証画像2の絵柄\s*[：:=]?\s*([^\s<]+)\s*<br/i,
      /画像1\s*[：:=]?\s*([^\s<]+)\s*<br[^>]*>\s*画像2\s*[：:=]?\s*([^\s<]+)\s*<br/i
    ];
    
    for (const pattern of patterns) {
      const sequenceMatch = readableBody.match(pattern);
      if (sequenceMatch && sequenceMatch.length === 3) {
        const sequence = [sequenceMatch[1].trim(), sequenceMatch[2].trim()];
        console.log(`Parsed sequence with fallback pattern: ${sequence}`);
        return sequence;
      }
    }
    
    console.log('No sequence patterns matched in fallback');
    return null;
  } catch (e) {
    console.error('Error in parseWithSimpleRegex:', e);
    return null;
  }
}

function extractSessionId(emailBody) {
  const sessionPatterns = [
    /セッションID:\s*([A-Za-z0-9\-]+)/,
    /Session ID:\s*([A-Za-z0-9\-]+)/i,
    /認証ID:\s*([A-Za-z0-9\-]+)/
  ];

  for (const pattern of sessionPatterns) {
    const match = emailBody.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

async function sendToWebSocketWorker(env, payload) {
  const websocketWorkerUrl = env.WEBSOCKET_WORKER_URL || 'https://your-websocket-worker.workers.dev';
  
  const response = await fetch(`${websocketWorkerUrl}/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.INTERNAL_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Failed to send to WebSocket worker: ${response.status}`);
  }
}

async function streamToString(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  
  return result;
}
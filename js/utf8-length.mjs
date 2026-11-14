/** Count TextEncoder's UTF-8 bytes without allocating a temporary byte array.
 * Unpaired surrogates count as the three-byte replacement character, matching
 * TextEncoder; callers that require Unicode scalar values reject them first. */
export function utf8ByteLength(text) {
  if(typeof text!=='string')throw new TypeError('utf8-string-required');
  let bytes=0;
  for(let index=0;index<text.length;index++) {
    const unit=text.charCodeAt(index);
    if(unit<0x80)bytes++;
    else if(unit<0x800)bytes+=2;
    else if(unit>=0xd800&&unit<=0xdbff&&index+1<text.length&&text.charCodeAt(index+1)>=0xdc00&&text.charCodeAt(index+1)<=0xdfff){bytes+=4;index++;}
    else bytes+=3;
  }
  return bytes;
}

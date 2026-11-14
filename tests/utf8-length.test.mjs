import test from 'node:test';
import assert from 'node:assert/strict';
import {utf8ByteLength} from '../js/utf8-length.mjs';

test('allocation-free byte count exactly matches TextEncoder for all UTF-16 code units and surrogate edges',()=>{
  const encoder=new TextEncoder();
  for(let unit=0;unit<=0xffff;unit++) {
    const text=String.fromCharCode(unit);assert.equal(utf8ByteLength(text),encoder.encode(text).length);
  }
  for(const text of ['', 'ASCII punctuation: []{},true0123456789', '\ud800\udc00','\udbff\udfff','\ud800\ud800\udc00','\udfff\ud800','a😀é€z','😀'.repeat(16384)])assert.equal(utf8ByteLength(text),encoder.encode(text).length);
});

test('byte budget counting refuses non-string inputs without coercion',()=>{
  for(const value of [null,undefined,0,{},[],{toString(){throw new Error('must not coerce');}}])assert.throws(()=>utf8ByteLength(value),/utf8-string-required/);
});

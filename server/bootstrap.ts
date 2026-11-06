import { createHash, timingSafeEqual } from 'node:crypto';
export function validBootstrap(input: string|undefined, expected: string|undefined) {
  if(!input || !expected || input.length>128) return false;
  const hash=(value:string)=>createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(input),hash(expected));
}

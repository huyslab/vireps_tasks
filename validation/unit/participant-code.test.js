import test from 'node:test';
import assert from 'node:assert/strict';
import {createParticipantCode, participantCodeValidationError, normalizeParticipantCode, PARTICIPANT_CODE_ALPHABET as alphabet, PARTICIPANT_CODE_CAPACITY as capacity} from '../../core/utils/participant-code.js';

test('codes are stable, unique and valid across 100,000 registrations and the upper boundary',()=>{
 const codes=new Set();
 for(let id=1;id<=100000;id++){
  const code=createParticipantCode(id);
  assert.equal(code.length,6);assert.equal(participantCodeValidationError(code),null);
  assert(!codes.has(code));codes.add(code);
 }
 assert.equal(createParticipantCode(3),'LCT46Y');
 assert.equal(participantCodeValidationError(createParticipantCode(capacity)),null);
 for(const invalid of [0,-1,1.5,capacity+1,'3',NaN,Infinity])assert.throws(()=>createParticipantCode(invalid),RangeError);
});

test('every one-character substitution and distinct-character swap is rejected',()=>{
 for(const id of [1,2,3,31,32,1000,100000,capacity]){
  const code=createParticipantCode(id);
  for(let i=0;i<6;i++)for(const replacement of alphabet){
   if(replacement!==code[i])assert(participantCodeValidationError(code.slice(0,i)+replacement+code.slice(i+1)));
  }
  for(let i=0;i<6;i++)for(let j=i+1;j<6;j++){
   if(code[i]===code[j])continue;
   const swapped=[...code];[swapped[i],swapped[j]]=[swapped[j],swapped[i]];
   assert(participantCodeValidationError(swapped.join('')));
  }
 }
});

test('case and outer whitespace normalise, but missing, extra and confusing characters do not',()=>{
 assert.equal(normalizeParticipantCode(' lct46y '),'LCT46Y');
 assert.equal(participantCodeValidationError(' lct46y '),null);
 for(const invalid of ['',null,3,'3','LCT46','LCT46YY','LCT 46Y','LCT460','LCT461','LCT46I','LCT46O','LCT46U'])assert(participantCodeValidationError(invalid));
});

test('every capitalization of the three reserved debug IDs is accepted and normalised',()=>{
 for(const id of ['debugdemo','demo','debug']){
  for(let mask=0;mask<2**id.length;mask++){
   const variant=[...id].map((character,index)=>mask&(1<<index)?character.toUpperCase():character).join('');
   assert.equal(participantCodeValidationError(variant),null);
   assert.equal(normalizeParticipantCode(variant),id);
  }
 }
 for(const value of ['debugg','demos','debugdemo2','mydebug','abc-demo'])assert(participantCodeValidationError(value));
});

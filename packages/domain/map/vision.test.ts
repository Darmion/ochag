import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveVision, type VisionInput} from './vision.ts';
const base: VisionInput = {
 campaignFogEnabled:true, playerFogDisabledByGm:false,
 mayChooseAlliedVision:true, selectedVision:'allies', blinded:false,
 campaignBlindnessRadiusFeet:5,
};
test('blindness blocks allied sight and applies 5ft cap',()=>{
 assert.deepEqual(resolveVision({...base,blinded:true}),{
  bypassFog:false,alliedVision:false,blindnessRadiusFeet:5});
});
test('GM can restore allied sight during blindness',()=>{
 assert.equal(resolveVision({...base,blinded:true,allowAlliesWhileBlindByGm:true}).alliedVision,true);
});
test('GM exception does not grant missing shared-vision permission',()=>{
 assert.equal(resolveVision({...base,blinded:true,mayChooseAlliedVision:false,allowAlliesWhileBlindByGm:true}).alliedVision,false);
});
test('removing blindness restores selected mode without mutating input',()=>{
 resolveVision({...base,blinded:true}); assert.equal(resolveVision(base).alliedVision,true);
});
test('individual and global fog bypass override effect caps',()=>{
 for(const patch of [{playerFogDisabledByGm:true},{campaignFogEnabled:false}]) {
  assert.deepEqual(resolveVision({...base,blinded:true,...patch}),{
    bypassFog:true,alliedVision:false,blindnessRadiusFeet:null});
 }
});
test('zero-radius override is preserved',()=>{
 assert.equal(resolveVision({...base,blinded:true,blindnessRadiusOverrideFeet:0}).blindnessRadiusFeet,0);
});
test('invalid radii are rejected',()=>{
 for(const radius of [-1,NaN,Infinity]) assert.throws(()=>resolveVision({...base,campaignBlindnessRadiusFeet:radius}),RangeError);
});

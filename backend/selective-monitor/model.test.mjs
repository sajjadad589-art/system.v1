import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {label,validateSample} from './model.mjs';
import {parseOutput,scriptFor} from './collector.mjs';
const c={subscriber_id:randomUUID(),generation:randomUUID()};
test('dynamic session IP and directional counters, ambiguous DNS',()=>{
 const s=parseOutput('BEGIN|172.10.11.253|abc\nC|172.217.116.4:443|tcp|20|100\nD|172.217.116.4|play.googleapis.com\nD|172.217.116.4|firebaseinstallations.googleapis.com\nEND|1',c);
 assert.equal(s.current_ip,'172.10.11.253');assert.equal(s.connections[0].repl_bytes,100);assert.equal(s.connections[0].confidence,'AMBIGUOUS');assert.equal(s.connections[0].app,'Google');
});
test('offline and changed sessions never attributed to stale IP',()=>{assert.equal(parseOutput('OFFLINE',c).current_ip,null);assert.throws(()=>parseOutput('BEGIN|172.10.11.253|abc\nC|1.1.1.1:443|tcp|1|2',c));});
test('reject malformed IP, counters, oversize snapshot and injection',()=>{
 assert.throws(()=>scriptFor('x"; /system reboot;'));assert.throws(()=>parseOutput('BEGIN|999.1.1.1|x\nEND|0',c));
 const s=parseOutput('BEGIN|172.10.11.1|x\nEND|0',c);assert.throws(()=>validateSample({...s,connections:Array(101).fill({})}));
 assert.throws(()=>parseOutput('BEGIN|172.10.11.1|x\nC|1.1.1.1:443|tcp|-1|3\nEND|1',c));
});
test('DNS hints cannot become full URLs or confirmed application visits',()=>{assert.deepEqual(label(['https://example.com/private']).domains,[]);assert.equal(label([]).confidence,'UNKNOWN');assert.equal(label(['evilgoogle.com']).app,null);});

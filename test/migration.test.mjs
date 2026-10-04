import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
test('upgrading public sites and interrupted operations preserves identities and effect recovery phases',()=>{
 const db=new DatabaseSync(':memory:');try{
 for(const file of ['001_publications.sql','002_project_provenance.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 for(const [id,identity] of [['known','identity'],['new',null]])db.prepare("INSERT INTO publications(id,artifact_id,title,account_id,project,identity,created_at) VALUES(?,?,?,'account',?,?,?)").run(id,id,id,id,identity,'date');
 for(const [id,pub,action] of [['deploy','known','publish'],['create','new','publish']])db.prepare("INSERT INTO operations(id,publication_id,action,status,confirmation,revision,created_at,updated_at) VALUES(?,?,?,'unknown','{}','revision','date','date')").run(id,pub,action);
 db.exec(readFileSync(new URL('../migrations/003_access.sql',import.meta.url),'utf8'));
 assert.equal(db.prepare('SELECT access_mode FROM publications WHERE id=?').get('known').access_mode,'public');assert.equal(db.prepare('SELECT identity FROM publications WHERE id=?').get('known').identity,'identity');
 assert.equal(db.prepare('SELECT remote_phase FROM operations WHERE id=?').get('deploy').remote_phase,'deploying');assert.equal(db.prepare('SELECT remote_phase FROM operations WHERE id=?').get('create').remote_phase,'creating');assert.equal(db.prepare('SELECT access_config FROM operations WHERE id=?').get('deploy').access_config,null);
 }finally{db.close()}
});

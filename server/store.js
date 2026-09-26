import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function openStore(filename) {
  if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, workspace TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);');
  const insert=db.prepare('INSERT INTO runs(id,created_at,workspace,status,payload) VALUES(?,?,?,?,?)');
  return {
    save(run){insert.run(run.id,run.createdAt,run.workspaceName,run.status,JSON.stringify(run));return run;},
    get(id){const row=db.prepare('SELECT payload FROM runs WHERE id=?').get(id);return row?JSON.parse(row.payload):null;},
    list(){return db.prepare('SELECT id, created_at AS createdAt, workspace AS workspaceName, status FROM runs ORDER BY created_at DESC LIMIT 100').all();},
    close(){db.close();}
  };
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const target=path.resolve(here,'../netlify/functions/_release-meta.mjs');
const meta={
  commitRef:String(process.env.COMMIT_REF||process.env.GITHUB_SHA||''),
  deployId:String(process.env.DEPLOY_ID||''),
  context:String(process.env.CONTEXT||''),
  branch:String(process.env.BRANCH||''),
  siteName:String(process.env.SITE_NAME||''),
  stampedAt:new Date().toISOString(),
};
fs.writeFileSync(target,`export const RELEASE_META=${JSON.stringify(meta,null,2)};\n`,'utf8');
console.log(`Stamped release metadata: ${meta.commitRef||'NO_COMMIT_REF'}`);
